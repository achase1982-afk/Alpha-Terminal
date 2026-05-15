/**
 * GET /api/scanner/v3/symbol/:symbol/events — UAI-shaped rows from `options_flow_raw_trades`
 * for the **same RTH session-to-date window** as Layer 5 (`scannerFlowSessionWindow`).
 */

import { db } from "@workspace/db";
import { sql } from "@workspace/db";
import { dbNaiveUtcTimestampToIso } from "./dbNaiveUtcTimestampToIso.js";
import { getScannerRthSessionToDateWindow } from "./scannerFlowSessionWindow.js";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

export type UaiMoneynessBucket = "deep_itm" | "itm" | "atm" | "otm" | "deep_otm";

export type UaiEventDirection = "bullish" | "bearish" | "neutral";

export type UaiEvent = {
  id: number;
  ts: string;
  optionSymbol: string;
  callPut: "C" | "P";
  strike: number;
  expiration: string;
  dte: number;
  moneynessBucket: UaiMoneynessBucket;
  is0dte: boolean;
  side: "ask" | "bid" | "mid" | null;
  aggressorConfidence: number | null;
  isSweep: boolean;
  isBlock: boolean;
  contracts: number;
  notional: number;
  tradePrice: number;
  volOiRatio: number | null;
  openInterestSnapshot: number | null;
  volumeVsBaseline20d: number | null;
  direction: UaiEventDirection;
  syntheticLegGroupId: string | null;
  multiLegConfidence: "high" | "medium" | "low" | null;
  multiLegPartnerOcc: string | null;
  nbboPositionLabel: string;
};

export type UaiEventsSummary = {
  totalEvents: number;
  bullishNotional: number;
  bearishNotional: number;
  netDeltaDollar: number | null;
  topBullishStrikes: Array<{
    strike: number;
    expiration: string;
    callPut: "C" | "P";
    notional: number;
  }>;
  topBearishStrikes: Array<{
    strike: number;
    expiration: string;
    callPut: "C" | "P";
    notional: number;
  }>;
  callNotional: number;
  putNotional: number;
};

export type UaiSessionWire = {
  active: boolean;
  reason?: "not_trading_day" | "before_open" | "after_rth";
  sessionDateEt?: string;
  startIso?: string;
  endIso?: string;
};

export type UaiEventsPageWire = {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type UaiEventsPayload = {
  symbol: string;
  /** Span in ms when session active (end − start); 0 when inactive. */
  windowMs: number;
  session: UaiSessionWire;
  events: UaiEvent[];
  summary: UaiEventsSummary;
  page: UaiEventsPageWire;
};

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function intOrZero(v: unknown): number {
  const n = numOrNull(v);
  return n != null ? Math.trunc(n) : 0;
}

function emptySummary(): UaiEventsSummary {
  return {
    totalEvents: 0,
    bullishNotional: 0,
    bearishNotional: 0,
    netDeltaDollar: null,
    topBullishStrikes: [],
    topBearishStrikes: [],
    callNotional: 0,
    putNotional: 0,
  };
}

export function parseEventsPageLimit(query: unknown): number {
  if (query === undefined || query === null || query === "") return DEFAULT_PAGE_LIMIT;
  if (typeof query !== "string" && typeof query !== "number") return DEFAULT_PAGE_LIMIT;
  const n = typeof query === "number" ? query : Number(query.trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_PAGE_LIMIT);
}

function encodeCursor(id: number, tsIso: string): string {
  return Buffer.from(JSON.stringify({ id, ts: tsIso }), "utf8").toString("base64url");
}

export function parseEventsCursor(raw: unknown): { id: number; tsIso: string } | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const j = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as { id?: unknown; ts?: unknown };
    if (typeof j.id !== "number" || !Number.isFinite(j.id) || typeof j.ts !== "string" || !j.ts.trim()) return null;
    return { id: Math.trunc(j.id), tsIso: j.ts.trim() };
  } catch {
    return null;
  }
}

