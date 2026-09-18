/**
 * Strategist outcome scoreboard.
 *
 * Every strategist card that ships a priced structure is enrolled here and later
 * marked at its time stop (or at expiration when no time stop was set). The mark
 * is the per-share value of the whole structure, priced the same way as entry
 * (positive = net debit, negative = net credit), so P&L is always
 * `markValue - entryValue` regardless of structure.
 *
 * Mark sources, in order of preference:
 *   1. `options_chain_daily` rows for the due date (exact end-of-day marks).
 *   2. Intrinsic value at expiration from the underlying's daily close (when the
 *      card is already past expiry and no chain marks exist).
 *   3. Live Schwab quotes for the option legs (when the card is still alive).
 *
 * Aggregates feed the scoreboard API and a compact track-record block that the
 * strategist prompts can read to calibrate stated confidence.
 */
import {
  db,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  equityDailyTable,
  optionsChainDailyTable,
  strategistHistoryTable,
  strategistJobsTable,
  strategistOutcomesTable,
  strategistTelemetryTable,
  type StrategistOutcome,
} from "@workspace/db";
import { logger } from "./logger.js";
import { getBestAccessToken } from "./tokenStore.js";
import { buildSchwabOptionStreamerKey } from "./schwabOptionOccKey.js";
import { nyCalendarYmd } from "./usEquityMarketCalendar.js";

const SCHWAB_MARKETDATA = "https://api.schwabapi.com/marketdata/v1";
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** After this many days past expiration with no usable marks, stop retrying. */
const UNSCORABLE_AFTER_EXPIRY_DAYS = 7;
/** Minimum scored cards before the track record is shown to the model. */
export const TRACK_RECORD_MIN_SCORED = 10;

export type OutcomeLeg = {
  type: "call" | "put";
  side: "buy" | "sell";
  strike: number;
  expiration: string;
  entryMid: number | null;
};

export interface ScorableCard {
  legs: OutcomeLeg[];
  entryValue: number;
  strategyType: string | null;
  direction: string | null;
  confidence: number | null;
  expiration: string;
  timeStop: string | null;
  markDue: string;
  maxRisk: number | null;
  maxProfit: number | null;
  family: "credit" | "debit";
  mode: string;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
}

/** Per-share structure value from per-leg prices: long legs add, short legs subtract. */
export function structureValue(
  legs: readonly OutcomeLeg[],
  priceOf: (leg: OutcomeLeg) => number | null,
): number | null {
  let total = 0;
  for (const leg of legs) {
    const p = priceOf(leg);
    if (p == null || !Number.isFinite(p)) return null;
    total += leg.side === "buy" ? p : -p;
  }
  return Math.round(total * 10_000) / 10_000;
}

/** Option value at expiration given the underlying settlement price. */
export function intrinsicValue(leg: Pick<OutcomeLeg, "type" | "strike">, underlying: number): number {
  return leg.type === "call" ? Math.max(0, underlying - leg.strike) : Math.max(0, leg.strike - underlying);
}

export function classifyOutcome(pnlPerShare: number): "WIN" | "LOSS" | "FLAT" {
  if (pnlPerShare > 0.01) return "WIN";
  if (pnlPerShare < -0.01) return "LOSS";
  return "FLAT";
}

function detectMode(card: Record<string, unknown>): string {
  if (typeof card.consensus === "object" && card.consensus) return "consensus";
  const desk = card.deskResult as Record<string, unknown> | null | undefined;
  if (desk && typeof desk === "object") {
    if ("family_hypotheses" in desk || "regime_synthesis" in desk) return "conviction";
    const inner = (desk as { result?: Record<string, unknown> }).result;
    if (inner && ("family_hypotheses" in inner || "regime_synthesis" in inner)) return "conviction";
    return "desk";
  }
  if (card.debate || card.debateTranscript || card.debateVerdict) return "debate";
  return "solo";
}

