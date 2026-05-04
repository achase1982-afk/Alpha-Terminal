import { db, optionsFlowExecPerStrikeTable, optionsFlowPerStrikeTable, type OptionsFlowExecPerStrike, type OptionsFlowPerStrike } from "@workspace/db";
import { and, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getNextEarningsDate } from "./earningsService.js";
import {
  type ScannerEdgeType,
  classifyEdgeType,
  calendarDaysToDate,
  extractFrontBackAtmIvVolPoints,
} from "./scannerEdgeType.js";

export interface UnusualFlowFilters {
  // Renamed (canonical) keys. Old keys still accepted for back-compat below.
  minUnusualStrikes?: number;
  minVoiRatio?: number;
  minStrikeVolume?: number;
  minNotionalPerStrike?: number;     // dollars per strike (vol × mid × 100)
  minDteExcl0?: number;
  maxDte?: number;                   // Infinity ⇒ no cap
  skew?: "any" | "bull" | "bear" | "balanced" | "bullish" | "bearish" | "non_balanced";
  excludeEtfs?: boolean;
  patternSweep?: boolean;
  patternBlock?: boolean;
  patternRegular?: boolean;
  minSweeps?: number;
  minBlocks?: number;
  // Preset-spec additions
  aggressor?: "any" | "buyer" | "seller";
  excludeMid?: boolean;
  minExpiryConcentrationPct?: number;     // 0–100
  minStrikeConcentrationPct?: number;     // 0–100
  minRelativeOptionsAdv?: number;         // x-multiple vs 20d ADV per strike
  minUnderlyingVolVsAdv?: number;         // x-multiple underlying vol / 20d ADV
  source?: "live" | "baseline" | "any";

  // Legacy alias keys (kept so older callers still work).
  minStrikes?: number;
  minVolume?: number;
  minDte?: number;
  minNotional?: number;
  excludeIndexes?: boolean;
  includeSweeps?: boolean;
  includeBlocks?: boolean;
  includeRegular?: boolean;
  minSweepCount?: number;
  minBlockCount?: number;
}

interface NormalizedFilters {
  minUnusualStrikes: number;
  minVoiRatio: number;
  minStrikeVolume: number;
  minNotionalPerStrike: number;
  minDteExcl0: number;
  maxDte: number;
  skew: "any" | "bull" | "bear" | "balanced";
  excludeEtfs: boolean;
  patternSweep: boolean;
  patternBlock: boolean;
  patternRegular: boolean;
  minSweeps: number;
  minBlocks: number;
  aggressor: "any" | "buyer" | "seller";
  excludeMid: boolean;
  minExpiryConcentrationPct: number;
  minStrikeConcentrationPct: number;
  minRelativeOptionsAdv: number;
  minUnderlyingVolVsAdv: number;
  source: "live" | "baseline" | "any";
}

function normalizeSkew(s: UnusualFlowFilters["skew"]): NormalizedFilters["skew"] {
  switch (s) {
    case "bullish": return "bull";
    case "bearish": return "bear";
    case "non_balanced": return "balanced";
    case "bull":
    case "bear":
    case "balanced":
    case "any":
      return s;
    default: return "any";
  }
}

function normalize(f: UnusualFlowFilters): NormalizedFilters {
  return {
    minUnusualStrikes: f.minUnusualStrikes ?? f.minStrikes ?? 1,
    minVoiRatio: f.minVoiRatio ?? 3,
    minStrikeVolume: f.minStrikeVolume ?? f.minVolume ?? 500,
    minNotionalPerStrike: f.minNotionalPerStrike ?? f.minNotional ?? 250_000,
    minDteExcl0: f.minDteExcl0 ?? f.minDte ?? 3,
    maxDte: f.maxDte ?? Number.POSITIVE_INFINITY,
    skew: normalizeSkew(f.skew),
    excludeEtfs: f.excludeEtfs ?? f.excludeIndexes ?? true,
    patternSweep: f.patternSweep ?? f.includeSweeps ?? true,
    patternBlock: f.patternBlock ?? f.includeBlocks ?? true,
    patternRegular: f.patternRegular ?? f.includeRegular ?? true,
    minSweeps: f.minSweeps ?? f.minSweepCount ?? 0,
    minBlocks: f.minBlocks ?? f.minBlockCount ?? 0,
    aggressor: f.aggressor ?? "any",
    excludeMid: f.excludeMid ?? false,
    minExpiryConcentrationPct: f.minExpiryConcentrationPct ?? 0,
    minStrikeConcentrationPct: f.minStrikeConcentrationPct ?? 0,
    minRelativeOptionsAdv: f.minRelativeOptionsAdv ?? 0,
    minUnderlyingVolVsAdv: f.minUnderlyingVolVsAdv ?? 0,
    source: f.source ?? "live",
  };
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
  hasLiveExec: boolean;
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
  flowSource: "live" | "baseline";
  // Aggressor side classification — Phase 2 (NBBO subscription required).
  aggressorAvailable: false;
  edgeType: ScannerEdgeType;
}