function optionTypeToCp(optionType: string): "C" | "P" {
  const t = optionType.trim().toLowerCase();
  return t === "put" ? "P" : "C";
}

function aggressorConfidenceToNumber(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const t = raw.trim().toLowerCase();
  if (t === "high") return 0.9;
  if (t === "medium") return 0.55;
  if (t === "low") return 0.3;
  if (t === "unknown") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isHighAggressorConfidence(raw: string | null): boolean {
  if (raw == null) return false;
  return raw.trim().toLowerCase() === "high";
}

export function moneynessBucketForStrike(
  spot: number,
  strike: number,
  callPut: "C" | "P",
): UaiMoneynessBucket {
  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(strike) || strike <= 0) return "atm";
  const ratio = callPut === "C" ? spot / strike : strike / spot;
  if (ratio >= 1.1) return "deep_itm";
  if (ratio >= 1.02) return "itm";
  if (ratio >= 0.98) return "atm";
  if (ratio >= 0.9) return "otm";
  return "deep_otm";
}

function deriveDirection(side: string | null, callPut: "C" | "P"): UaiEventDirection {
  if (side === "mid") return "neutral";
  if (side === "ask") {
    return callPut === "C" ? "bullish" : "bearish";
  }
  if (side === "bid") {
    return callPut === "C" ? "bearish" : "bullish";
  }
  return "neutral";
}

export function nbboPositionLabelForEvent(args: {
  isSweep: boolean;
  side: string | null;
  aggressorConfidenceText: string | null;
}): string {
  if (args.isSweep) return "sweep";
  if (args.side === "mid") return "mid";
  if (args.side === "ask") {
    return isHighAggressorConfidence(args.aggressorConfidenceText) ? "above ask" : "at ask";
  }
  if (args.side === "bid") {
    return isHighAggressorConfidence(args.aggressorConfidenceText) ? "below bid" : "at bid";
  }
  return "unknown";
}

function expirationIsoFromRow(raw: unknown): string {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw ?? "");
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function sessionDateIsoFromRow(raw: unknown): string {
  return expirationIsoFromRow(raw);
}

function computeIs0dte(dte: number, expirationIso: string, sessionDateIso: string): boolean {
  if (dte === 0) return true;
  if (expirationIso && sessionDateIso && expirationIso === sessionDateIso) return true;
  return false;
}

