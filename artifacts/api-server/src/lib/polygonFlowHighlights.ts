import { db, optionsFlowPerStrikeTable, optionsFlowExecPerStrikeTable, optionsFlowRawTradesTable } from "@workspace/db";
import { and, eq, inArray, sql, desc } from "@workspace/db";
import { logger } from "./logger.js";
import { logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";
import type { TapeBackfillStatus, TapeBackfillDiagnosticReason } from "./strategistTapeBackfill.js";

export interface FlowStrikeHighlight {
  strike: number;
  expiration: string;
  dte: number;
  optionType: "call" | "put";
  volume: number;
  openInterest: number;
  volOiRatio: number;
  iv: number | null;
  delta: number | null;
  vwap: number | null;
  mid: number | null;
}

/** Per-strike live rollup for the session (same date as EOD per-strike snapshot). */
export interface FlowExecStrikeRow {
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  sweepCount: number;
  blockCount: number;
  regularCount: number;
  sweepNotional: number;
  blockNotional: number;
  regularNotional: number;
  sweepVolume: number;
  blockVolume: number;
  regularVolume: number;
  lastEventTs: string | null;
}

/** Largest classified prints (session tape subset). */
export interface FlowTopPrintRow {
  timestamp: string | null;
  strike: number;
  expiration: string;
  optionType: "call" | "put";
  tradePrice: number;
  size: number;
  notional: number;
  isBlock: boolean;
  isSweep: boolean;
  side: "ask" | "bid" | "mid" | null;
  syntheticLegGroupId?: string | null;
  multiLegConfidence?: string | null;
  extras?: Record<string, unknown> | null;
}

/** Per-strike aggressor mix from session prints (ask=buyer-lean, bid=seller-lean). */
export interface FlowStrikeAggressorMix {
  strike: number;
  expiration: string;
  optionType: "call" | "put";
  askPct: number;
  bidPct: number;
  midPct: number;
  unknownPct: number;
  printCount: number;
}

export interface FlowSessionAggressorTotals {
  askCount: number;
  bidCount: number;
  midCount: number;
  unknownCount: number;
  totalPrints: number;
  /** (ask + bid + mid) / totalPrints as 0–100; 0 when totalPrints is 0. */
  knownPct: number;
  /** Sum of `options_flow_raw_trades.notional` for classified prints (USD premium). */
  askNotionalUsd: number;
  bidNotionalUsd: number;
  midNotionalUsd: number;
  unknownNotionalUsd: number;
}

export interface PolygonFlowTape {
  sessionDate: string;
  /** `live` = classified prints + rollup from the flow watcher; `eod_fallback` = synthesized from EOD per-strike snapshot when live tape rows are missing. */
  tapeKind?: "live" | "eod_fallback";
  /**
   * Where session-level aggressor counts / USD notionals were aggregated.
   * `live_raw_trades` = from `options_flow_raw_trades`; `eod_volume_only` = no classified prints, EOD-derived shape only.
   */
  sessionAggregateSource?: "live_raw_trades" | "eod_volume_only";
  /**
   * Why live tape is present or EOD synthesis was used. Set when Strategist
   * passes tape backfill status; see strategistTapeBackfill.TapeBackfillDiagnosticReason.
   */
  tapeBackfillReason?: TapeBackfillDiagnosticReason;
  execPerStrike: FlowExecStrikeRow[];
  topPrints: FlowTopPrintRow[];
  aggressorByStrike: FlowStrikeAggressorMix[];
  aggressorSessionTotals: FlowSessionAggressorTotals;
}

export interface PolygonFlowHighlights {
  asOfDate: string;
  totalCallVolume: number;
  totalPutVolume: number;
  putCallVolumeRatio: number;
  unusualStrikeCount: number;
  unusualCallVolume: number;
  unusualPutVolume: number;
  unusualSkew: "bullish" | "bearish" | "balanced" | "none";
  topByVolume: FlowStrikeHighlight[];
  topByVolOiRatio: FlowStrikeHighlight[];
  largestPrint: FlowStrikeHighlight | null;
  /** Live tape rollups for the same calendar session as asOfDate when rows exist. */
  sessionTape: PolygonFlowTape | null;
  /** When set, session tape was read for this NY session date (may differ from asOfDate). */
  sessionTapeDate?: string;
  /**
   * Row counts in DB for **tapeBackfill.sessionDate** (or asOfDate when capture status absent),
   * for invariant checks — independent of whether live tape was attached from that date.
   */
  sessionTapeLookupCounts?: {
    sessionDate: string;
    rawTradeRowCount: number;
    execPerStrikeRowCount: number;
  };
}

const MIN_VOLUME_FOR_VOI = 100;
const MIN_OI_FOR_VOI = 10;
const UNUSUAL_VOI_THRESHOLD = 3;
const UNUSUAL_MIN_VOLUME = 500;
const TOP_N = 5;

// Hard staleness ceiling — never apply Polygon flow data older than this many
// CALENDAR days as a real-time signal. With weekends/holidays this maps to
// ~3 trading days (the user-required ceiling). Stale data masquerading as
// real-time is worse than no signal at all.
const MAX_AGE_CALENDAR_DAYS = 5;

function isFresh(asOfDate: string, todayUtc: Date = new Date()): boolean {
  // asOfDate is YYYY-MM-DD UTC
  const asOf = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const today = new Date(`${todayUtc.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  const ageDays = Math.floor((today - asOf) / 86_400_000);
  return ageDays <= MAX_AGE_CALENDAR_DAYS;
}

function nyCalendarYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Prefer capture session date first so strategist tape aligns with options_flow_raw_trades inserts. */
function sessionTapeDatesToFetch(asOfDate: string, captureSessionDate?: string): string[] {
  const ny = nyCalendarYmd(new Date());
  const out: string[] = [];
  if (typeof captureSessionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(captureSessionDate)) {
    out.push(captureSessionDate);
  }
  if (asOfDate !== ny) out.push(asOfDate);
  out.push(ny);
  return [...new Set(out)];
}

/** Row counts for invariant / telemetry (same key as session tape: symbol + session calendar date). */
async function countFlowRowsForSession(
  symbol: string,
  sessionDate: string,
): Promise<{ rawTradeRowCount: number; execPerStrikeRowCount: number }> {
  const sym = symbol.toUpperCase();
  const [rawR, execR] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)` })
      .from(optionsFlowRawTradesTable)
      .where(
        and(
          eq(optionsFlowRawTradesTable.underlyingSymbol, sym),
          eq(optionsFlowRawTradesTable.date, sessionDate),
        ),
      ),
    db
      .select({ c: sql<number>`count(*)` })
      .from(optionsFlowExecPerStrikeTable)
      .where(
        and(
          eq(optionsFlowExecPerStrikeTable.underlyingSymbol, sym),
          eq(optionsFlowExecPerStrikeTable.date, sessionDate),
        ),
      ),
  ]);
  return {
    rawTradeRowCount: Number(rawR[0]?.c ?? 0),
    execPerStrikeRowCount: Number(execR[0]?.c ?? 0),
  };
}

