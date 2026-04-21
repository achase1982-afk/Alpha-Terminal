import { db, optionsFlowPerStrikeTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";

export interface UnusualFlowFilters {
  minStrikes?: number;
  minVoiRatio?: number;
  minVolume?: number;
  skew?: "any" | "bullish" | "bearish" | "non_balanced";
}

export interface UnusualFlowStrike {
  strike: number;
  expiration: string;
  dte: number;
  optionType: "call" | "put";
  volume: number;
  openInterest: number;
  volOiRatio: number;
  iv: number | null;
  delta: number | null;
}

export interface UnusualFlowCandidate {
  symbol: string;
  asOfDate: string;
  score: number;
  scoreReason: string;
  unusualStrikeCount: number;
  unusualCallStrikes: number;
  unusualPutStrikes: number;
  unusualCallVolume: number;
  unusualPutVolume: number;
  totalCallVolume: number;
  totalPutVolume: number;
  putCallVolumeRatio: number;
  skew: "bullish" | "bearish" | "balanced";
  topByVoiRatio: UnusualFlowStrike[];
  topByVolume: UnusualFlowStrike[];
  largestPrintDescription: string;
  topVoiRatio: number;
}

export interface UnusualFlowScanResult {
  scanTimestamp: number;
  asOfDate: string | null;
  scannedSymbols: number;
  symbolsWithFlow: number;
  candidates: UnusualFlowCandidate[];
  filters: Required<UnusualFlowFilters>;
}

const DEFAULTS: Required<UnusualFlowFilters> = {
  minStrikes: 1,
  minVoiRatio: 3,
  minVolume: 500,
  skew: "any",
};

const MAX_AGE_CALENDAR_DAYS = 5;
const MIN_OI_FOR_VOI = 10;
const TOP_N = 5;

interface RawRow {
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
}

function isFresh(asOfDate: string): boolean {
  const asOf = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((today - asOf) / 86_400_000) <= MAX_AGE_CALENDAR_DAYS;
}

function rowToStrike(r: RawRow): UnusualFlowStrike {
  const vol = r.dailyVolume ?? 0;
  const oi = r.openInterest ?? 0;
  return {
    strike: r.strike,
    expiration: r.expiration,
    dte: r.dte ?? 0,
    optionType: r.optionType === "call" ? "call" : "put",
    volume: vol,
    openInterest: oi,
    volOiRatio: oi > 0 ? Math.round((vol / oi) * 100) / 100 : 0,
    iv: r.impliedVolatility,
    delta: r.delta,
  };
}

function summarizeForSymbol(
  rows: RawRow[],
  asOfDate: string,
  symbol: string,
  f: Required<UnusualFlowFilters>,
): UnusualFlowCandidate | null {
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  let unusualCallVolume = 0;
  let unusualPutVolume = 0;
  let unusualCallStrikes = 0;
  let unusualPutStrikes = 0;
  const unusual: Array<RawRow & { _voi: number }> = [];

  for (const r of rows) {
    const vol = r.dailyVolume ?? 0;
    const oi = r.openInterest ?? 0;
    if (r.optionType === "call") totalCallVolume += vol;
    else if (r.optionType === "put") totalPutVolume += vol;

    if (vol >= f.minVolume && oi >= MIN_OI_FOR_VOI) {
      const voi = vol / oi;
      if (voi >= f.minVoiRatio) {
        unusual.push({ ...r, _voi: voi });
        if (r.optionType === "call") {
          unusualCallStrikes++;
          unusualCallVolume += vol;
        } else if (r.optionType === "put") {
          unusualPutStrikes++;
          unusualPutVolume += vol;
        }
      }
    }
  }

  const unusualStrikeCount = unusual.length;
  if (unusualStrikeCount < f.minStrikes) return null;

  const totalUnusual = unusualCallVolume + unusualPutVolume;
  const callShare = totalUnusual > 0 ? unusualCallVolume / totalUnusual : 0.5;
  let skew: UnusualFlowCandidate["skew"];
  if (callShare >= 0.65) skew = "bullish";
  else if (callShare <= 0.35) skew = "bearish";
  else skew = "balanced";

  if (f.skew === "bullish" && skew !== "bullish") return null;
  if (f.skew === "bearish" && skew !== "bearish") return null;
  if (f.skew === "non_balanced" && skew === "balanced") return null;

  const topByVoi = [...unusual]
    .sort((a, b) => b._voi - a._voi)
    .slice(0, TOP_N)
    .map(r => rowToStrike(r));
  const topByVolume = [...unusual]
    .sort((a, b) => (b.dailyVolume ?? 0) - (a.dailyVolume ?? 0))
    .slice(0, TOP_N)
    .map(r => rowToStrike(r));

  const topVoi = topByVoi[0]?.volOiRatio ?? 0;
  const putCallVolumeRatio = totalCallVolume > 0
    ? Math.round((totalPutVolume / totalCallVolume) * 100) / 100
    : 0;

  // Score (0-100ish):
  //   strikes      : strikeCount × 7 (cap 50)
  //   topVOI       : log10(1 + topVoi) × 12 (cap 25)
  //   conviction   : skew non-balanced ? 10 : 0
  //   volume       : log10(1 + totalUnusual/1000) × 5 (cap 15)
  const strikePts = Math.min(50, unusualStrikeCount * 7);
  const voiPts = Math.min(25, Math.log10(1 + topVoi) * 12);
  const skewPts = skew !== "balanced" ? 10 : 0;
  const volPts = Math.min(15, Math.log10(1 + totalUnusual / 1000) * 5);
  const score = Math.round((strikePts + voiPts + skewPts + volPts) * 10) / 10;

  const top = topByVoi[0];
  const largestPrintDescription = top
    ? `${top.optionType.toUpperCase()} ${top.strike} ${top.expiration} (${top.dte}d) — ${top.volume.toLocaleString()} vol / ${top.openInterest.toLocaleString()} OI = ${top.volOiRatio.toFixed(1)}× VOI`
    : "";

  return {
    symbol,
    asOfDate,
    score,
    scoreReason: `strikes=${strikePts.toFixed(0)} voi=${voiPts.toFixed(1)} skew=${skewPts} vol=${volPts.toFixed(1)}`,
    unusualStrikeCount,
    unusualCallStrikes,
    unusualPutStrikes,
    unusualCallVolume,
    unusualPutVolume,
    totalCallVolume,
    totalPutVolume,
    putCallVolumeRatio,
    skew,
    topByVoiRatio: topByVoi,
    topByVolume,
    largestPrintDescription,
    topVoiRatio: topVoi,
  };
}

export async function scanUnusualFlow(
  symbols: string[],
  filters: UnusualFlowFilters = {},
): Promise<UnusualFlowScanResult> {
  const f: Required<UnusualFlowFilters> = { ...DEFAULTS, ...filters };
  const upper = symbols.map(s => s.toUpperCase());
  const result: UnusualFlowScanResult = {
    scanTimestamp: Date.now(),
    asOfDate: null,
    scannedSymbols: upper.length,
    symbolsWithFlow: 0,
    candidates: [],
    filters: f,
  };
  if (upper.length === 0) return result;

  try {
    const perSymbolDates = await db
      .select({
        sym: optionsFlowPerStrikeTable.underlyingSymbol,
        maxDate: sql<string>`max(${optionsFlowPerStrikeTable.date})`,
      })
      .from(optionsFlowPerStrikeTable)
      .where(inArray(optionsFlowPerStrikeTable.underlyingSymbol, upper))
      .groupBy(optionsFlowPerStrikeTable.underlyingSymbol);

    if (perSymbolDates.length === 0) return result;

    const symDateMap = new Map<string, string>();
    const allDates = new Set<string>();
    for (const r of perSymbolDates) {
      if (!isFresh(r.maxDate)) continue;
      symDateMap.set(r.sym, r.maxDate);
      allDates.add(r.maxDate);
    }
    if (symDateMap.size === 0) return result;

    const rows = await db
      .select()
      .from(optionsFlowPerStrikeTable)
      .where(and(
        inArray(optionsFlowPerStrikeTable.underlyingSymbol, [...symDateMap.keys()]),
        inArray(optionsFlowPerStrikeTable.date, [...allDates]),
      ));

    const bySymbol = new Map<string, RawRow[]>();
    for (const r of rows as unknown as RawRow[]) {
      if (symDateMap.get(r.underlyingSymbol) !== r.date) continue;
      let bucket = bySymbol.get(r.underlyingSymbol);
      if (!bucket) { bucket = []; bySymbol.set(r.underlyingSymbol, bucket); }
      bucket.push(r);
    }

    let mostRecent: string | null = null;
    for (const [sym, bucket] of bySymbol) {
      const asOf = symDateMap.get(sym)!;
      if (!mostRecent || asOf > mostRecent) mostRecent = asOf;
      const c = summarizeForSymbol(bucket, asOf, sym, f);
      if (c) result.candidates.push(c);
    }

    result.asOfDate = mostRecent;
    result.symbolsWithFlow = bySymbol.size;
    result.candidates.sort((a, b) => b.score - a.score);

    logger.info({
      requested: upper.length,
      withFlow: bySymbol.size,
      passed: result.candidates.length,
      filters: f,
    }, "Unusual flow scan complete");

    return result;
  } catch (err) {
    logger.warn({ err, symbolCount: upper.length }, "Unusual flow scan failed");
    return result;
  }
}