function readMultiLegPartnerOcc(extras: unknown): string | null {
  if (extras == null || typeof extras !== "object" || Array.isArray(extras)) return null;
  const v = (extras as Record<string, unknown>).multi_leg_partner_occ;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseMultiLegConfidence(raw: string | null): "high" | "medium" | "low" | null {
  if (raw == null) return null;
  const t = raw.trim().toLowerCase();
  if (t === "high" || t === "medium" || t === "low") return t;
  return null;
}

function mapRowToUaiEvent(row: Record<string, unknown>, spot: number | null): UaiEvent | null {
  const id = intOrZero(row.id);
  if (id <= 0) return null;
  const tsRaw = row.timestamp;
  const ts = dbNaiveUtcTimestampToIso(tsRaw) ?? "";
  if (!ts) return null;

  const optionSymbol = String(row.option_symbol ?? "").trim() || "-";
  const optionType = String(row.option_type ?? "call");
  const callPut = optionTypeToCp(optionType);
  const strike = numOrNull(row.strike) ?? 0;
  if (!(strike > 0)) return null;

  const expiration = expirationIsoFromRow(row.expiration);
  const sessionDateIso = sessionDateIsoFromRow(row.date);
  const dteFromCol = intOrZero(row.dte_days);
  const dte = dteFromCol;

  const spotUse = spot != null && Number.isFinite(spot) && spot > 0 ? spot : null;
  const moneynessBucket =
    spotUse != null ? moneynessBucketForStrike(spotUse, strike, callPut) : ("atm" as UaiMoneynessBucket);

  const is0dte = computeIs0dte(dte, expiration, sessionDateIso);

  const sideRaw = row.side != null ? String(row.side).trim().toLowerCase() : "";
  const side: UaiEvent["side"] =
    sideRaw === "ask" || sideRaw === "bid" || sideRaw === "mid" ? (sideRaw as UaiEvent["side"]) : null;

  const aggressorText = row.aggressor_confidence != null ? String(row.aggressor_confidence) : null;

  const isSweep = row.is_sweep === true;
  const isBlock = row.is_block === true;

  const contracts = intOrZero(row.size);
  const notionalRaw = numOrNull(row.notional);
  const notional = notionalRaw != null && Number.isFinite(notionalRaw) ? Math.max(0, notionalRaw) : 0;

  const tradePrice = numOrNull(row.trade_price) ?? 0;

  const volOiRatio = numOrNull(row.vol_oi_ratio);
  const openInterestSnapshot = row.open_interest_snapshot != null ? intOrZero(row.open_interest_snapshot) : null;
  const volumeVsBaseline20d = numOrNull(row.volume_vs_baseline_20d);

  const direction = deriveDirection(side, callPut);

  const syntheticLegGroupId =
    row.synthetic_leg_group_id != null && String(row.synthetic_leg_group_id).trim()
      ? String(row.synthetic_leg_group_id).trim()
      : null;
  const multiLegConfidence = parseMultiLegConfidence(
    row.multi_leg_confidence != null ? String(row.multi_leg_confidence) : null,
  );
  const multiLegPartnerOcc = readMultiLegPartnerOcc(row.extras);

  const nbboPositionLabel = nbboPositionLabelForEvent({
    isSweep,
    side,
    aggressorConfidenceText: aggressorText,
  });

  return {
    id,
    ts,
    optionSymbol,
    callPut,
    strike,
    expiration,
    dte,
    moneynessBucket,
    is0dte,
    side,
    aggressorConfidence: aggressorConfidenceToNumber(aggressorText),
    isSweep,
    isBlock,
    contracts,
    notional,
    tradePrice,
    volOiRatio,
    openInterestSnapshot: openInterestSnapshot != null && openInterestSnapshot > 0 ? openInterestSnapshot : null,
    volumeVsBaseline20d,
    direction,
    syntheticLegGroupId,
    multiLegConfidence,
    multiLegPartnerOcc,
    nbboPositionLabel,
  };
}

function mapTopStrikeRow(row: Record<string, unknown>): UaiEventsSummary["topBullishStrikes"][number] | null {
  const strike = numOrNull(row.strike);
  if (strike == null || !(strike > 0)) return null;
  const ot = String(row.option_type ?? "call").trim().toLowerCase();
  const callPut: "C" | "P" = ot === "put" ? "P" : "C";
  const expiration = expirationIsoFromRow(row.expiration);
  const n = numOrNull(row.leg_notional) ?? 0;
  return { strike, expiration, callPut, notional: Number.isFinite(n) ? Math.max(0, n) : 0 };
}

/**
 * Full-session aggregates over `options_flow_raw_trades` (same bounds as Layer 5).
 */
async function fetchUaiSymbolEventsSummarySql(args: {
  sym: string;
  startIso: string;
  endIso: string;
  spot: number | null;
}): Promise<UaiEventsSummary> {
  const { sym, startIso, endIso, spot } = args;
  const priceTuples =
    spot != null && Number.isFinite(spot) && spot > 0
      ? sql`(${sym}::text, ${spot}::double precision)`
      : sql`(${sym}::text, NULL::double precision)`;

  const [aggRes, topBullRes, topBearRes] = await Promise.all([
    db.execute(sql`
      WITH w AS (
        SELECT
          t.underlying_symbol,
          t.date,
          t.option_type,
          t.strike,
          t.expiration,
          t.size,
          t.notional,
          t.side,
          lower(trim(both from coalesce(t.side::text, ''))) AS side_norm,
          lower(trim(both from coalesce(t.option_type::text, ''))) AS ot_norm
        FROM options_flow_raw_trades t
        WHERE t.underlying_symbol = ${sym}
          AND t.timestamp IS NOT NULL
          AND t.timestamp >= ${startIso}::timestamptz
          AND t.timestamp <= ${endIso}::timestamptz
      ),
      prices(sym, px) AS (VALUES ${priceTuples})
      SELECT
        (SELECT COUNT(*)::int FROM w) AS total_events,
        (SELECT COALESCE(
          SUM(
            CASE
              WHEN side_norm = 'ask' AND ot_norm = 'call' THEN COALESCE(notional, 0)::double precision
              WHEN side_norm = 'bid' AND ot_norm = 'put' THEN COALESCE(notional, 0)::double precision
              ELSE 0::double precision
            END
          ),
          0
        )::double precision FROM w) AS bullish_notional,
        (SELECT COALESCE(
          SUM(
            CASE
              WHEN side_norm = 'ask' AND ot_norm = 'put' THEN COALESCE(notional, 0)::double precision
              WHEN side_norm = 'bid' AND ot_norm = 'call' THEN COALESCE(notional, 0)::double precision
              ELSE 0::double precision
            END
          ),
          0
        )::double precision FROM w) AS bearish_notional,
        (SELECT COALESCE(
          SUM(
            CASE
              WHEN ot_norm = 'call' THEN COALESCE(notional, 0)::double precision
              ELSE 0::double precision
            END
          ),
          0
        )::double precision FROM w) AS call_notional,
        (SELECT COALESCE(
          SUM(
            CASE
              WHEN ot_norm = 'put' THEN COALESCE(notional, 0)::double precision
              ELSE 0::double precision
            END
          ),
          0
        )::double precision FROM w) AS put_notional,
        (
          SELECT SUM(
            CASE
              WHEN w2.side_norm IN ('ask', 'bid')
                AND p.delta IS NOT NULL
                AND COALESCE(w2.size, 0) > 0
                AND pr.px IS NOT NULL
              THEN
                (CASE WHEN w2.side_norm = 'ask' THEN 1::double precision ELSE -1::double precision END)
                * p.delta::double precision
                * w2.size::double precision
                * 100.0::double precision
                * pr.px::double precision
              ELSE NULL::double precision
            END
          )
          FROM w AS w2
          LEFT JOIN prices pr ON pr.sym = w2.underlying_symbol
          LEFT JOIN options_flow_per_strike p
            ON p.underlying_symbol = w2.underlying_symbol
            AND p.date = w2.date
            AND p.option_type = w2.option_type
            AND p.strike = w2.strike
            AND p.expiration = w2.expiration
        ) AS net_delta_dollar
    `),
    db.execute(sql`
      SELECT
        t.strike,
        t.expiration,
        t.option_type,
        SUM(COALESCE(t.notional, 0))::double precision AS leg_notional
      FROM options_flow_raw_trades t
      WHERE t.underlying_symbol = ${sym}
        AND t.timestamp IS NOT NULL
        AND t.timestamp >= ${startIso}::timestamptz
        AND t.timestamp <= ${endIso}::timestamptz
        AND (
          (
            lower(trim(both from coalesce(t.side::text, ''))) = 'ask'
            AND lower(trim(both from coalesce(t.option_type::text, ''))) = 'call'
          )
          OR (
            lower(trim(both from coalesce(t.side::text, ''))) = 'bid'
            AND lower(trim(both from coalesce(t.option_type::text, ''))) = 'put'
          )
        )
      GROUP BY t.strike, t.expiration, t.option_type
      ORDER BY leg_notional DESC
      LIMIT 3
    `),
    db.execute(sql`
      SELECT
        t.strike,
        t.expiration,
        t.option_type,
        SUM(COALESCE(t.notional, 0))::double precision AS leg_notional
      FROM options_flow_raw_trades t
      WHERE t.underlying_symbol = ${sym}
        AND t.timestamp IS NOT NULL
        AND t.timestamp >= ${startIso}::timestamptz
        AND t.timestamp <= ${endIso}::timestamptz
        AND (
          (
            lower(trim(both from coalesce(t.side::text, ''))) = 'ask'
            AND lower(trim(both from coalesce(t.option_type::text, ''))) = 'put'
          )
          OR (
            lower(trim(both from coalesce(t.side::text, ''))) = 'bid'
            AND lower(trim(both from coalesce(t.option_type::text, ''))) = 'call'
          )
        )
      GROUP BY t.strike, t.expiration, t.option_type
      ORDER BY leg_notional DESC
      LIMIT 3
    `),
  ]);

  const aggRow = (aggRes.rows ?? [])[0] as Record<string, unknown> | undefined;
  const totalEvents = intOrZero(aggRow?.total_events);
  const bullishNotional = Math.max(0, numOrNull(aggRow?.bullish_notional) ?? 0);
  const bearishNotional = Math.max(0, numOrNull(aggRow?.bearish_notional) ?? 0);
  const callNotional = Math.max(0, numOrNull(aggRow?.call_notional) ?? 0);
  const putNotional = Math.max(0, numOrNull(aggRow?.put_notional) ?? 0);
  const netRaw = numOrNull(aggRow?.net_delta_dollar);
  const netDeltaDollar =
    netRaw != null && Number.isFinite(netRaw) ? Math.round(netRaw * 100) / 100 : null;

  const topBullishStrikes = (topBullRes.rows ?? [])
    .map((r) => mapTopStrikeRow(r as Record<string, unknown>))
    .filter((x): x is NonNullable<typeof x> => x != null);
  const topBearishStrikes = (topBearRes.rows ?? [])
    .map((r) => mapTopStrikeRow(r as Record<string, unknown>))
    .filter((x): x is NonNullable<typeof x> => x != null);

  return {
    totalEvents,
    bullishNotional,
    bearishNotional,
    netDeltaDollar,
    topBullishStrikes,
    topBearishStrikes,
    callNotional,
    putNotional,
  };
}

/**
 * Cursor-paginated session prints (newest first). Pass `limit+1` rows to detect `has_more`.
 */
async function fetchUaiSymbolEventsPageSql(args: {
  sym: string;
  startIso: string;
  endIso: string;
  spot: number | null;
  limit: number;
  cursor: { id: number; tsIso: string } | null;
}): Promise<UaiEvent[]> {
  const { sym, startIso, endIso, spot, limit, cursor } = args;
  const priceTuples =
    spot != null && Number.isFinite(spot) && spot > 0
      ? sql`(${sym}::text, ${spot}::double precision)`
      : sql`(${sym}::text, NULL::double precision)`;

  const rows =
    cursor == null
      ? await db.execute(sql`
          WITH prices(sym, px) AS (VALUES ${priceTuples})
          SELECT
            t.id,
            t.timestamp,
            t.option_symbol,
            t.option_type,
            t.strike,
            t.expiration,
            t.date,
            t.size,
            t.notional,
            t.trade_price,
            t.side,
            t.is_block,
            t.is_sweep,
            t.vol_oi_ratio,
            t.open_interest_snapshot,
            t.volume_vs_baseline_20d,
            t.aggressor_confidence,
            t.synthetic_leg_group_id,
            t.multi_leg_confidence,
            t.extras,
            t.dte_days,
            p.delta AS strike_delta
          FROM options_flow_raw_trades t
          LEFT JOIN prices pr ON pr.sym = t.underlying_symbol
          LEFT JOIN options_flow_per_strike p
            ON p.underlying_symbol = t.underlying_symbol
            AND p.date = t.date
            AND p.option_type = t.option_type
            AND p.strike = t.strike
            AND p.expiration = t.expiration
          WHERE t.underlying_symbol = ${sym}
            AND t.timestamp IS NOT NULL
            AND t.timestamp >= ${startIso}::timestamptz
            AND t.timestamp <= ${endIso}::timestamptz
          ORDER BY t.timestamp DESC, t.id DESC
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          WITH prices(sym, px) AS (VALUES ${priceTuples})
          SELECT
            t.id,
            t.timestamp,
            t.option_symbol,
            t.option_type,
            t.strike,
            t.expiration,
            t.date,
            t.size,
            t.notional,
            t.trade_price,
            t.side,
            t.is_block,
            t.is_sweep,
            t.vol_oi_ratio,
            t.open_interest_snapshot,
            t.volume_vs_baseline_20d,
            t.aggressor_confidence,
            t.synthetic_leg_group_id,
            t.multi_leg_confidence,
            t.extras,
            t.dte_days,
            p.delta AS strike_delta
          FROM options_flow_raw_trades t
          LEFT JOIN prices pr ON pr.sym = t.underlying_symbol
          LEFT JOIN options_flow_per_strike p
            ON p.underlying_symbol = t.underlying_symbol
            AND p.date = t.date
            AND p.option_type = t.option_type
            AND p.strike = t.strike
            AND p.expiration = t.expiration
          WHERE t.underlying_symbol = ${sym}
            AND t.timestamp IS NOT NULL
            AND t.timestamp >= ${startIso}::timestamptz
            AND t.timestamp <= ${endIso}::timestamptz
            AND (t.timestamp, t.id) < (${cursor.tsIso}::timestamptz, ${cursor.id}::bigint)
          ORDER BY t.timestamp DESC, t.id DESC
          LIMIT ${limit}
        `);

  const events: UaiEvent[] = [];
  for (const row of (rows.rows ?? []) as Record<string, unknown>[]) {
    const ev = mapRowToUaiEvent(row, spot);
    if (ev) events.push(ev);
  }
  return events;
}

/**
 * Session-to-date journal: full-session summary + one page of events (same DB rows as Layer 5).
 */
export async function fetchUaiSymbolEvents(args: {
  symbol: string;
  spot: number | null;
  limit?: number;
  cursor?: string | null;
}): Promise<UaiEventsPayload> {
  const sym = args.symbol.trim().toUpperCase();
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const spot =
    args.spot != null && Number.isFinite(args.spot) && args.spot > 0 ? args.spot : null;
  const decoded = parseEventsCursor(args.cursor ?? null);

  const session = await getScannerRthSessionToDateWindow();
  if (!session.active) {
    return {
      symbol: sym,
      windowMs: 0,
      session: { active: false, reason: session.reason },
      events: [],
      summary: emptySummary(),
      page: { limit, nextCursor: null, hasMore: false },
    };
  }

  const windowMs = Math.max(0, new Date(session.endIso).getTime() - new Date(session.startIso).getTime());
  const fetchLimit = Math.min(limit + 1, MAX_PAGE_LIMIT + 1);

  const [summary, rawPage] = await Promise.all([
    fetchUaiSymbolEventsSummarySql({
      sym,
      startIso: session.startIso,
      endIso: session.endIso,
      spot,
    }),
    fetchUaiSymbolEventsPageSql({
      sym,
      startIso: session.startIso,
      endIso: session.endIso,
      spot,
      limit: fetchLimit,
      cursor: decoded,
    }),
  ]);

  const hasMore = rawPage.length > limit;
  const events = hasMore ? rawPage.slice(0, limit) : rawPage;
  const last = events.length > 0 ? events[events.length - 1] : null;
  const nextCursor = hasMore && last != null ? encodeCursor(last.id, last.ts) : null;

  return {
    symbol: sym,
    windowMs,
    session: {
      active: true,
      sessionDateEt: session.sessionDateEtYmd,
      startIso: session.startIso,
      endIso: session.endIso,
    },
    events,
    summary,
    page: {
      limit,
      nextCursor,
      hasMore,
    },
  };
}