interface RawStrikeRow {
  underlyingSymbol: string;
  date: string;
  optionType: string;
  strike: number;
  expiration: string;
  dte: number | null;
  dailyVolume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  avgTradePrice: number | null;
  mid: number | null;
}

function rowToHighlight(r: RawStrikeRow): FlowStrikeHighlight {
  const vol = r.dailyVolume ?? 0;
  const oi = r.openInterest ?? 0;
  const voi = oi > 0 ? vol / oi : 0;
  return {
    strike: r.strike,
    expiration: r.expiration,
    dte: r.dte ?? 0,
    optionType: r.optionType === "call" ? "call" : "put",
    volume: vol,
    openInterest: oi,
    volOiRatio: Math.round(voi * 100) / 100,
    iv: r.impliedVolatility,
    delta: r.delta,
    vwap: r.avgTradePrice,
    mid: r.mid,
  };
}

function summarize(rows: RawStrikeRow[]): Omit<PolygonFlowHighlights, "asOfDate" | "sessionTape"> {
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  let unusualCallVolume = 0;
  let unusualPutVolume = 0;

  const eligibleForVoi: Array<RawStrikeRow & { _voi: number }> = [];
  const unusual: RawStrikeRow[] = [];

  for (const r of rows) {
    const vol = r.dailyVolume ?? 0;
    const oi = r.openInterest ?? 0;
    if (r.optionType === "call") totalCallVolume += vol;
    else if (r.optionType === "put") totalPutVolume += vol;

    if (vol >= MIN_VOLUME_FOR_VOI && oi >= MIN_OI_FOR_VOI) {
      const voi = vol / oi;
      eligibleForVoi.push({ ...r, _voi: voi });
      if (voi >= UNUSUAL_VOI_THRESHOLD && vol >= UNUSUAL_MIN_VOLUME) {
        unusual.push(r);
        if (r.optionType === "call") unusualCallVolume += vol;
        else if (r.optionType === "put") unusualPutVolume += vol;
      }
    }
  }

  const byVolume = [...rows].sort((a, b) => (b.dailyVolume ?? 0) - (a.dailyVolume ?? 0)).slice(0, TOP_N);
  const byVoi = [...eligibleForVoi].sort((a, b) => b._voi - a._voi).slice(0, TOP_N);

  let unusualSkew: PolygonFlowHighlights["unusualSkew"] = "none";
  if (unusual.length > 0) {
    const callShare = unusualCallVolume / Math.max(1, unusualCallVolume + unusualPutVolume);
    if (callShare >= 0.65) unusualSkew = "bullish";
    else if (callShare <= 0.35) unusualSkew = "bearish";
    else unusualSkew = "balanced";
  }

  const putCallVolumeRatio = totalCallVolume > 0
    ? Math.round((totalPutVolume / totalCallVolume) * 100) / 100
    : 0;

  return {
    totalCallVolume,
    totalPutVolume,
    putCallVolumeRatio,
    unusualStrikeCount: unusual.length,
    unusualCallVolume,
    unusualPutVolume,
    unusualSkew,
    topByVolume: byVolume.map(rowToHighlight),
    topByVolOiRatio: byVoi.map(rowToHighlight),
    largestPrint: byVolume.length > 0 ? rowToHighlight(byVolume[0]) : null,
  };
}

