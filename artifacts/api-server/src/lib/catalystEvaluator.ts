/**
 * Catalyst evaluator (swing-trader frame, 28-60 DTE).
 *
 * Reframes the legacy "is there a same-day catalyst" question — which is a
 * day-trader concern and incorrectly blocks valid swing setups (post-earnings
 * drift, mean reversion, vol regime, trend continuation) — into the actually
 * relevant question for defined-risk spreads:
 *
 *   "Is there a known catalyst that will fire between today and the
 *    proposed expiration?"
 *
 * Schema deliberately includes:
 *  - catalystInWindow: any scheduled HIGH-impact event before expiry
 *  - catalystType:     dominant event type
 *  - catalystDate:     date of the dominant event (ISO)
 *  - catalystAlignment: ALIGNED | CONTRADICTS | NEUTRAL | UNKNOWN
 *  - residualCatalyst: recently-fired event the price is still digesting
 *
 * Deterministic sources (server-computed):
 *  - EARNINGS         → earningsService (vendor calendar primary, FMP DB + Finnhub fallback)
 *  - FED_MEETING      → calendarEventChecker FOMC schedule
 *  - ECONOMIC_RELEASE → calendarEventChecker (NFP/CPI/PPI/PCE/GDP, HIGH only)
 *
 * AI-supplied (model fills these from web search; server trusts but bounds):
 *  - PRODUCT_LAUNCH, MA_EVENT, ANALYST_ACTION
 *  - residualCatalyst (recently-fired event)
 *  - catalystAlignment vs proposed direction
 */

import { getNextEarningsDate } from "./earningsService.js";
import { getUpcomingEvents } from "./calendarEventChecker.js";

export type CatalystType =
  | "EARNINGS"
  | "FED_MEETING"
  | "ECONOMIC_RELEASE"
  | "PRODUCT_LAUNCH"
  | "MA_EVENT"
  | "ANALYST_ACTION"
  | "NONE";

export type CatalystAlignment = "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "UNKNOWN";

/**
 * Scope of the in-window catalyst:
 *  - NAME_SPECIFIC: ticker-specific event (EARNINGS, M&A, PRODUCT_LAUNCH, ANALYST_ACTION)
 *  - MACRO_ONLY:    only ambient macro events (FED_MEETING, ECONOMIC_RELEASE)
 *  - BOTH:          name-specific AND macro events both fire
 *  - NONE:          no scheduled events in window
 */
export type CatalystScope = "NAME_SPECIFIC" | "MACRO_ONLY" | "BOTH" | "NONE";

const NAME_SPECIFIC_TYPES: ReadonlySet<CatalystType> = new Set([
  "EARNINGS", "MA_EVENT", "PRODUCT_LAUNCH", "ANALYST_ACTION",
]);
const MACRO_TYPES: ReadonlySet<CatalystType> = new Set([
  "FED_MEETING", "ECONOMIC_RELEASE",
]);

export interface ResidualCatalyst {
  type: Exclude<CatalystType, "NONE">;
  date: string;
  daysSince: number;
}

export interface ScheduledEvent {
  type: Exclude<CatalystType, "NONE">;
  date: string;
  title: string;
  source: "earnings_service" | "calendar" | "ai_web_search";
}

export interface CatalystEvaluation {
  catalystInWindow: boolean;
  catalystType: CatalystType;
  catalystDate: string | null;
  catalystAlignment: CatalystAlignment;
  /** See CatalystScope. Used by the NO_EDGE gate and the card header. */
  catalystScope: CatalystScope;
  residualCatalyst?: ResidualCatalyst;
  catalystSummary?: string;
  scheduledEvents: ScheduledEvent[];
}

export interface AiCatalystSignal {
  type?: string | null;
  date?: string | null;
  alignment?: string | null;
  summary?: string | null;
  residual?: { type?: string | null; date?: string | null } | null;
}

export type TradeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

/**
 * Derive trade direction from the AI's chosen strategy / legs. Used to compute
 * deterministic catalystAlignment server-side and stop the AI from defaulting
 * to UNKNOWN.
 */
export function deriveTradeDirection(
  strategy: string | undefined | null,
  legs: ReadonlyArray<{ type: "call" | "put"; action: "buy" | "sell" }> | undefined,
): TradeDirection {
  const s = (strategy ?? "").toLowerCase();
  if (/(iron_condor|iron_butterfly|butterfly|straddle|strangle|calendar|double_calendar|diagonal)/.test(s)) {
    return "NEUTRAL";
  }
  if (/(bull|long_call|put_credit|call_debit)/.test(s)) return "BULLISH";
  if (/(bear|long_put|call_credit|put_debit)/.test(s)) return "BEARISH";
  // Fall back to leg shape: net long calls = bullish, net long puts = bearish.
  if (legs && legs.length > 0) {
    let callBias = 0;
    let putBias = 0;
    for (const l of legs) {
      const sign = l.action === "buy" ? 1 : -1;
      if (l.type === "call") callBias += sign;
      else if (l.type === "put") putBias += sign;
    }
    if (callBias > 0 && putBias <= 0) return "BULLISH";
    if (putBias > 0 && callBias <= 0) return "BEARISH";
  }
  return "NEUTRAL";
}

