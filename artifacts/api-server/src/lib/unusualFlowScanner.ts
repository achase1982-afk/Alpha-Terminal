import { db, optionsFlowExecPerStrikeTable, optionsFlowPerStrikeTable } from "@workspace/db";
import { and, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";

export interface UnusualFlowFilters {
  minStrikes?: number;
  minVoiRatio?: number;
  minVolume?: number;
  skew?: "any" | "bullish" | "bearish" | "non_balanced";
  excludeIndexes?: boolean;
  minDte?: number;
  minNotional?: number; // dollars per strike (vol × mid × 100)
  // Phase 1 execution-pattern filters (sweep/block classification from
  // the live watcher, populated via options_flow_exec_per_strike).
  includeSweeps?: boolean;
  includeBlocks?: boolean;
  includeRegular?: boolean;
  minSweepCount?: number;
  minBlockCount?: number;
}

export interface UnusualFlowExecSummary {
  sweepCount: number;
  blockCount: number;
  regularCount: number;
  sweepNotional: number;
  blockNotional: number;
  regularNotional: number;
}

export interface UnusualFlowStrike {
  strike: number;
  expiration: string;
  dte: number;
  optionType: "call" | "put";
  volume: number;
  openInterest: number;
  volOiRatio: number;
  notional: number;
  iv: number | null;
  delta: number | null;
  exec: UnusualFlowExecSummary;
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
  unusualTotalVolume: number;
  unusualTotalNotional: number;
  totalCallVolume: number;
  totalPutVolume: number;
  putCallVolumeRatio: number;
  skew: "bullish" | "bearish" | "balanced";
  topByVoiRatio: UnusualFlowStrike[];
  topByNotional: UnusualFlowStrike[];
  largestPrintDescription: string;
  topVoiRatio: number;
  avgDte: number;
  // Phase 1 execution-pattern aggregates across this ticker's unusual strikes.
  exec: UnusualFlowExecSummary;
  // Aggressor side classification — Phase 2 (NBBO subscription required).
  aggressorAvailable: false;
}

export interface UnusualFlowScanResult {
  scanTimestamp: number;
  asOfDate: string | null;
  scannedSymbols: number;
  symbolsWithFlow: number;
  excludedIndexes: number;
  candidates: UnusualFlowCandidate[];
  filters: Required<UnusualFlowFilters>;
}

const DEFAULTS: Required<UnusualFlowFilters> = {
  minStrikes: 1,
  minVoiRatio: 3,
  minVolume: 500,
  skew: "any",
  excludeIndexes: true,
  minDte: 3,        // excludes 0-2DTE (retail lottos + dealer hedging)
  minNotional: 250_000, // $250k+ per strike ⇒ institutional position size
  includeSweeps: true,
  includeBlocks: true,
  includeRegular: true,
  minSweepCount: 0,
  minBlockCount: 0,
};

const EMPTY_EXEC: UnusualFlowExecSummary = {
  sweepCount: 0, blockCount: 0, regularCount: 0,
  sweepNotional: 0, blockNotional: 0, regularNotional: 0,
};

interface ExecRow {
  underlyingSymbol: string;
  date: string;
  optionType: string;
  strike: number;
  expiration: string;
  sweepCount: number;
  blockCount: number;
  regularCount: number;
  sweepNotional: number;
  blockNotional: number;
  regularNotional: number;
}

function execKey(sym: string, optType: string, strike: number, exp: string): string {
  return `${sym}|${optType}|${strike}|${exp}`;
}

// Index ETFs / index products — overwhelmingly noisy because of dealer
// hedging, 0DTE flow, and vol products. Excluded by default; user can
// re-enable to see them.
const INDEX_SYMBOLS = new Set([
  // Broad index ETFs
  "SPY", "QQQ", "IWM", "DIA", "VOO", "IVV", "VTI",
  // Index products
  "SPX", "NDX", "RUT", "XSP",
  // Vol products
  "VIX", "VXX", "UVXY", "SVXY", "VIXY",
  // Sector SPDRs
  "XLE", "XLF", "XLK", "XLY", "XLP", "XLV", "XLI", "XLU", "XLB", "XLC", "XLRE",
  // Levered/inverse
  "SQQQ", "TQQQ", "SOXL", "SOXS", "SPXL", "SPXS", "TNA", "TZA",
  // Treasury / bond
  "TLT", "HYG", "LQD", "IEF",
  // Other heavy-flow ETFs
  "EEM", "EFA", "GLD", "SLV", "USO", "ARKK",
]);

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
  mid: number | null;
  impliedVolatility: number | null;
  delta: number | null;
}

type RowWithExec = RawRow & { _exec: UnusualFlowExecSummary };

function isFresh(asOfDate: string): boolean {
  const asOf = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((today - asOf) / 86_400_000) <= MAX_AGE_CALENDAR_DAYS;
}