const TOP_PRINTS_LIMIT = 30;

function expToIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  return String(d).slice(0, 10);
}

function tsToIso(t: unknown): string | null {
  if (t instanceof Date) return t.toISOString();
  if (typeof t === "string") return t;
  return null;
}

function dedupeTopPrintRows(rows: FlowTopPrintRow[]): FlowTopPrintRow[] {
  const seen = new Set<string>();
  const out: FlowTopPrintRow[] = [];
  for (const r of rows) {
    const k = `${r.timestamp ?? ""}|${r.strike}|${r.expiration}|${r.optionType}|${r.tradePrice}|${r.size}|${String(r.side)}|${r.isBlock}|${r.isSweep}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * Live session tape: exec rollups, top prints, aggressor mix (same `date` as EOD per-strike row).
 */
async function fetchSessionTape(symbol: string, sessionDate: string): Promise<PolygonFlowTape | null> {
  const sym = symbol.toUpperCase();
  try {
    const execRows = await db
      .select()
      .from(optionsFlowExecPerStrikeTable)
      .where(and(
        eq(optionsFlowExecPerStrikeTable.underlyingSymbol, sym),
        eq(optionsFlowExecPerStrikeTable.date, sessionDate),
      ));

    const topPrints = await db
      .select({
        timestamp: optionsFlowRawTradesTable.timestamp,
        strike: optionsFlowRawTradesTable.strike,
        expiration: optionsFlowRawTradesTable.expiration,
        optionType: optionsFlowRawTradesTable.optionType,
        tradePrice: optionsFlowRawTradesTable.tradePrice,
        size: optionsFlowRawTradesTable.size,
        notional: optionsFlowRawTradesTable.notional,
        isBlock: optionsFlowRawTradesTable.isBlock,
        isSweep: optionsFlowRawTradesTable.isSweep,
        side: optionsFlowRawTradesTable.side,
        syntheticLegGroupId: optionsFlowRawTradesTable.syntheticLegGroupId,
        multiLegConfidence: optionsFlowRawTradesTable.multiLegConfidence,
        extras: optionsFlowRawTradesTable.extras,
      })
      .from(optionsFlowRawTradesTable)
      .where(and(
        eq(optionsFlowRawTradesTable.underlyingSymbol, sym),
        eq(optionsFlowRawTradesTable.date, sessionDate),
      ))
      .orderBy(desc(optionsFlowRawTradesTable.notional))
      .limit(TOP_PRINTS_LIMIT);

    const allPrints = await db
      .select({
        strike: optionsFlowRawTradesTable.strike,
        expiration: optionsFlowRawTradesTable.expiration,
        optionType: optionsFlowRawTradesTable.optionType,
        side: optionsFlowRawTradesTable.side,
        notional: optionsFlowRawTradesTable.notional,
      })
      .from(optionsFlowRawTradesTable)
      .where(and(
        eq(optionsFlowRawTradesTable.underlyingSymbol, sym),
        eq(optionsFlowRawTradesTable.date, sessionDate),
      ));

    if (execRows.length === 0 && topPrints.length === 0 && allPrints.length === 0) {
      return null;
    }

    const strikeKey = (strike: number, exp: string, ot: string) => `${strike}|${exp}|${ot}`;

    const aggMap = new Map<string, { ask: number; bid: number; mid: number; unknown: number; total: number }>();
    for (const p of allPrints) {
      const exp = expToIso(p.expiration);
      const ot = (p.optionType === "call" ? "call" : "put") as "call" | "put";
      const k = strikeKey(p.strike, exp, ot);
      let g = aggMap.get(k);
      if (!g) {
        g = { ask: 0, bid: 0, mid: 0, unknown: 0, total: 0 };
        aggMap.set(k, g);
      }
      g.total++;
      const s = p.side;
      if (s === "ask") g.ask++;
      else if (s === "bid") g.bid++;
      else if (s === "mid") g.mid++;
      else g.unknown++;
    }

    const aggressorByStrike: FlowStrikeAggressorMix[] = [];
    for (const [k, g] of aggMap) {
      const [strikeStr, exp, ot] = k.split("|");
      const strike = Number(strikeStr);
      const t = g.total;
      if (t === 0) continue;
      aggressorByStrike.push({
        strike,
        expiration: exp,
        optionType: ot === "call" ? "call" : "put",
        askPct: Math.round((g.ask / t) * 1000) / 10,
        bidPct: Math.round((g.bid / t) * 1000) / 10,
        midPct: Math.round((g.mid / t) * 1000) / 10,
        unknownPct: Math.round((g.unknown / t) * 1000) / 10,
        printCount: t,
      });
    }
    aggressorByStrike.sort((a, b) => b.printCount - a.printCount);
    const aggressorByStrikeFiltered = aggressorByStrike.filter((a) => a.printCount >= 10);

    let askCount = 0;
    let bidCount = 0;
    let midCount = 0;
    let unknownCount = 0;
    let askNotionalUsd = 0;
    let bidNotionalUsd = 0;
    let midNotionalUsd = 0;
    let unknownNotionalUsd = 0;
    for (const p of allPrints) {
      const n = typeof p.notional === "number" && Number.isFinite(p.notional) ? p.notional : 0;
      if (p.side === "ask") {
        askCount++;
        askNotionalUsd += n;
      } else if (p.side === "bid") {
        bidCount++;
        bidNotionalUsd += n;
      } else if (p.side === "mid") {
        midCount++;
        midNotionalUsd += n;
      } else {
        unknownCount++;
        unknownNotionalUsd += n;
      }
    }

    const totalPrints = allPrints.length;
    const knownPct =
      totalPrints > 0
        ? Math.round(((askCount + bidCount + midCount) / totalPrints) * 1000) / 10
        : 0;

    const execPerStrike: FlowExecStrikeRow[] = execRows.map((r) => ({
      optionType: r.optionType === "call" ? "call" : "put",
      strike: r.strike,
      expiration: expToIso(r.expiration),
      sweepCount: r.sweepCount,
      blockCount: r.blockCount,
      regularCount: r.regularCount,
      sweepNotional: r.sweepNotional,
      blockNotional: r.blockNotional,
      regularNotional: r.regularNotional,
      sweepVolume: r.sweepVolume,
      blockVolume: r.blockVolume,
      regularVolume: r.regularVolume,
      lastEventTs: r.lastEventTs ? (r.lastEventTs instanceof Date ? r.lastEventTs.toISOString() : String(r.lastEventTs)) : null,
    }));

    const topMappedRaw: FlowTopPrintRow[] = topPrints.map((r) => ({
      timestamp: tsToIso(r.timestamp),
      strike: r.strike,
      expiration: expToIso(r.expiration),
      optionType: r.optionType === "call" ? "call" : "put",
      tradePrice: r.tradePrice ?? 0,
      size: r.size ?? 0,
      notional: r.notional ?? 0,
      isBlock: Boolean(r.isBlock),
      isSweep: Boolean(r.isSweep),
      side: r.side === "ask" || r.side === "bid" || r.side === "mid" ? r.side : null,
      syntheticLegGroupId: r.syntheticLegGroupId ?? null,
      multiLegConfidence: r.multiLegConfidence ?? null,
      extras: r.extras && typeof r.extras === "object" ? (r.extras as Record<string, unknown>) : null,
    }));
    const topMapped = dedupeTopPrintRows(topMappedRaw);

    return {
      sessionDate,
      tapeKind: "live",
      sessionAggregateSource: "live_raw_trades",
      execPerStrike,
      topPrints: topMapped,
      aggressorByStrike: aggressorByStrikeFiltered,
      aggressorSessionTotals: {
        askCount,
        bidCount,
        midCount,
        unknownCount,
        totalPrints,
        knownPct,
        askNotionalUsd,
        bidNotionalUsd,
        midNotionalUsd,
        unknownNotionalUsd,
      },
    };
  } catch (err) {
    logFlowPipelineWarn(
      "session_tape_select",
      "polygonFlowHighlights: session tape lookup failed",
      { err, symbol: sym, sessionDate },
    );
    return null;
  }
}

function mapTapeBackfillToSessionContext(
  tape: TapeBackfillStatus | undefined,
  usedEodFallback: boolean,
): TapeBackfillDiagnosticReason | undefined {
  if (!tape) {
    return usedEodFallback ? "skipped_other" : undefined;
  }
  if (usedEodFallback) {
    const r = tape.tapeBackfillReason;
    if (r === "already_persisted") return undefined;
    if (
      r === "empty_after_filter"
      || r === "empty_polygon_response"
      || r === "polygon_error"
      || r === "timeout_no_inserts"
    ) {
      return r;
    }
    if (tape.status === "skipped" && tape.reason === "no_api_key") return "skipped_no_api_key";
    if (tape.status === "skipped" && tape.reason === "outside_rth") return "skipped_outside_rth";
    if (tape.status === "skipped") return "skipped_other";
    return "skipped_other";
  }
  return tape.tapeBackfillReason;
}

/**
 * When the live classified-print pipeline has no rows for this symbol/date,
 * synthesize a non-null tape from EOD per-strike volume so downstream desks
 * still receive a consistent shape (zeros for sweep/block; no aggressor).
 */
function buildEodFallbackSessionTape(
  sessionDate: string,
  rows: RawStrikeRow[],
  tapeBackfill?: TapeBackfillStatus,
): PolygonFlowTape | null {
  const withVol = rows.filter((r) => (r.dailyVolume ?? 0) > 0);
  if (withVol.length === 0) return null;

  const execPerStrike: FlowExecStrikeRow[] = withVol.map((r) => {
    const v = r.dailyVolume ?? 0;
    const mid = r.mid;
    const regularNotional =
      mid != null && v > 0 ? Math.round(Math.abs(mid * v * 100) * 100) / 100 : 0;
    return {
      optionType: r.optionType === "call" ? "call" : "put",
      strike: r.strike,
      expiration: expToIso(r.expiration),
      sweepCount: 0,
      blockCount: 0,
      regularCount: 0,
      sweepNotional: 0,
      blockNotional: 0,
      regularNotional,
      sweepVolume: 0,
      blockVolume: 0,
      regularVolume: v,
      lastEventTs: null,
    };
  });

  const topSource = [...withVol].sort((a, b) => (b.dailyVolume ?? 0) - (a.dailyVolume ?? 0)).slice(0, TOP_PRINTS_LIMIT);
  const topPrintsRaw: FlowTopPrintRow[] = topSource.map((r) => {
    const mid = r.mid;
    const tradePrice = r.avgTradePrice ?? mid ?? 0;
    const v = r.dailyVolume ?? 0;
    const notional =
      mid != null && v > 0 ? Math.round(Math.abs(mid * v * 100) * 100) / 100 : 0;
    return {
      timestamp: null,
      strike: r.strike,
      expiration: expToIso(r.expiration),
      optionType: r.optionType === "call" ? "call" : "put",
      tradePrice,
      size: v,
      notional,
      isBlock: false,
      isSweep: false,
      side: null,
    };
  });
  const topPrints = dedupeTopPrintRows(topPrintsRaw);

  const byVolDesc = [...withVol].sort((a, b) => (b.dailyVolume ?? 0) - (a.dailyVolume ?? 0));
  const aggressorByStrikeRaw: FlowStrikeAggressorMix[] = byVolDesc.map((r) => ({
    strike: r.strike,
    expiration: expToIso(r.expiration),
    optionType: r.optionType === "call" ? "call" : "put",
    askPct: 0,
    bidPct: 0,
    midPct: 0,
    unknownPct: 100,
    printCount: 1,
  }));
  const aggressorByStrike = aggressorByStrikeRaw.filter((a) => a.printCount >= 10);

  const totalPrints = withVol.length;
  const knownPct = 0;

  return {
    sessionDate,
    tapeKind: "eod_fallback",
    sessionAggregateSource: "eod_volume_only",
    tapeBackfillReason: mapTapeBackfillToSessionContext(tapeBackfill, true),
    execPerStrike,
    topPrints,
    aggressorByStrike,
    aggressorSessionTotals: {
      askCount: 0,
      bidCount: 0,
      midCount: 0,
      unknownCount: totalPrints,
      totalPrints,
      knownPct: 0,
      askNotionalUsd: 0,
      bidNotionalUsd: 0,
      midNotionalUsd: 0,
      unknownNotionalUsd: 0,
    },
  };
}

/**
 * Fetch Polygon per-strike flow highlights for a single ticker on its most
 * recent stored date. Returns null if we have no Polygon data for the ticker.
 */
export async function getPolygonFlowHighlights(
  symbol: string,
  tapeBackfill?: TapeBackfillStatus,
): Promise<PolygonFlowHighlights | null> {
  const sym = symbol.toUpperCase();
  try {
    const latest = await db
      .select({ d: sql<string>`max(${optionsFlowPerStrikeTable.date})` })
      .from(optionsFlowPerStrikeTable)
      .where(eq(optionsFlowPerStrikeTable.underlyingSymbol, sym));
    const asOfDate = latest[0]?.d;
    if (!asOfDate) return null;
    if (!isFresh(asOfDate)) {
      logger.warn({ symbol: sym, asOfDate, maxAgeCalendarDays: MAX_AGE_CALENDAR_DAYS },
        "polygonFlowHighlights: data too stale — returning null");
      return null;
    }

    const rows = await db
      .select()
      .from(optionsFlowPerStrikeTable)
      .where(and(
        eq(optionsFlowPerStrikeTable.underlyingSymbol, sym),
        eq(optionsFlowPerStrikeTable.date, asOfDate),
      ));
    if (rows.length === 0) return null;

    const rawRows = rows as unknown as RawStrikeRow[];
    const summary = summarize(rawRows);
    const lookupSessionDate = tapeBackfill?.sessionDate ?? asOfDate;
    const counted = await countFlowRowsForSession(sym, lookupSessionDate);
    const sessionTapeLookupCounts = {
      sessionDate: lookupSessionDate,
      rawTradeRowCount: counted.rawTradeRowCount,
      execPerStrikeRowCount: counted.execPerStrikeRowCount,
    };

    let sessionTape: PolygonFlowTape | null = null;
    let sessionTapeDate: string | undefined;
    for (const d of sessionTapeDatesToFetch(asOfDate, tapeBackfill?.sessionDate)) {
      const st = await fetchSessionTape(sym, d);
      if (st) {
        sessionTape = {
          ...st,
          tapeBackfillReason: mapTapeBackfillToSessionContext(tapeBackfill, false),
        };
        sessionTapeDate = d;
        break;
      }
    }

    logger.info(
      {
        symbol: sym,
        sessionDate: lookupSessionDate,
        occCount: tapeBackfill?.occRequested ?? null,
        rawTradeRowCount: sessionTapeLookupCounts.rawTradeRowCount,
        execPerStrikeRowCount: sessionTapeLookupCounts.execPerStrikeRowCount,
        willFallback: !sessionTape,
      },
      sessionTape
        ? "polygonFlowHighlights: session tape lookup gate"
        : "polygonFlowHighlights: session tape lookup gate (falling back to EOD synthesis)",
    );

    if (!sessionTape) {
      sessionTape = buildEodFallbackSessionTape(asOfDate, rawRows, tapeBackfill);
    }
    return { asOfDate, ...summary, sessionTape, sessionTapeDate, sessionTapeLookupCounts };
  } catch (err) {
    logFlowPipelineWarn(
      "flow_highlights_lookup",
      "polygonFlowHighlights: lookup failed",
      { err, symbol: sym },
    );
    return null;
  }
}

/**
 * Bulk fetch Polygon per-strike flow highlights for a set of tickers — used
 * by the scanner so it can score unusual options activity in a single pass.
 * Each ticker uses its own most-recent stored date.
 */
export async function getPolygonFlowHighlightsBulk(
  symbols: string[],
): Promise<Map<string, PolygonFlowHighlights>> {
  const out = new Map<string, PolygonFlowHighlights>();
  if (symbols.length === 0) return out;
  const upperSymbols = symbols.map(s => s.toUpperCase());

  try {
    const perSymbolDates = await db
      .select({
        sym: optionsFlowPerStrikeTable.underlyingSymbol,
        maxDate: sql<string>`max(${optionsFlowPerStrikeTable.date})`,
      })
      .from(optionsFlowPerStrikeTable)
      .where(inArray(optionsFlowPerStrikeTable.underlyingSymbol, upperSymbols))
      .groupBy(optionsFlowPerStrikeTable.underlyingSymbol);

    if (perSymbolDates.length === 0) return out;

    const symDateMap = new Map<string, string>();
    const allDates = new Set<string>();
    let staleCount = 0;
    for (const r of perSymbolDates) {
      if (!isFresh(r.maxDate)) { staleCount++; continue; }
      symDateMap.set(r.sym, r.maxDate);
      allDates.add(r.maxDate);
    }
    if (staleCount > 0) {
      logger.warn({ staleCount, total: perSymbolDates.length, maxAgeCalendarDays: MAX_AGE_CALENDAR_DAYS },
        "polygonFlowHighlights: dropped stale tickers from bulk lookup");
    }
    if (symDateMap.size === 0) return out;

    const rows = await db
      .select()
      .from(optionsFlowPerStrikeTable)
      .where(and(
        inArray(optionsFlowPerStrikeTable.underlyingSymbol, [...symDateMap.keys()]),
        inArray(optionsFlowPerStrikeTable.date, [...allDates]),
      ));

    const bySymbol = new Map<string, RawStrikeRow[]>();
    for (const r of rows as unknown as RawStrikeRow[]) {
      if (symDateMap.get(r.underlyingSymbol) !== r.date) continue;
      let bucket = bySymbol.get(r.underlyingSymbol);
      if (!bucket) { bucket = []; bySymbol.set(r.underlyingSymbol, bucket); }
      bucket.push(r);
    }

    for (const [sym, bucket] of bySymbol) {
      const asOfDate = symDateMap.get(sym)!;
      const summary = summarize(bucket);
      let sessionTape: PolygonFlowTape | null = null;
      let sessionTapeDate: string | undefined;
      for (const d of sessionTapeDatesToFetch(asOfDate)) {
        const st = await fetchSessionTape(sym, d);
        if (st) {
          sessionTape = st;
          sessionTapeDate = d;
          break;
        }
      }
      if (!sessionTape) {
        sessionTape = buildEodFallbackSessionTape(asOfDate, bucket);
        if (sessionTape) {
          logger.info({ symbol: sym, asOfDate }, "polygonFlowHighlights: using EOD fallback session tape (no live flow rows)");
        }
      }
      out.set(sym, { asOfDate, ...summary, sessionTape, sessionTapeDate });
    }

    logger.info({
      requested: symbols.length,
      withFlow: out.size,
      sampleAsOf: perSymbolDates[0]?.maxDate ?? null,
    }, "polygonFlowHighlights: bulk lookup");

    return out;
  } catch (err) {
    logger.warn({ err, symbolCount: symbols.length }, "polygonFlowHighlights: bulk lookup failed");
    return out;
  }
}

/**
 * Lightweight scanner-side scoring helper: returns 0-10 unusual flow bonus
 * based on the number of unusual strikes and their skew. Designed to sit on
 * top of the existing FLOW score (which is already capped at 25), without
 * re-engineering the scanner weight scheme.
 */
export function unusualFlowBonusPoints(h: PolygonFlowHighlights | null): number {
  if (!h || h.unusualStrikeCount === 0) return 0;
  let pts = 0;
  if (h.unusualStrikeCount >= 1) pts = 3;
  if (h.unusualStrikeCount >= 3) pts = 6;
  if (h.unusualStrikeCount >= 6) pts = 10;
  // Reward directional conviction — penalize fully-balanced flow slightly
  if (h.unusualSkew === "balanced") pts = Math.max(0, pts - 2);
  return pts;
}

export { desc };
