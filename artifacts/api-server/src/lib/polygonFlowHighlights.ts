import { db, optionsFlowPerStrikeTable } from "@workspace/db";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { logger } from "./logger.js";

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

function summarize(rows: RawStrikeRow[]): Omit<PolygonFlowHighlights, "asOfDate"> {
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

/**
 * Fetch Polygon per-strike flow highlights for a single ticker on its most
 * recent stored date. Returns null if we have no Polygon data for the ticker.
 */
export async function getPolygonFlowHighlights(
  symbol: string,
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

    const summary = summarize(rows as unknown as RawStrikeRow[]);
    return { asOfDate, ...summary };
  } catch (err) {
    logger.warn({ err, symbol: sym }, "polygonFlowHighlights: lookup failed");
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
      out.set(sym, { asOfDate, ...summarize(bucket) });
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