const VALID_TYPES: ReadonlySet<CatalystType> = new Set([
  "EARNINGS", "FED_MEETING", "ECONOMIC_RELEASE",
  "PRODUCT_LAUNCH", "MA_EVENT", "ANALYST_ACTION", "NONE",
]);

const VALID_ALIGNMENTS: ReadonlySet<CatalystAlignment> = new Set([
  "ALIGNED", "CONTRADICTS", "NEUTRAL", "UNKNOWN",
]);

function normalizeType(raw: unknown): CatalystType | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return (VALID_TYPES.has(t as CatalystType) ? (t as CatalystType) : null);
}

function normalizeAlignment(raw: unknown): CatalystAlignment {
  if (typeof raw !== "string") return "UNKNOWN";
  const a = raw.trim().toUpperCase();
  if (a === "NONE") return "NEUTRAL";  // legacy → NEUTRAL
  return VALID_ALIGNMENTS.has(a as CatalystAlignment) ? (a as CatalystAlignment) : "UNKNOWN";
}

function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayISO(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build a unified catalyst evaluation for a proposed swing trade.
 *
 * @param opts.ticker           Symbol the strategist is evaluating.
 * @param opts.expirationISO    Far-leg expiration (YYYY-MM-DD). Used as the
 *                              right edge of the "in-window" check.
 * @param opts.ai               Optional AI-reported catalyst signals (web search).
 */
export async function evaluateCatalyst(opts: {
  ticker: string;
  expirationISO: string;
  ai?: AiCatalystSignal | null;
  /**
   * Trade direction derived from the AI's chosen structure. When supplied, the
   * server overrides AI-reported UNKNOWN alignment with a deterministic value
   * for the cases where alignment is unambiguous (no catalyst, upcoming
   * binary EARNINGS event, ambient macro-only catalysts).
   */
  tradeDirection?: TradeDirection;
}): Promise<CatalystEvaluation> {
  const today = todayISO();
  const expiration = isISODate(opts.expirationISO) ? opts.expirationISO : today;
  const dteCalendar = Math.max(
    0,
    Math.ceil(
      (new Date(expiration + "T00:00:00Z").getTime() -
        new Date(today + "T00:00:00Z").getTime()) /
        86_400_000,
    ),
  );

  const scheduled: ScheduledEvent[] = [];

  // (1) Earnings — single source of truth via earningsService.
  // Also captures the most recent past print so we can synthesise an
  // EARNINGS residual deterministically (within 14d), independent of the AI.
  let serverEarningsResidual: ResidualCatalyst | undefined;
  try {
    const e = await getNextEarningsDate(opts.ticker);
    if (
      e?.earningsDate &&
      e.daysAway != null &&
      e.daysAway >= 0 &&
      e.daysAway <= dteCalendar
    ) {
      scheduled.push({
        type: "EARNINGS",
        date: e.earningsDate,
        title: `${opts.ticker.toUpperCase()} Earnings${e.confirmed ? "" : " (est)"}`,
        source: "earnings_service",
      });
    }
    if (
      e?.lastEarningsDate &&
      e.lastEarningsDaysSince != null &&
      e.lastEarningsDaysSince >= 0 &&
      e.lastEarningsDaysSince <= 14
    ) {
      serverEarningsResidual = {
        type: "EARNINGS",
        date: e.lastEarningsDate,
        daysSince: e.lastEarningsDaysSince,
      };
    }
  } catch {
    // earnings lookup failure is non-fatal; we still consider macro events.
  }

  // (2) FOMC + HIGH-impact economic releases between now and expiration.
  // getUpcomingEvents takes trading days; calendar days is always >= trading
  // days, so passing dteCalendar over-fetches safely. We then filter by ISO.
  const macroWindow = Math.max(2, dteCalendar);
  for (const ev of getUpcomingEvents(macroWindow)) {
    if (ev.date < today || ev.date > expiration) continue;
    if (ev.type === "fomc") {
      scheduled.push({ type: "FED_MEETING", date: ev.date, title: ev.title, source: "calendar" });
    } else if (ev.type === "economic" && ev.importance === "HIGH") {
      scheduled.push({ type: "ECONOMIC_RELEASE", date: ev.date, title: ev.title, source: "calendar" });
    }
  }

  // (3) AI-supplied non-scheduled catalysts. We only accept types the model
  // can credibly source from web search (product launches, M&A, analyst calls).
  // Earnings/FOMC/economic from the AI are ignored — server data is canonical.
  const aiType = normalizeType(opts.ai?.type);
  const aiDate = isISODate(opts.ai?.date ?? undefined) ? (opts.ai!.date as string) : null;
  if (
    aiType &&
    (aiType === "PRODUCT_LAUNCH" || aiType === "MA_EVENT" || aiType === "ANALYST_ACTION") &&
    aiDate &&
    aiDate >= today &&
    aiDate <= expiration
  ) {
    scheduled.push({
      type: aiType,
      date: aiDate,
      title: opts.ai?.summary?.slice(0, 140) || aiType,
      source: "ai_web_search",
    });
  }

  scheduled.sort((a, b) => a.date.localeCompare(b.date));

  // Pick dominant catalyst — earliest in window, with EARNINGS taking priority
  // when same-day (since it dominates implied vol behaviour).
  const earningsHit = scheduled.find(s => s.type === "EARNINGS");
  const primary = earningsHit ?? scheduled[0];

  // (4) Residual — server-side EARNINGS detection takes precedence (it's
  // deterministic from earningsService and never depends on the model
  // remembering to populate it). The AI may add residuals of *other* types
  // (M&A announcements, product launches, analyst actions) via its JSON
  // response; those are accepted only when EARNINGS isn't already set and
  // are bounded to the last 14 days.
  let residual: ResidualCatalyst | undefined = serverEarningsResidual;
  if (!residual) {
    const residualType = normalizeType(opts.ai?.residual?.type);
    const residualDate = isISODate(opts.ai?.residual?.date ?? undefined)
      ? (opts.ai!.residual!.date as string)
      : null;
    // We deliberately ignore an AI-supplied EARNINGS residual: server is
    // canonical for that type, and accepting AI input would risk overriding
    // a known-good vendor calendar date with a hallucinated one.
    if (
      residualType &&
      residualType !== "NONE" &&
      residualType !== "EARNINGS" &&
      residualDate
    ) {
      const days = Math.round(
        (new Date(today + "T00:00:00Z").getTime() -
          new Date(residualDate + "T00:00:00Z").getTime()) /
          86_400_000,
      );
      if (days >= 0 && days <= 14) {
        residual = {
          type: residualType as Exclude<CatalystType, "NONE">,
          date: residualDate,
          daysSince: days,
        };
      }
    }
  }

  // (5a) Alignment — start from the AI value, then apply deterministic
  // server-side overrides for the cases where alignment is unambiguous so we
  // stop emitting UNKNOWN on almost every run.
  let alignment = normalizeAlignment(opts.ai?.alignment);
  const aiAlignmentRaw = typeof opts.ai?.alignment === "string"
    ? opts.ai.alignment.trim().toUpperCase()
    : null;
  // Deterministic rules (apply regardless of AI value when conditions are met,
  // but only override if AI itself returned UNKNOWN/missing — ALIGNED or
  // CONTRADICTS that the model explicitly asserted should win).
  const aiSaidUnknownOrMissing = !aiAlignmentRaw || aiAlignmentRaw === "UNKNOWN";

  // No scheduled catalyst at all → trade direction has nothing to align with;
  // NEUTRAL is the correct semantic value (not UNKNOWN, which means
  // "indeterminate from data").
  if (scheduled.length === 0 && aiSaidUnknownOrMissing) {
    alignment = "NEUTRAL";
  }

  // (5) Scope — distinguishes ticker-specific events from ambient macro.
  const hasNameSpecific = scheduled.some(s => NAME_SPECIFIC_TYPES.has(s.type));
  const hasMacro = scheduled.some(s => MACRO_TYPES.has(s.type));
  const scope: CatalystScope =
    scheduled.length === 0 ? "NONE" :
    hasNameSpecific && hasMacro ? "BOTH" :
    hasNameSpecific ? "NAME_SPECIFIC" :
    "MACRO_ONLY";

  // Additional alignment overrides that depend on scope/primary type:
  // - In-window EARNINGS is a binary event that hasn't fired; nothing to
  //   "align" with directionally → NEUTRAL beats UNKNOWN.
  // - MACRO_ONLY (FOMC/CPI/PCE) is ambient; for a single-name swing trade the
  //   correct alignment is NEUTRAL unless the AI explicitly justifies otherwise.
  if (aiSaidUnknownOrMissing) {
    if (primary?.type === "EARNINGS") alignment = "NEUTRAL";
    else if (scope === "MACRO_ONLY") alignment = "NEUTRAL";
  }
  // tradeDirection is reserved for future use (e.g. earnings-surprise sign vs
  // direction) once we have surprise data; currently it's accepted but not
  // required for any of the deterministic overrides above.
  void opts.tradeDirection;

  return {
    catalystInWindow: scheduled.length > 0,
    catalystType: primary?.type ?? "NONE",
    catalystDate: primary?.date ?? null,
    catalystAlignment: alignment,
    catalystScope: scope,
    residualCatalyst: residual,
    catalystSummary: opts.ai?.summary?.slice(0, 240) ?? undefined,
    scheduledEvents: scheduled,
  };
}