function rowToStrike(r: RowWithExec): UnusualFlowStrike {
  const vol = r.dailyVolume ?? 0;
  const oi = r.openInterest ?? 0;
  const mid = r.mid ?? 0;
  return {
    strike: r.strike,
    expiration: r.expiration,
    dte: r.dte ?? 0,
    optionType: r.optionType === "call" ? "call" : "put",
    volume: vol,
    openInterest: oi,
    volOiRatio: oi > 0 ? Math.round((vol / oi) * 100) / 100 : 0,
    notional: Math.round(vol * mid * 100),
    iv: r.impliedVolatility,
    delta: r.delta,
    exec: r._exec,
  };
}

function summarizeForSymbol(
  rows: RawRow[],
  asOfDate: string,
  symbol: string,
  f: Required<UnusualFlowFilters>,
  execMap: Map<string, UnusualFlowExecSummary>,
): UnusualFlowCandidate | null {
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  let unusualCallVolume = 0;
  let unusualPutVolume = 0;
  let unusualCallStrikes = 0;
  let unusualPutStrikes = 0;
  let unusualTotalNotional = 0;
  let dteSum = 0;
  const tickerExec: UnusualFlowExecSummary = { ...EMPTY_EXEC };
  const unusual: Array<RowWithExec & { _voi: number; _notional: number }> = [];

  for (const r of rows) {
    const vol = r.dailyVolume ?? 0;
    const oi = r.openInterest ?? 0;
    const mid = r.mid ?? 0;
    const dte = r.dte ?? 0;
    if (r.optionType === "call") totalCallVolume += vol;
    else if (r.optionType === "put") totalPutVolume += vol;

    if (vol < f.minVolume || oi < MIN_OI_FOR_VOI) continue;
    if (dte < f.minDte) continue;
    const voi = vol / oi;
    if (voi < f.minVoiRatio) continue;
    const notional = vol * mid * 100;
    if (notional < f.minNotional) continue;

    const exec = execMap.get(execKey(symbol, r.optionType, r.strike, r.expiration)) ?? EMPTY_EXEC;

    // Per-strike execution-pattern filters. Apply only if ANY classified
    // event exists; strikes with no recorded prints are admitted (they
    // belong to the daily-aggregate signal, not the live watcher).
    const hasAnyEvent = exec.sweepCount + exec.blockCount + exec.regularCount > 0;
    if (hasAnyEvent) {
      const matchesType =
        (f.includeSweeps && exec.sweepCount > 0) ||
        (f.includeBlocks && exec.blockCount > 0) ||
        (f.includeRegular && exec.regularCount > 0);
      if (!matchesType) continue;
    }

    unusual.push({ ...r, _voi: voi, _notional: notional, _exec: exec });
    unusualTotalNotional += notional;
    dteSum += dte;
    tickerExec.sweepCount += exec.sweepCount;
    tickerExec.blockCount += exec.blockCount;
    tickerExec.regularCount += exec.regularCount;
    tickerExec.sweepNotional += exec.sweepNotional;
    tickerExec.blockNotional += exec.blockNotional;
    tickerExec.regularNotional += exec.regularNotional;
    if (r.optionType === "call") {
      unusualCallStrikes++;
      unusualCallVolume += vol;
    } else if (r.optionType === "put") {
      unusualPutStrikes++;
      unusualPutVolume += vol;
    }
  }

  // Ticker-level min-count gates.
  if (tickerExec.sweepCount < f.minSweepCount) return null;
  if (tickerExec.blockCount < f.minBlockCount) return null;

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
  const topByNotional = [...unusual]
    .sort((a, b) => b._notional - a._notional)
    .slice(0, TOP_N)
    .map(r => rowToStrike(r));

  const topVoi = topByVoi[0]?.volOiRatio ?? 0;
  const putCallVolumeRatio = totalCallVolume > 0
    ? Math.round((totalPutVolume / totalCallVolume) * 100) / 100
    : 0;
  const avgDte = unusualStrikeCount > 0 ? Math.round(dteSum / unusualStrikeCount) : 0;

  // Score (0-100ish):
  //   strikes      : strikeCount × 6 (cap 40)
  //   topVOI       : log10(1 + topVoi) × 10 (cap 22)
  //   conviction   : skew non-balanced ? 10 : 0
  //   notional     : log10(1 + totalNotional/100k) × 8 (cap 20)
  //   tenor bonus  : avgDte ≥ 14 ? 8 : avgDte ≥ 7 ? 4 : 0
  //   exec bonus   : sweep+block w/ direction = +12; regular-only = -6
  const strikePts = Math.min(40, unusualStrikeCount * 6);
  const voiPts = Math.min(22, Math.log10(1 + topVoi) * 10);
  const skewPts = skew !== "balanced" ? 10 : 0;
  const notionalPts = Math.min(20, Math.log10(1 + unusualTotalNotional / 100_000) * 8);
  const tenorPts = avgDte >= 14 ? 8 : avgDte >= 7 ? 4 : 0;
  const sweepOrBlock = tickerExec.sweepCount + tickerExec.blockCount;
  const totalEvents = sweepOrBlock + tickerExec.regularCount;
  let execPts = 0;
  if (sweepOrBlock > 0 && skew !== "balanced") execPts = 12;
  else if (sweepOrBlock > 0) execPts = 6;
  else if (totalEvents > 0 && tickerExec.regularCount === totalEvents) execPts = -6;
  const score = Math.round((strikePts + voiPts + skewPts + notionalPts + tenorPts + execPts) * 10) / 10;

  const top = topByNotional[0];
  const largestPrintDescription = top
    ? `${top.optionType.toUpperCase()} ${top.strike} ${top.expiration} (${top.dte}d) — ${top.volume.toLocaleString()} vol · $${(top.notional / 1_000_000).toFixed(2)}M notional · ${top.volOiRatio.toFixed(1)}× VOI`
    : "";

  return {
    symbol,
    asOfDate,
    score,
    scoreReason: `strk=${strikePts.toFixed(0)} voi=${voiPts.toFixed(1)} skew=${skewPts} notl=${notionalPts.toFixed(1)} tnr=${tenorPts} exec=${execPts}`,
    unusualStrikeCount,
    unusualCallStrikes,
    unusualPutStrikes,
    unusualCallVolume,
    unusualPutVolume,
    unusualTotalVolume: totalUnusual,
    unusualTotalNotional: Math.round(unusualTotalNotional),
    totalCallVolume,
    totalPutVolume,
    putCallVolumeRatio,
    skew,
    topByVoiRatio: topByVoi,
    topByNotional,
    largestPrintDescription,
    topVoiRatio: topVoi,
    avgDte,
    exec: {
      sweepCount: tickerExec.sweepCount,
      blockCount: tickerExec.blockCount,
      regularCount: tickerExec.regularCount,
      sweepNotional: Math.round(tickerExec.sweepNotional),
      blockNotional: Math.round(tickerExec.blockNotional),
      regularNotional: Math.round(tickerExec.regularNotional),
    },
    aggressorAvailable: false,
  };
}