/**
 * Pull the priced structure out of a persisted card. Returns null for cards without a
 * recommendation (blocks, passes, failures) or without enough pricing to score.
 */
export function extractScorableCard(cardJson: unknown, signalYmd: string): ScorableCard | null {
  if (!cardJson || typeof cardJson !== "object") return null;
  const card = cardJson as Record<string, unknown>;
  const status = card.status;
  if (status !== "recommendation" && status !== "desk_recommendation") return null;
  const rec = card.recommendation as Record<string, unknown> | undefined;
  if (!rec || typeof rec !== "object") return null;
  const rawLegs = Array.isArray(rec.legs) ? (rec.legs as Array<Record<string, unknown>>) : [];
  const legs: OutcomeLeg[] = [];
  for (const l of rawLegs) {
    const type = String(l.type ?? l.optionType ?? "").toLowerCase();
    const sideRaw = String(l.side ?? l.action ?? "").toLowerCase();
    const strike = num(l.strike);
    const expiration = typeof l.expiration === "string" && YMD.test(l.expiration) ? l.expiration : null;
    if ((type !== "call" && type !== "put") || (sideRaw !== "buy" && sideRaw !== "sell") || strike == null || !expiration) {
      return null;
    }
    legs.push({ type, side: sideRaw, strike, expiration, entryMid: num(l.mid) });
  }
  if (legs.length === 0) return null;

  const debit = num(rec.debit);
  const credit = num(rec.credit);
  let entryValue: number | null = null;
  if (debit != null && debit > 0) entryValue = debit;
  else if (credit != null && credit > 0) entryValue = -credit;
  else entryValue = structureValue(legs, (l) => l.entryMid);
  if (entryValue == null || entryValue === 0) return null;

  const legExp = legs.map((l) => l.expiration).sort();
  const expiration =
    typeof rec.expiration === "string" && YMD.test(rec.expiration) ? rec.expiration : legExp[legExp.length - 1]!;
  const exit = rec.exitTargets as Record<string, unknown> | undefined;
  const ts = exit && typeof exit.timeStop === "string" && YMD.test(exit.timeStop) ? exit.timeStop : null;
  const timeStop = ts && ts > signalYmd && ts <= expiration ? ts : null;
  const maxRisk = num(rec.maxLoss) ?? num(rec.maxRisk);
  const maxProfitRaw = num(rec.maxProfit);
  const maxProfit = maxProfitRaw != null && maxProfitRaw < 99_999 ? maxProfitRaw : null;
  const confidence = num(rec.confidence) ?? num(card.confidence);

  return {
    legs,
    entryValue,
    strategyType: typeof rec.strategyType === "string" ? rec.strategyType : typeof rec.strategy === "string" ? rec.strategy : null,
    direction: typeof rec.direction === "string" ? rec.direction : null,
    confidence,
    expiration,
    timeStop,
    markDue: timeStop ?? expiration,
    maxRisk: maxRisk != null && maxRisk > 0 ? maxRisk : null,
    maxProfit,
    family: entryValue < 0 ? "credit" : "debit",
    mode: detectMode(card),
  };
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/** Enroll history cards that carry a priced structure and are not yet tracked. */
export async function enrollPendingOutcomes(limit = 500): Promise<{ scanned: number; enrolled: number }> {
  const rows = await db
    .select({
      id: strategistHistoryTable.id,
      jobId: strategistHistoryTable.jobId,
      ticker: strategistHistoryTable.ticker,
      createdAt: strategistHistoryTable.createdAt,
      cardJson: strategistHistoryTable.cardJson,
      userId: strategistJobsTable.userId,
    })
    .from(strategistHistoryTable)
    .leftJoin(strategistOutcomesTable, eq(strategistOutcomesTable.historyId, strategistHistoryTable.id))
    .leftJoin(strategistJobsTable, eq(strategistJobsTable.id, strategistHistoryTable.jobId))
    .where(isNull(strategistOutcomesTable.id))
    .orderBy(desc(strategistHistoryTable.createdAt))
    .limit(limit);

  let enrolled = 0;
  for (const row of rows) {
    const signalYmd = nyCalendarYmd(row.createdAt);
    const card = extractScorableCard(row.cardJson, signalYmd);
    if (!card) continue;
    const telemetryId = num((row.cardJson as Record<string, unknown>)?.telemetryId);
    let provider: string | null = null;
    let modelName: string | null = null;
    if (telemetryId != null) {
      const [t] = await db
        .select({ provider: strategistTelemetryTable.provider, modelName: strategistTelemetryTable.modelName })
        .from(strategistTelemetryTable)
        .where(eq(strategistTelemetryTable.id, telemetryId))
        .limit(1);
      provider = t?.provider ?? null;
      modelName = t?.modelName ?? null;
    }
    try {
      await db
        .insert(strategistOutcomesTable)
        .values({
          historyId: row.id,
          jobId: row.jobId,
          userId: row.userId ?? null,
          ticker: row.ticker.toUpperCase(),
          signalAt: row.createdAt,
          mode: card.mode,
          provider,
          modelName,
          strategyType: card.strategyType,
          family: card.family,
          direction: card.direction,
          confidence: card.confidence,
          legs: card.legs,
          entryValue: card.entryValue,
          maxRisk: card.maxRisk,
          maxProfit: card.maxProfit,
          expiration: card.expiration,
          timeStop: card.timeStop,
          markDue: card.markDue,
        })
        .onConflictDoNothing();
      enrolled += 1;
    } catch (err) {
      logger.warn({ err, historyId: row.id }, "scoreboard: enroll failed");
    }
  }
  return { scanned: rows.length, enrolled };
}

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------

type LegKey = string;
function legKey(ticker: string, leg: OutcomeLeg): LegKey {
  return `${ticker}|${leg.expiration}|${leg.type}|${leg.strike}`;
}

async function chainDailyMarks(
  ticker: string,
  date: string,
  legs: readonly OutcomeLeg[],
): Promise<Map<LegKey, number>> {
  const out = new Map<LegKey, number>();
  const expirations = [...new Set(legs.map((l) => l.expiration))];
  const rows = await db
    .select({
      strike: optionsChainDailyTable.strike,
      expiration: optionsChainDailyTable.expiration,
      optionType: optionsChainDailyTable.optionType,
      mid: optionsChainDailyTable.mid,
      bid: optionsChainDailyTable.bid,
      ask: optionsChainDailyTable.ask,
    })
    .from(optionsChainDailyTable)
    .where(
      and(
        eq(optionsChainDailyTable.underlyingSymbol, ticker),
        eq(optionsChainDailyTable.date, date),
        inArray(optionsChainDailyTable.expiration, expirations),
      ),
    );
  for (const leg of legs) {
    const hit = rows.find(
      (r) =>
        r.expiration === leg.expiration &&
        String(r.optionType ?? "").toLowerCase().startsWith(leg.type[0]!) &&
        r.strike != null &&
        Math.abs(r.strike - leg.strike) < 0.001,
    );
    if (!hit) continue;
    const mid = hit.mid ?? (hit.bid != null && hit.ask != null ? (hit.bid + hit.ask) / 2 : null);
    if (mid != null && Number.isFinite(mid)) out.set(legKey(ticker, leg), mid);
  }
  return out;
}

async function equityCloseOnOrBefore(ticker: string, date: string): Promise<{ close: number; date: string } | null> {
  const [row] = await db
    .select({ close: equityDailyTable.close, date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(and(eq(equityDailyTable.symbol, ticker), lte(equityDailyTable.date, date)))
    .orderBy(desc(equityDailyTable.date))
    .limit(1);
  if (!row || row.close == null || !Number.isFinite(row.close)) return null;
  return { close: row.close, date: row.date };
}

type LiveMark = { mark: number | null; last: number | null };

/** Live Schwab quotes for option legs and their underlying, keyed by the symbol string sent. */
async function fetchLiveMarks(symbols: string[]): Promise<Map<string, LiveMark>> {
  const out = new Map<string, LiveMark>();
  const token = getBestAccessToken();
  if (!token || symbols.length === 0) return out;
  for (let i = 0; i < symbols.length; i += 50) {
    const batch = symbols.slice(i, i + 50);
    try {
      const res = await fetch(
        `${SCHWAB_MARKETDATA}/quotes?symbols=${encodeURIComponent(batch.join(","))}&fields=quote`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, { quote?: Record<string, unknown> }>;
      for (const sym of batch) {
        const q = json[sym]?.quote;
        if (!q) continue;
        const bid = num(q.bidPrice);
        const ask = num(q.askPrice);
        const mark = num(q.mark) ?? (bid != null && ask != null ? (bid + ask) / 2 : null) ?? num(q.lastPrice);
        out.set(sym, { mark, last: num(q.lastPrice) ?? num(q.mark) });
      }
    } catch (err) {
      logger.warn({ err }, "scoreboard: live quote batch failed");
    }
  }
  return out;
}

interface MarkResult {
  markValue: number;
  markDate: string;
  markSource: "chain_daily" | "intrinsic_expiry" | "schwab_quote";
  underlyingAtMark: number | null;
}

async function markRow(row: StrategistOutcome, today: string, live: Map<string, LiveMark>): Promise<MarkResult | null> {
  const legs = row.legs as OutcomeLeg[];
  // 1. End-of-day chain marks on the due date.
  const chain = await chainDailyMarks(row.ticker, row.markDue, legs);
  const chainValue = structureValue(legs, (l) => chain.get(legKey(row.ticker, l)) ?? null);
  if (chainValue != null) {
    const und = await equityCloseOnOrBefore(row.ticker, row.markDue);
    return { markValue: chainValue, markDate: row.markDue, markSource: "chain_daily", underlyingAtMark: und?.close ?? null };
  }
  // 2. Past expiration: settle at intrinsic value from the underlying close.
  if (today > row.expiration) {
    const und = await equityCloseOnOrBefore(row.ticker, row.expiration);
    if (und && daysBetween(und.date, row.expiration) <= 5) {
      const v = structureValue(legs, (l) => intrinsicValue(l, und.close));
      if (v != null) return { markValue: v, markDate: row.expiration, markSource: "intrinsic_expiry", underlyingAtMark: und.close };
    }
    const liveUnd = live.get(row.ticker)?.last ?? null;
    if (liveUnd != null && daysBetween(row.expiration, today) <= 2) {
      const v = structureValue(legs, (l) => intrinsicValue(l, liveUnd));
      if (v != null) return { markValue: v, markDate: today, markSource: "intrinsic_expiry", underlyingAtMark: liveUnd };
    }
    return null;
  }
  // 3. Still alive: live option marks.
  const liveValue = structureValue(legs, (l) => {
    const key = buildSchwabOptionStreamerKey(row.ticker, l.expiration, l.strike, l.type);
    return key ? live.get(key)?.mark ?? null : null;
  });
  if (liveValue != null) {
    return { markValue: liveValue, markDate: today, markSource: "schwab_quote", underlyingAtMark: live.get(row.ticker)?.last ?? null };
  }
  return null;
}

/** Mark every pending card whose due date has arrived. */
export async function scoreDueOutcomes(now = new Date()): Promise<{ due: number; scored: number; unscorable: number }> {
  const today = nyCalendarYmd(now);
  const due = await db
    .select()
    .from(strategistOutcomesTable)
    .where(and(eq(strategistOutcomesTable.status, "pending"), lte(strategistOutcomesTable.markDue, today)))
    .orderBy(strategistOutcomesTable.markDue)
    .limit(300);
  if (due.length === 0) return { due: 0, scored: 0, unscorable: 0 };

  const liveSymbols = new Set<string>();
  for (const row of due) {
    liveSymbols.add(row.ticker);
    if (today <= row.expiration) {
      for (const l of row.legs as OutcomeLeg[]) {
        const key = buildSchwabOptionStreamerKey(row.ticker, l.expiration, l.strike, l.type);
        if (key) liveSymbols.add(key);
      }
    }
  }
  const live = await fetchLiveMarks([...liveSymbols]);

  let scored = 0;
  let unscorable = 0;
  for (const row of due) {
    try {
      const mark = await markRow(row, today, live);
      if (mark) {
        const pnl = Math.round((mark.markValue - row.entryValue) * 10_000) / 10_000;
        const pnlPct = row.maxRisk && row.maxRisk > 0 ? Math.round((pnl / row.maxRisk) * 10_000) / 100 : null;
        await db
          .update(strategistOutcomesTable)
          .set({
            status: "scored",
            markDate: mark.markDate,
            markSource: mark.markSource,
            markValue: mark.markValue,
            underlyingAtMark: mark.underlyingAtMark,
            pnlPerShare: pnl,
            pnlPctOfRisk: pnlPct,
            outcome: classifyOutcome(pnl),
            scoredAt: now,
            attempts: row.attempts + 1,
          })
          .where(eq(strategistOutcomesTable.id, row.id));
        scored += 1;
        continue;
      }
      const giveUp = daysBetween(row.expiration, today) > UNSCORABLE_AFTER_EXPIRY_DAYS;
      await db
        .update(strategistOutcomesTable)
        .set(
          giveUp
            ? { status: "unscorable", unscorableReason: "no_marks_after_expiry", attempts: row.attempts + 1 }
            : { attempts: row.attempts + 1 },
        )
        .where(eq(strategistOutcomesTable.id, row.id));
      if (giveUp) unscorable += 1;
    } catch (err) {
      logger.warn({ err, outcomeId: row.id, ticker: row.ticker }, "scoreboard: mark failed");
    }
  }
  return { due: due.length, scored, unscorable };
}

/** Enroll new cards, then mark whatever is due. Safe to run any time; non-throwing. */
export async function runOutcomeScoreboardCycle(): Promise<{
  enrolled: number;
  due: number;
  scored: number;
  unscorable: number;
}> {
  try {
    const e = await enrollPendingOutcomes();
    const s = await scoreDueOutcomes();
    logger.info({ ...e, ...s }, "scoreboard: cycle complete");
    return { enrolled: e.enrolled, ...s };
  } catch (err) {
    logger.error({ err }, "scoreboard: cycle failed");
    return { enrolled: 0, due: 0, scored: 0, unscorable: 0 };
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface BucketStat {
  key: string;
  n: number;
  wins: number;
  hitRate: number | null;
  avgPnlPctOfRisk: number | null;
  /** Mean P&L per share across scored cards (per-contract dollars ÷ 100). */
  avgPnlPerShare: number | null;
}

export interface ScoreboardSummary {
  scored: number;
  pending: number;
  unscorable: number;
  wins: number;
  losses: number;
  flats: number;
  hitRate: number | null;
  avgPnlPctOfRisk: number | null;
  /** Average win % of risk ÷ average loss % of risk, when both exist. */
  payoffRatio: number | null;
  /** hitRate × avgWin − (1 − hitRate) × avgLoss, in % of max risk. */
  expectancyPctOfRisk: number | null;
}

export interface Scoreboard {
  windowDays: number;
  summary: ScoreboardSummary;
  byConfidence: BucketStat[];
  byFamily: BucketStat[];
  byDirection: BucketStat[];
  byModel: BucketStat[];
  byMode: BucketStat[];
  recent: Array<{
    id: number;
    ticker: string;
    signalAt: string;
    strategyType: string | null;
    direction: string | null;
    confidence: number | null;
    entryValue: number;
    markValue: number | null;
    markSource: string | null;
    markDate: string | null;
    pnlPerShare: number | null;
    pnlPctOfRisk: number | null;
    outcome: string | null;
    status: string;
    modelName: string | null;
    mode: string | null;
    markDue: string;
  }>;
}

export const CONFIDENCE_BUCKETS: ReadonlyArray<{ key: string; min: number; max: number }> = [
  { key: "<40", min: -Infinity, max: 40 },
  { key: "40-59", min: 40, max: 60 },
  { key: "60-74", min: 60, max: 75 },
  { key: "75+", min: 75, max: Infinity },
];

export function confidenceBucket(confidence: number | null): string {
  if (confidence == null) return "unknown";
  const b = CONFIDENCE_BUCKETS.find((x) => confidence >= x.min && confidence < x.max);
  return b?.key ?? "unknown";
}

type ScoredLike = Pick<StrategistOutcome, "outcome" | "pnlPctOfRisk" | "pnlPerShare">;

function bucketize<T extends ScoredLike>(rows: readonly T[], keyOf: (r: T) => string, order?: readonly string[]): BucketStat[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  const stats: BucketStat[] = [];
  for (const [key, arr] of groups) {
    const wins = arr.filter((r) => r.outcome === "WIN").length;
    const pct = arr.map((r) => r.pnlPctOfRisk).filter((v): v is number => v != null);
    const per = arr.map((r) => r.pnlPerShare).filter((v): v is number => v != null);
    stats.push({
      key,
      n: arr.length,
      wins,
      hitRate: arr.length ? Math.round((wins / arr.length) * 1000) / 10 : null,
      avgPnlPctOfRisk: pct.length ? Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 10) / 10 : null,
      avgPnlPerShare: per.length ? Math.round((per.reduce((a, b) => a + b, 0) / per.length) * 100) / 100 : null,
    });
  }
  if (order) {
    stats.sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  } else {
    stats.sort((a, b) => b.n - a.n);
  }
  return stats;
}

export function summarizeScored(rows: readonly ScoredLike[]): Omit<ScoreboardSummary, "pending" | "unscorable"> {
  const wins = rows.filter((r) => r.outcome === "WIN");
  const losses = rows.filter((r) => r.outcome === "LOSS");
  const flats = rows.filter((r) => r.outcome === "FLAT");
  const pct = rows.map((r) => r.pnlPctOfRisk).filter((v): v is number => v != null);
  const winPct = wins.map((r) => r.pnlPctOfRisk).filter((v): v is number => v != null);
  const lossPct = losses.map((r) => r.pnlPctOfRisk).filter((v): v is number => v != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const hitRate = rows.length ? wins.length / rows.length : null;
  const avgWin = mean(winPct);
  const avgLoss = mean(lossPct);
  const payoffRatio = avgWin != null && avgLoss != null && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null;
  const expectancy =
    hitRate != null && avgWin != null && avgLoss != null ? hitRate * avgWin + (1 - hitRate) * avgLoss : null;
  const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    scored: rows.length,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    hitRate: hitRate == null ? null : Math.round(hitRate * 1000) / 10,
    avgPnlPctOfRisk: r1(mean(pct)),
    payoffRatio: payoffRatio == null ? null : Math.round(payoffRatio * 100) / 100,
    expectancyPctOfRisk: r1(expectancy),
  };
}

export function buildScoreboardFromRows(rows: readonly StrategistOutcome[], windowDays: number): Scoreboard {
  const scored = rows.filter((r) => r.status === "scored");
  const pending = rows.filter((r) => r.status === "pending").length;
  const unscorable = rows.filter((r) => r.status === "unscorable").length;
  const summary: ScoreboardSummary = { ...summarizeScored(scored), pending, unscorable };
  return {
    windowDays,
    summary,
    byConfidence: bucketize(scored, (r) => confidenceBucket(r.confidence), [...CONFIDENCE_BUCKETS.map((b) => b.key), "unknown"]),
    byFamily: bucketize(scored, (r) => r.family ?? "unknown"),
    byDirection: bucketize(scored, (r) => (r.direction ?? "unknown").toUpperCase()),
    byModel: bucketize(scored, (r) => r.modelName ?? r.provider ?? "unknown"),
    byMode: bucketize(scored, (r) => r.mode ?? "unknown"),
    recent: rows
      .slice()
      .sort((a, b) => b.signalAt.getTime() - a.signalAt.getTime())
      .slice(0, 60)
      .map((r) => ({
        id: r.id,
        ticker: r.ticker,
        signalAt: r.signalAt.toISOString(),
        strategyType: r.strategyType,
        direction: r.direction,
        confidence: r.confidence,
        entryValue: r.entryValue,
        markValue: r.markValue,
        markSource: r.markSource,
        markDate: r.markDate,
        pnlPerShare: r.pnlPerShare,
        pnlPctOfRisk: r.pnlPctOfRisk,
        outcome: r.outcome,
        status: r.status,
        modelName: r.modelName,
        mode: r.mode,
        markDue: r.markDue,
      })),
  };
}

export async function loadOutcomeRows(userId: string | null, windowDays = 90): Promise<StrategistOutcome[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const conds = [gte(strategistOutcomesTable.signalAt, since)];
  if (userId) conds.push(eq(strategistOutcomesTable.userId, userId));
  return db
    .select()
    .from(strategistOutcomesTable)
    .where(and(...conds))
    .orderBy(desc(strategistOutcomesTable.signalAt))
    .limit(2000);
}

export async function getScoreboard(userId: string | null, windowDays = 90): Promise<Scoreboard> {
  const rows = await loadOutcomeRows(userId, windowDays);
  return buildScoreboardFromRows(rows, windowDays);
}

// ---------------------------------------------------------------------------
// Prompt block
// ---------------------------------------------------------------------------

/** Compact, factual track record for the model. Null until enough cards are scored. */
export function formatTrackRecordBlock(board: Scoreboard): string | null {
  const s = board.summary;
  if (s.scored < TRACK_RECORD_MIN_SCORED) return null;
  const pct = (v: number | null) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`);
  const line = (b: BucketStat) => `${b.key}: n=${b.n}, hit ${b.hitRate ?? "n/a"}%, avg ${pct(b.avgPnlPctOfRisk)} of risk`;
  const parts = [
    `Realized outcomes of this desk's own prior recommendations (last ${board.windowDays} days, ${s.scored} scored, ${s.pending} still open). Use this to calibrate the confidence number you report; it does not change what today's data says.`,
    `Overall: hit rate ${s.hitRate ?? "n/a"}%, avg P&L ${pct(s.avgPnlPctOfRisk)} of max risk, expectancy ${pct(s.expectancyPctOfRisk)} of risk per card.`,
    `By stated confidence: ${board.byConfidence.filter((b) => b.n > 0).map(line).join("; ")}.`,
    `By family: ${board.byFamily.map(line).join("; ")}.`,
  ];
  if (board.byDirection.length > 1) parts.push(`By direction: ${board.byDirection.map(line).join("; ")}.`);
  return parts.join("\n");
}

let trackRecordCache: { at: number; userId: string | null; block: string | null } | null = null;
const TRACK_RECORD_CACHE_MS = 10 * 60 * 1000;

/** Cached track-record block for prompt injection; empty string when not yet meaningful. */
export async function getTrackRecordForPrompt(userId: string | null): Promise<string | null> {
  const now = Date.now();
  if (trackRecordCache && trackRecordCache.userId === userId && now - trackRecordCache.at < TRACK_RECORD_CACHE_MS) {
    return trackRecordCache.block;
  }
  try {
    const board = await getScoreboard(userId);
    const block = formatTrackRecordBlock(board);
    trackRecordCache = { at: now, userId, block };
    return block;
  } catch (err) {
    logger.warn({ err }, "scoreboard: track record unavailable");
    return null;
  }
}

/** Test seam. */
export function __resetTrackRecordCache(): void {
  trackRecordCache = null;
}

/** Exposed for tests and the API: the sql helper is re-exported so callers need not import drizzle. */
export const _sql = sql;
