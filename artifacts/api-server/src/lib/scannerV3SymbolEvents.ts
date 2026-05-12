/**
 * GET /api/scanner/v3/symbol/:symbol/events — UAI-shaped rows from `options_flow_raw_trades`.
 */

import { db } from "@workspace/db";
import { sql } from "@workspace/db";
import {
  resolveScannerFlowWindowMs,
  SCANNER_FLOW_DEFAULT_WINDOW_MS,
} from "./scannerFlowContext.js";

const FLOW_WINDOW_MS_MIN = 60 * 60 * 1000;
const FLOW_WINDOW_MS_MAX = 7 * 24 * 60 * 60 * 1000;

const MAX_EVENTS_RETURNED = 500;

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

export type UaiEventsPayload = {
  symbol: string;
  windowMs: number;
  events: UaiEvent[];
  summary: UaiEventsSummary;
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

function parseWindowMsParam(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return SCANNER_FLOW_DEFAULT_WINDOW_MS;
  if (typeof raw !== "string") return SCANNER_FLOW_DEFAULT_WINDOW_MS;
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)(h|d|m)$/);
  if (!m) return SCANNER_FLOW_DEFAULT_WINDOW_MS;
  const n = Number(m[1]);
  const u = m[2];
  if (!Number.isFinite(n) || n <= 0) return SCANNER_FLOW_DEFAULT_WINDOW_MS;
  let ms: number;
  if (u === "h") ms = n * 60 * 60 * 1000;
  else if (u === "d") ms = n * 24 * 60 * 60 * 1000;
  else ms = n * 60 * 1000;
  return Math.min(Math.max(ms, FLOW_WINDOW_MS_MIN), FLOW_WINDOW_MS_MAX);
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
  const ts =
    tsRaw instanceof Date
      ? tsRaw.toISOString()
      : tsRaw != null && String(tsRaw).length > 0
        ? String(tsRaw)
        : "";
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

type StrikeAggKey = `${number}|${string}|${"C" | "P"}`;

function strikeAggKey(strike: number, expiration: string, callPut: "C" | "P"): StrikeAggKey {
  return `${strike}|${expiration}|${callPut}`;
}

function buildSummary(events: UaiEvent[], netDeltaDollar: number | null): UaiEventsSummary {
  let bullishNotional = 0;
  let bearishNotional = 0;
  let callNotional = 0;
  let putNotional = 0;

  const bullishMap = new Map<StrikeAggKey, { strike: number; expiration: string; callPut: "C" | "P"; notional: number }>();
  const bearishMap = new Map<StrikeAggKey, { strike: number; expiration: string; callPut: "C" | "P"; notional: number }>();

  for (const e of events) {
    if (e.callPut === "C") callNotional += e.notional;
    else putNotional += e.notional;

    if (e.direction === "bullish") {
      bullishNotional += e.notional;
      const k = strikeAggKey(e.strike, e.expiration, e.callPut);
      const cur = bullishMap.get(k);
      bullishMap.set(k, {
        strike: e.strike,
        expiration: e.expiration,
        callPut: e.callPut,
        notional: (cur?.notional ?? 0) + e.notional,
      });
    } else if (e.direction === "bearish") {
      bearishNotional += e.notional;
      const k = strikeAggKey(e.strike, e.expiration, e.callPut);
      const cur = bearishMap.get(k);
      bearishMap.set(k, {
        strike: e.strike,
        expiration: e.expiration,
        callPut: e.callPut,
        notional: (cur?.notional ?? 0) + e.notional,
      });
    }
  }

  const topBullishStrikes = [...bullishMap.values()]
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 3);
  const topBearishStrikes = [...bearishMap.values()]
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 3);

  return {
    totalEvents: events.length,
    bullishNotional,
    bearishNotional,
    netDeltaDollar,
    topBullishStrikes,
    topBearishStrikes,
    callNotional,
    putNotional,
  };
}

export function parseScannerSymbolEventsWindowMs(query: unknown): number {
  return parseWindowMsParam(query);
}

/**
 * Loads raw trades for one symbol in `[now - windowMs, now]` and shapes UAI events + summary.
 */
export async function fetchUaiSymbolEvents(args: {
  symbol: string;
  windowMs?: number;
  spot: number | null;
}): Promise<UaiEventsPayload> {
  const sym = args.symbol.trim().toUpperCase();
  const windowMs = resolveScannerFlowWindowMs({ windowMs: args.windowMs });
  const cutoffIso = new Date(Date.now() - windowMs).toISOString();

  const spot =
    args.spot != null && Number.isFinite(args.spot) && args.spot > 0 ? args.spot : null;

  const priceTuples =
    spot != null ? sql`(${sym}::text, ${spot}::double precision)` : sql`(${sym}::text, NULL::double precision)`;

  const rows = await db.execute(sql`
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
      AND t.timestamp >= ${cutoffIso}::timestamptz
    ORDER BY t.timestamp DESC
    LIMIT ${MAX_EVENTS_RETURNED}
  `);

  const events: UaiEvent[] = [];
  let netDeltaDollar: number | null = null;

  if (spot != null) {
    let net = 0;
    let hasDelta = false;
    for (const row of (rows.rows ?? []) as Record<string, unknown>[]) {
      const sideRaw = row.side != null ? String(row.side).trim().toLowerCase() : "";
      const sign =
        sideRaw === "ask" ? 1 : sideRaw === "bid" ? -1 : sideRaw === "mid" ? 0 : 0;
      const delta = numOrNull(row.strike_delta);
      const size = intOrZero(row.size);
      if (sign !== 0 && delta != null && Number.isFinite(delta) && size > 0) {
        hasDelta = true;
        net += sign * delta * size * 100 * spot;
      }
    }
    if (hasDelta) netDeltaDollar = Math.round(net * 100) / 100;
  }

  for (const row of (rows.rows ?? []) as Record<string, unknown>[]) {
    const ev = mapRowToUaiEvent(row, spot);
    if (ev) events.push(ev);
  }

  return {
    symbol: sym,
    windowMs,
    events,
    summary: buildSummary(events, netDeltaDollar),
  };
}