export async function scanUnusualFlow(
  symbols: string[],
  filters: UnusualFlowFilters = {},
): Promise<UnusualFlowScanResult> {
  const f: Required<UnusualFlowFilters> = { ...DEFAULTS, ...filters };
  const upperAll = symbols.map(s => s.toUpperCase());
  const excluded = f.excludeIndexes
    ? upperAll.filter(s => INDEX_SYMBOLS.has(s)).length
    : 0;
  const upper = f.excludeIndexes
    ? upperAll.filter(s => !INDEX_SYMBOLS.has(s))
    : upperAll;

  const result: UnusualFlowScanResult = {
    scanTimestamp: Date.now(),
    asOfDate: null,
    scannedSymbols: upperAll.length,
    symbolsWithFlow: 0,
    excludedIndexes: excluded,
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

    // Phase 1: pull execution-pattern rollups for the same (symbol, date)
    // pairs. Left-join in memory because dates may differ per symbol.
    const execMap = new Map<string, UnusualFlowExecSummary>();
    try {
      const execRows = await db
        .select()
        .from(optionsFlowExecPerStrikeTable)
        .where(and(
          inArray(optionsFlowExecPerStrikeTable.underlyingSymbol, [...symDateMap.keys()]),
          inArray(optionsFlowExecPerStrikeTable.date, [...allDates]),
        ));
      for (const e of execRows as unknown as ExecRow[]) {
        if (symDateMap.get(e.underlyingSymbol) !== e.date) continue;
        execMap.set(execKey(e.underlyingSymbol, e.optionType, e.strike, e.expiration), {
          sweepCount: e.sweepCount,
          blockCount: e.blockCount,
          regularCount: e.regularCount,
          sweepNotional: e.sweepNotional,
          blockNotional: e.blockNotional,
          regularNotional: e.regularNotional,
        });
      }
    } catch (err) {
      // Exec data is optional — scanner still works on daily aggregates alone.
      logger.warn({ err }, "Unusual flow scan: exec rollup query failed (degrading)");
    }

    let mostRecent: string | null = null;
    for (const [sym, bucket] of bySymbol) {
      const asOf = symDateMap.get(sym)!;
      if (!mostRecent || asOf > mostRecent) mostRecent = asOf;
      const c = summarizeForSymbol(bucket, asOf, sym, f, execMap);
      if (c) result.candidates.push(c);
    }

    result.asOfDate = mostRecent;
    result.symbolsWithFlow = bySymbol.size;
    result.candidates.sort((a, b) => b.score - a.score);

    logger.info({
      requested: upperAll.length,
      excludedIndexes: excluded,
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