export interface UnusualFlowScanResult {
  scanTimestamp: number;
  asOfDate: string | null;
  scannedSymbols: number;
  symbolsWithFlow: number;
  excludedIndexes: number;
  candidates: UnusualFlowCandidate[];
  filters: NormalizedFilters;
  diagnostics: {
    baselineRows: number;
    liveExecutionRows: number;
    symbolsWithLiveExecution: number;
    sourceMode: NormalizedFilters["source"];
  };
}

const EMPTY_EXEC: UnusualFlowExecSummary = {
  sweepCount: 0, blockCount: 0, regularCount: 0,
  sweepNotional: 0, blockNotional: 0, regularNotional: 0,
};

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

function toRawRow(r: OptionsFlowPerStrike): RawRow {
  return {
    underlyingSymbol: r.underlyingSymbol,
    date: String(r.date),
    optionType: r.optionType,
    strike: r.strike,
    expiration: String(r.expiration),
    dte: r.dte,
    dailyVolume: r.dailyVolume,
    openInterest: r.openInterest,
    mid: r.mid,
    impliedVolatility: r.impliedVolatility,
    delta: r.delta,
  };
}

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

function toExecRow(e: OptionsFlowExecPerStrike): ExecRow {
  return {
    underlyingSymbol: e.underlyingSymbol,
    date: String(e.date),
    optionType: e.optionType,
    strike: e.strike,
    expiration: String(e.expiration),
    sweepCount: e.sweepCount,
    blockCount: e.blockCount,
    regularCount: e.regularCount,
    sweepNotional: e.sweepNotional,
    blockNotional: e.blockNotional,
    regularNotional: e.regularNotional,
  };
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
    hasLiveExec: r._exec.sweepCount + r._exec.blockCount + r._exec.regularCount > 0,
  };
}

async function summarizeForSymbol(
  rows: RawRow[],
  asOfDate: string,
  symbol: string,
  f: NormalizedFilters,
  execMap: Map<string, UnusualFlowExecSummary>,
): Promise<UnusualFlowCandidate | null> {
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

    if (vol < f.minStrikeVolume || oi < MIN_OI_FOR_VOI) continue;
    if (dte < f.minDteExcl0) continue;
    if (Number.isFinite(f.maxDte) && dte > f.maxDte) continue;
    const voi = vol / oi;
    if (voi < f.minVoiRatio) continue;
    const notional = vol * mid * 100;
    if (notional < f.minNotionalPerStrike) continue;

    const exec = execMap.get(execKey(symbol, r.optionType, r.strike, r.expiration)) ?? EMPTY_EXEC;

    // The UOA scan is a live-flow scanner. Daily per-strike rows are useful as
    // the baseline, but a candidate only belongs in the live scan when the
    // Polygon trade tape has produced at least one classified execution row.
    const hasAnyEvent = exec.sweepCount + exec.blockCount + exec.regularCount > 0;
    const requiresLiveExec =
      f.source === "live" ||
      f.aggressor !== "any" ||
      f.excludeMid ||
      f.patternSweep ||
      f.patternBlock ||
      !f.patternRegular;
    if (requiresLiveExec && !hasAnyEvent) continue;
    if (f.source === "baseline" && hasAnyEvent) continue;
    if (hasAnyEvent) {
      const matchesType =
        (f.patternSweep && exec.sweepCount > 0) ||
        (f.patternBlock && exec.blockCount > 0) ||
        (f.patternRegular && exec.regularCount > 0);
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
  if (tickerExec.sweepCount < f.minSweeps) return null;
  if (tickerExec.blockCount < f.minBlocks) return null;

  const unusualStrikeCount = unusual.length;
  if (unusualStrikeCount < f.minUnusualStrikes) return null;

  // Concentration gates — computed independently so a user can require
  // strike concentration without also gating on expiry concentration.
  if ((f.minExpiryConcentrationPct > 0 || f.minStrikeConcentrationPct > 0) && unusualTotalNotional > 0) {
    const byExpiry = new Map<string, number>();
    for (const r of unusual) {
      byExpiry.set(r.expiration, (byExpiry.get(r.expiration) ?? 0) + r._notional);
    }
    const topExpiryNotional = Math.max(...byExpiry.values());

    if (f.minExpiryConcentrationPct > 0) {
      const pct = (topExpiryNotional / unusualTotalNotional) * 100;
      if (pct < f.minExpiryConcentrationPct) return null;
    }

    if (f.minStrikeConcentrationPct > 0) {
      let topExpiry = "";
      for (const [exp, n] of byExpiry) if (n === topExpiryNotional) { topExpiry = exp; break; }
      const stkNotional = unusual
        .filter(r => r.expiration === topExpiry)
        .map(r => r._notional)
        .sort((a, b) => b - a);
      const top2 = (stkNotional[0] ?? 0) + (stkNotional[1] ?? 0);
      const stkPct = topExpiryNotional > 0 ? (top2 / topExpiryNotional) * 100 : 0;
      if (stkPct < f.minStrikeConcentrationPct) return null;
    }
  }

  const totalUnusual = unusualCallVolume + unusualPutVolume;
  const callShare = totalUnusual > 0 ? unusualCallVolume / totalUnusual : 0.5;
  let skew: UnusualFlowCandidate["skew"];
  if (callShare >= 0.65) skew = "bullish";
  else if (callShare <= 0.35) skew = "bearish";
  else skew = "balanced";

  if (f.skew === "bull" && skew !== "bullish") return null;
  if (f.skew === "bear" && skew !== "bearish") return null;
  if (f.skew === "balanced" && skew === "balanced") return null;

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

  const earn = await getNextEarningsDate(symbol).catch(() => null);
  const todayYmd = new Date().toISOString().slice(0, 10);
  const daysToCatalyst =
    earn?.daysAway != null ? earn.daysAway : earn?.earningsDate ? calendarDaysToDate(todayYmd, earn.earningsDate) : null;

  const strikeIvRows = unusual.map((u) => ({
    strike: u.strike,
    dte: u.dte,
    impliedVolatility: u.impliedVolatility,
  }));
  const spotFromStrikes = unusual.length > 0
    ? unusual.map((u) => u.strike).sort((a, b) => a - b)[Math.floor(unusual.length / 2)]
    : 0;
  const { front: frontIvPts, back: backIvPts } = extractFrontBackAtmIvVolPoints(strikeIvRows, spotFromStrikes || 100);

  let blockCallUsd = 0;
  let blockPutUsd = 0;
  for (const u of unusual) {
    const bn = u._exec.blockNotional;
    if (u.optionType === "call") blockCallUsd += bn;
    else blockPutUsd += bn;
  }

  const directionalLean: "BULLISH" | "BEARISH" | "MIXED" =
    skew === "bullish" ? "BULLISH" : skew === "bearish" ? "BEARISH" : "MIXED";

  const edgeType = classifyEdgeType({
    iv30OverHv20: null,
    daysToNextCatalyst: daysToCatalyst,
    ivr: null,
    frontAtmIvVolPoints: frontIvPts,
    backAtmIvVolPoints: backIvPts,
    unusualCallFlowAskBias: skew === "bullish",
    unusualPutFlowAskBias: skew === "bearish",
    blockNotionalCallUsd: blockCallUsd,
    blockNotionalPutUsd: blockPutUsd,
    directionalLean,
  });

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
    flowSource: totalEvents > 0 ? "live" : "baseline",
    aggressorAvailable: false,
    edgeType,
  };
}

export async function scanUnusualFlow(
  symbols: string[],
  filters: UnusualFlowFilters = {},
): Promise<UnusualFlowScanResult> {
  const f: NormalizedFilters = normalize(filters);
  // The default UOA scan is live-flow only: per-strike daily rows are the
  // unusualness baseline, while options_flow_exec_per_strike proves the live
  // Polygon tape has printed the contract during the current session.
  const upperAll = symbols.map(s => s.toUpperCase());
  const excluded = f.excludeEtfs
    ? upperAll.filter(s => INDEX_SYMBOLS.has(s)).length
    : 0;
  const upper = f.excludeEtfs
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
    diagnostics: {
      baselineRows: 0,
      liveExecutionRows: 0,
      symbolsWithLiveExecution: 0,
      sourceMode: f.source,
    },
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
    for (const r of rows.map(toRawRow)) {
      if (symDateMap.get(r.underlyingSymbol) !== r.date) continue;
      let bucket = bySymbol.get(r.underlyingSymbol);
      if (!bucket) { bucket = []; bySymbol.set(r.underlyingSymbol, bucket); }
      bucket.push(r);
    }
    result.diagnostics.baselineRows = [...bySymbol.values()].reduce((sum, bucket) => sum + bucket.length, 0);

    // Phase 1: pull execution-pattern rollups for the same (symbol, date)
    // pairs. Left-join in memory because dates may differ per symbol.
    const execMap = new Map<string, UnusualFlowExecSummary>();
    const symbolsWithLiveExecution = new Set<string>();
    try {
      const execRows = await db
        .select()
        .from(optionsFlowExecPerStrikeTable)
        .where(and(
          inArray(optionsFlowExecPerStrikeTable.underlyingSymbol, [...symDateMap.keys()]),
          inArray(optionsFlowExecPerStrikeTable.date, [...allDates]),
        ));
      for (const e of execRows.map(toExecRow)) {
        if (symDateMap.get(e.underlyingSymbol) !== e.date) continue;
        result.diagnostics.liveExecutionRows++;
        symbolsWithLiveExecution.add(e.underlyingSymbol);
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
      // Exec data is optional only when callers explicitly request baseline/any.
      // The default live scan will return no candidates if rollups are dark.
      logger.warn({ err }, "Unusual flow scan: exec rollup query failed (degrading)");
    }
    result.diagnostics.symbolsWithLiveExecution = symbolsWithLiveExecution.size;

    let mostRecent: string | null = null;
    for (const [sym, bucket] of bySymbol) {
      const asOf = symDateMap.get(sym)!;
      if (!mostRecent || asOf > mostRecent) mostRecent = asOf;
      const c = await summarizeForSymbol(bucket, asOf, sym, f, execMap);
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
