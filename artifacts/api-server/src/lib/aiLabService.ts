import { db, equityDailyTable, flowDailyAggregatesTable } from "@workspace/db";
import { inArray, desc, sql, eq, and, gte } from "drizzle-orm";
import { emitTelemetry, createTelemetryBatch } from "./telemetryStore.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";
import { getAiLabStrategistConfig } from "./aiLabConfig.js";

export function getAiLabServiceConfig() {
  const cfg = getAiLabStrategistConfig();
  return {
    MIN_AVG_VOLUME_20D: cfg.anomalyMinAvgVolume20d,
    MIN_PRICE: cfg.anomalyMinPrice,
    ANOMALY_VOLUME_SPIKE_THRESHOLD: cfg.anomalyVolumeSpikeThreshold,
    ANOMALY_FLOW_STRENGTH_THRESHOLD: cfg.anomalyFlowStrengthThreshold,
    ANOMALY_IVR_SPIKE_THRESHOLD: cfg.anomalyIvrSpikeThreshold,
    ANOMALY_RS_CHANGE_THRESHOLD: cfg.anomalyRsChangeThreshold,
    VIX_LOW: cfg.vixLow,
    VIX_NORMAL: cfg.vixNormal,
    DATA_FRESHNESS_MINUTES: cfg.dataFreshnessMinutes,
  };
}

export function AI_LAB_CONFIG_LIVE() {
  return getAiLabServiceConfig();
}

export const AI_LAB_CONFIG = new Proxy({} as ReturnType<typeof getAiLabServiceConfig>, {
  get(_target, prop: string) {
    return getAiLabServiceConfig()[prop as keyof ReturnType<typeof getAiLabServiceConfig>];
  }
});

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface UniverseAnomalyFilters {
  minPrice?: number;
  maxPrice?: number;
  minAvgVolume20d?: number;
  sectors?: string[];
  excludeEtfs?: boolean;
}

export interface UniverseAnomaly {
  symbol: string;
  anomalyTypes: string[];
  anomalyScores: Record<string, number>;
  sector: string | null;
  marketCapBucket: "SMALL" | "MID" | "LARGE" | "MEGA" | null;
  basicLiquidity: {
    avgVolume20d: number;
    avgSpreadPct: number;
    minOiMainStrikes: number | null;
  };
}

export interface TickerSnapshot {
  symbol: string;
  recentPriceSummary: {
    return5d: number;
    return20d: number;
    high20d: number;
    low20d: number;
  };
  volumeSummary: {
    median5d: number;
    median20d: number;
    volumeRatio: number;
  };
  ivSummary: {
    iv30d: number | null;
    ivr: number | null;
    hv20d: number | null;
    ivHvRatio: number | null;
  };
  flowSummary: {
    totalCallVol: number | null;
    totalPutVol: number | null;
    callPutSkew: number | null;
    avgVolOi: number | null;
    blockCount: number | null;
    biggestBlockNotional: number | null;
  };
  rsSummary: {
    rsVsSpy5d: number | null;
    rsVsSpy20d: number | null;
    sectorVsEtf20d: number | null;
  };
  scannerAlignment: {
    discoveryScore: number | null;
    momentumScore: number | null;
    modeAlignment: "AGREE" | "DISAGREE" | "NO_SIGNAL" | null;
  };
  regimeAtCreation: string;
  pulseSnapshot: unknown;
  liquidityMetrics: {
    avgSpreadPct: number | null;
    minOiMainStrikes: number | null;
    volumeToOiRatio: number | null;
  };
}

export interface RegimeState {
  date: string;
  trendState: "TRENDING_UP" | "TRENDING_DOWN" | "CHOPPY";
  volState: "LOW_VOL" | "NORMAL_VOL" | "HIGH_VOL";
  breadthState: "BULLISH" | "BEARISH";
  macroFlags: string[];
  pulseSummary: unknown;
}

export interface PatternPerformance {
  patternId: string;
  recentWinRate: number;
  avgPnl: number;
  bestRegimes: string[];
  worstRegimes: string[];
  sampleSize: number;
}

export interface ScannerAlignment {
  symbol: string;
  discoveryScore: number | null;
  momentumScore: number | null;
  modeAlignment: "UP" | "NEUTRAL" | "DOWN" | null;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return (to - from) / from;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── 2A: get_universe_anomalies ─────────────────────────────────────────────
// Scans equity_daily + flow_daily_aggregates for volume/flow/IV/RS anomalies.
// Ranks by composite anomaly score, NOT by percent change.

export async function getUniverseAnomalies(
  filters: UniverseAnomalyFilters,
  limit: number = 50,
): Promise<UniverseAnomaly[]> {
  const batch = createTelemetryBatch("AI_LAB");
  emitTelemetry("SCANNER", "INFO", `AI Lab: scanning for universe anomalies (limit=${limit})`, { limit, filters }, "AI_LAB", batch);

  const minPrice = filters.minPrice ?? AI_LAB_CONFIG.MIN_PRICE;
  const minVol = filters.minAvgVolume20d ?? AI_LAB_CONFIG.MIN_AVG_VOLUME_20D;

  const liquidCoreList = [...LIQUID_CORE_SYMBOLS] as string[];

  const latestDateRow = await db
    .select({ maxDate: sql<string>`max(${equityDailyTable.date})` })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, liquidCoreList));
  const latestDate = latestDateRow[0]?.maxDate;
  if (!latestDate) {
    emitTelemetry("DATABASE", "WARN", "AI Lab: no equity_daily data found", {}, "AI_LAB", batch);
    return [];
  }
  const equityRows = await db
    .select()
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.date, latestDate),
      inArray(equityDailyTable.symbol, liquidCoreList),
    ));

  const flowRows = await db
    .select()
    .from(flowDailyAggregatesTable)
    .where(and(
      eq(flowDailyAggregatesTable.date, latestDate),
      inArray(flowDailyAggregatesTable.underlyingSymbol, liquidCoreList),
    ));

  const flowMap = new Map(flowRows.map(f => [f.underlyingSymbol, f]));

  const results: UniverseAnomaly[] = [];

  for (const eq of equityRows) {
    if ((eq.close ?? 0) < minPrice) continue;
    if ((eq.volume ?? 0) < minVol) continue;
    if (filters.maxPrice && (eq.close ?? 0) > filters.maxPrice) continue;

    const anomalyTypes: string[] = [];
    const anomalyScores: Record<string, number> = {};
    let compositeScore = 0;

    const vol20 = eq.medianVolume20d ?? eq.volume ?? 0;
    const volRatio = vol20 > 0 ? (eq.volume ?? 0) / vol20 : 0;
    if (volRatio >= AI_LAB_CONFIG.ANOMALY_VOLUME_SPIKE_THRESHOLD) {
      anomalyTypes.push("VOLUME_SPIKE");
      anomalyScores["VOLUME_SPIKE"] = clamp(Math.round((volRatio - 1) * 40), 0, 100);
      compositeScore += anomalyScores["VOLUME_SPIKE"];
    }

    const ivr = eq.ivr ?? null;
    if (ivr !== null && ivr >= AI_LAB_CONFIG.ANOMALY_IVR_SPIKE_THRESHOLD) {
      anomalyTypes.push("IVR_SPIKE");
      anomalyScores["IVR_SPIKE"] = clamp(Math.round(ivr), 0, 100);
      compositeScore += anomalyScores["IVR_SPIKE"];
    }

    const flow = flowMap.get(eq.symbol);
    if (flow) {
      const volOi = flow.avgVolOiRatio ?? 0;
      if (volOi >= AI_LAB_CONFIG.ANOMALY_FLOW_STRENGTH_THRESHOLD) {
        anomalyTypes.push("UNUSUAL_FLOW");
        anomalyScores["UNUSUAL_FLOW"] = clamp(Math.round(volOi * 30), 0, 100);
        compositeScore += anomalyScores["UNUSUAL_FLOW"];
      }

      const blockCount = flow.blockCount ?? 0;
      if (blockCount >= 3) {
        anomalyTypes.push("BLOCK_ACTIVITY");
        anomalyScores["BLOCK_ACTIVITY"] = clamp(blockCount * 10, 0, 100);
        compositeScore += anomalyScores["BLOCK_ACTIVITY"];
      }
    }

    const rs = eq.rsRatio ?? null;
    if (rs !== null && Math.abs(rs - 1) >= AI_LAB_CONFIG.ANOMALY_RS_CHANGE_THRESHOLD) {
      anomalyTypes.push("RS_DIVERGENCE");
      anomalyScores["RS_DIVERGENCE"] = clamp(Math.round(Math.abs(rs - 1) * 200), 0, 100);
      compositeScore += anomalyScores["RS_DIVERGENCE"];
    }

    if (anomalyTypes.length === 0) continue;

    const mcap = eq.marketCap ?? 0;
    let marketCapBucket: "SMALL" | "MID" | "LARGE" | "MEGA" | null = null;
    if (mcap > 200e9) marketCapBucket = "MEGA";
    else if (mcap > 10e9) marketCapBucket = "LARGE";
    else if (mcap > 2e9) marketCapBucket = "MID";
    else if (mcap > 0) marketCapBucket = "SMALL";

    results.push({
      symbol: eq.symbol,
      anomalyTypes,
      anomalyScores,
      sector: null,
      marketCapBucket,
      basicLiquidity: {
        avgVolume20d: vol20,
        avgSpreadPct: 0,
        minOiMainStrikes: flow ? (flow.totalOi ?? null) : null,
      },
    });
  }

  results.sort((a, b) => {
    const scoreA = Object.values(a.anomalyScores).reduce((s, v) => s + v, 0);
    const scoreB = Object.values(b.anomalyScores).reduce((s, v) => s + v, 0);
    return scoreB - scoreA;
  });

  const trimmed = results.slice(0, limit);
  emitTelemetry("SCANNER", "INFO", `AI Lab: found ${trimmed.length} anomalies from ${equityRows.length} symbols`, {
    total: equityRows.length, anomalies: trimmed.length, topSymbols: trimmed.slice(0, 5).map(r => r.symbol).join(","),
  }, "AI_LAB", batch);
  return trimmed;
}

// ─── 2A2: get_compact_universe_summaries ─────────────────────────────────────
// Builds compact summaries for ALL LC130 symbols in one efficient batch query.
// Used by full-universe AI Lab mode to send all tickers to the analyst in one call.

export interface CompactTickerSummaryRow {
  symbol: string;
  close: number;
  return5d: number;
  return20d: number;
  volRatio: number;
  iv30d: number | null;
  ivr: number | null;
  hv20d: number | null;
  flowDirection: string | null;
  callPutSkew: number | null;
  blockCount: number | null;
  rsVsSpy5d: number | null;
  anomalyFlags: string[];
}

export async function getCompactUniverseSummaries(): Promise<CompactTickerSummaryRow[]> {
  const batch = createTelemetryBatch("AI_LAB");
  emitTelemetry("SCANNER", "INFO", "AI Lab: building compact universe summaries", {}, "AI_LAB", batch);

  const liquidCoreList = [...LIQUID_CORE_SYMBOLS] as string[];

  const latestDateRow = await db
    .select({ maxDate: sql<string>`max(${equityDailyTable.date})` })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, liquidCoreList));
  const latestDate = latestDateRow[0]?.maxDate;
  if (!latestDate) return [];

  const equityRows = await db
    .select()
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.date, latestDate),
      inArray(equityDailyTable.symbol, liquidCoreList),
    ));

  const prevDateRows = await db
    .selectDistinct({ date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(sql`${equityDailyTable.date} < ${latestDate}`)
    .orderBy(desc(equityDailyTable.date))
    .limit(20);
  const prevDates = prevDateRows.map(r => r.date);

  let prevEquityMap = new Map<string, Array<{ date: string; close: number; volume: number }>>();
  if (prevDates.length > 0) {
    const prevRows = await db
      .select({ symbol: equityDailyTable.symbol, date: equityDailyTable.date, close: equityDailyTable.close, volume: equityDailyTable.volume })
      .from(equityDailyTable)
      .where(and(
        inArray(equityDailyTable.symbol, liquidCoreList),
        inArray(equityDailyTable.date, prevDates),
      ));
    for (const r of prevRows) {
      if (!prevEquityMap.has(r.symbol)) prevEquityMap.set(r.symbol, []);
      prevEquityMap.get(r.symbol)!.push({ date: r.date, close: r.close ?? 0, volume: r.volume ?? 0 });
    }
    for (const [, rows] of prevEquityMap) {
      rows.sort((a, b) => b.date.localeCompare(a.date));
    }
  }

  const flowRows = await db
    .select()
    .from(flowDailyAggregatesTable)
    .where(and(
      eq(flowDailyAggregatesTable.date, latestDate),
      inArray(flowDailyAggregatesTable.underlyingSymbol, liquidCoreList),
    ));
  const flowMap = new Map(flowRows.map(f => [f.underlyingSymbol, f]));

  const spyRow = equityRows.find(r => r.symbol === "SPY");
  const spyPrev = prevEquityMap.get("SPY") ?? [];
  const spyClose = spyRow?.close ?? 0;
  const spyClose5 = spyPrev.length >= 5 ? spyPrev[4].close : spyClose;
  const spyReturn5d = spyClose5 > 0 ? (spyClose - spyClose5) / spyClose5 : 0;

  const results: CompactTickerSummaryRow[] = [];

  for (const eq of equityRows) {
    const close = eq.close ?? 0;
    if (close < AI_LAB_CONFIG.MIN_PRICE) continue;

    const prev = prevEquityMap.get(eq.symbol) ?? [];
    const close5ago = prev.length >= 5 ? prev[4].close : close;
    const close20ago = prev.length >= 20 ? prev[19].close : close;
    const return5d = close5ago > 0 ? (close - close5ago) / close5ago : 0;
    const return20d = close20ago > 0 ? (close - close20ago) / close20ago : 0;

    const volumes = [eq.volume ?? 0, ...prev.map(p => p.volume)];
    const med20 = median(volumes.slice(0, Math.min(20, volumes.length)));
    const volRatio = med20 > 0 ? (eq.volume ?? 0) / med20 : 0;

    const flow = flowMap.get(eq.symbol);

    const rsVsSpy5d = spyReturn5d !== 0 ? return5d - spyReturn5d : null;

    const anomalyFlags: string[] = [];
    if (volRatio >= AI_LAB_CONFIG.ANOMALY_VOLUME_SPIKE_THRESHOLD) anomalyFlags.push("VOL_SPIKE");
    if ((eq.ivr ?? 0) >= AI_LAB_CONFIG.ANOMALY_IVR_SPIKE_THRESHOLD) anomalyFlags.push("IVR_HIGH");
    if (flow && (flow.avgVolOiRatio ?? 0) >= AI_LAB_CONFIG.ANOMALY_FLOW_STRENGTH_THRESHOLD) anomalyFlags.push("UNUSUAL_FLOW");
    if (flow && (flow.blockCount ?? 0) >= 3) anomalyFlags.push("BLOCK_ACTIVITY");
    if (Math.abs(return5d) >= 0.05) anomalyFlags.push(return5d > 0 ? "MOMENTUM_UP" : "MOMENTUM_DOWN");

    results.push({
      symbol: eq.symbol,
      close: Math.round(close * 100) / 100,
      return5d: Math.round(return5d * 10000) / 10000,
      return20d: Math.round(return20d * 10000) / 10000,
      volRatio: Math.round(volRatio * 100) / 100,
      iv30d: eq.iv30d ? Math.round(eq.iv30d * 10000) / 10000 : null,
      ivr: eq.ivr ?? null,
      hv20d: eq.hv20d ? Math.round(eq.hv20d * 100) / 100 : null,
      flowDirection: flow?.flowDirection ?? null,
      callPutSkew: flow?.pcSkew != null ? Math.round(flow.pcSkew * 100) / 100 : null,
      blockCount: flow?.blockCount ?? null,
      rsVsSpy5d: rsVsSpy5d != null ? Math.round(rsVsSpy5d * 10000) / 10000 : null,
      anomalyFlags,
    });
  }

  emitTelemetry("SCANNER", "INFO", `AI Lab: built ${results.length} compact summaries for universe screen`, {
    total: results.length, withFlow: flowRows.length, withIV: results.filter(r => r.iv30d != null).length,
  }, "AI_LAB", batch);

  return results;
}

// ─── 2B: get_ticker_snapshot ────────────────────────────────────────────────
// Builds a comprehensive snapshot for a single symbol from DB + live sources.

export async function getTickerSnapshot(
  symbol: string,
  lookbackDays: number = 20,
): Promise<TickerSnapshot | null> {
  const batch = createTelemetryBatch("AI_LAB");
  const sym = symbol.toUpperCase();
  emitTelemetry("SCANNER", "INFO", `AI Lab: building ticker snapshot for ${sym} (${lookbackDays}d)`, { symbol: sym, lookbackDays }, "AI_LAB", batch);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays * 2);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, sym),
      gte(equityDailyTable.date, cutoffStr),
    ))
    .orderBy(desc(equityDailyTable.date));

  if (rows.length === 0) {
    emitTelemetry("DATABASE", "WARN", `AI Lab: no equity data for ${sym}`, { symbol: sym }, "AI_LAB", batch);
    return null;
  }

  const latest = rows[0];
  const closes = rows.map(r => r.close ?? 0);
  const volumes = rows.map(r => r.volume ?? 0);

  const closes5 = closes.slice(0, Math.min(5, closes.length));
  const closes20 = closes.slice(0, Math.min(20, closes.length));
  const volumes5 = volumes.slice(0, Math.min(5, volumes.length));
  const volumes20 = volumes.slice(0, Math.min(20, volumes.length));

  const return5d = closes5.length >= 2 ? pctChange(closes5[closes5.length - 1], closes5[0]) : 0;
  const return20d = closes20.length >= 2 ? pctChange(closes20[closes20.length - 1], closes20[0]) : 0;
  const high20d = Math.max(...closes20);
  const low20d = Math.min(...closes20.filter(c => c > 0));

  const flowRows = await db
    .select()
    .from(flowDailyAggregatesTable)
    .where(eq(flowDailyAggregatesTable.underlyingSymbol, sym))
    .orderBy(desc(flowDailyAggregatesTable.date))
    .limit(1);

  const flow = flowRows[0] ?? null;

  const spyRows = await db
    .select({ date: equityDailyTable.date, close: equityDailyTable.close })
    .from(equityDailyTable)
    .where(and(eq(equityDailyTable.symbol, "SPY"), gte(equityDailyTable.date, cutoffStr)))
    .orderBy(desc(equityDailyTable.date))
    .limit(lookbackDays);

  const spyCloses = spyRows.map(r => r.close ?? 0);
  const spyReturn5d = spyCloses.length >= 5 ? pctChange(spyCloses[4], spyCloses[0]) : null;
  const spyReturn20d = spyCloses.length >= 20 ? pctChange(spyCloses[19], spyCloses[0]) : null;

  const regime = await getRegimeState();

  const snapshot: TickerSnapshot = {
    symbol: sym,
    recentPriceSummary: { return5d, return20d, high20d, low20d },
    volumeSummary: {
      median5d: median(volumes5),
      median20d: median(volumes20),
      volumeRatio: median(volumes20) > 0 ? (volumes[0] ?? 0) / median(volumes20) : 0,
    },
    ivSummary: {
      iv30d: latest.iv30d ?? null,
      ivr: latest.ivr ?? null,
      hv20d: latest.hv20d ?? null,
      ivHvRatio: latest.iv30d && latest.hv20d && latest.hv20d > 0 ? latest.iv30d / latest.hv20d : null,
    },
    flowSummary: {
      totalCallVol: flow?.totalCallVolume ?? null,
      totalPutVol: flow?.totalPutVolume ?? null,
      callPutSkew: flow?.pcSkew ?? null,
      avgVolOi: flow?.avgVolOiRatio ?? null,
      blockCount: flow?.blockCount ?? null,
      biggestBlockNotional: flow?.blockNotionalTotal ?? null,
    },
    rsSummary: {
      rsVsSpy5d: spyReturn5d !== null ? return5d - spyReturn5d : null,
      rsVsSpy20d: spyReturn20d !== null ? return20d - spyReturn20d : null,
      sectorVsEtf20d: null,
    },
    scannerAlignment: {
      discoveryScore: null,
      momentumScore: null,
      modeAlignment: null,
    },
    regimeAtCreation: `${regime.trendState}|${regime.volState}|${regime.breadthState}`,
    pulseSnapshot: regime.pulseSummary,
    liquidityMetrics: {
      avgSpreadPct: null,
      minOiMainStrikes: flow?.totalOi ?? null,
      volumeToOiRatio: flow?.avgVolOiRatio ?? null,
    },
  };

  emitTelemetry("SCANNER", "INFO", `AI Lab: snapshot built for ${sym} — close $${latest.close?.toFixed(2)} IVR ${latest.ivr?.toFixed(0) ?? "N/A"}`, {
    symbol: sym, close: latest.close, ivr: latest.ivr, return5d, hasFlow: !!flow,
  }, "AI_LAB", batch);

  return snapshot;
}

// ─── 2C: get_regime_state ───────────────────────────────────────────────────
// Derives market regime from SPY price vs SMA20, VIX level, and breadth.
// [STUB]: macroFlags. Plug in MarketCalendar/Benzinga for real macro events.

export async function getRegimeState(): Promise<RegimeState> {
  const spyRows = await db
    .select()
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, "SPY"))
    .orderBy(desc(equityDailyTable.date))
    .limit(25);

  let trendState: RegimeState["trendState"] = "CHOPPY";
  if (spyRows.length >= 2) {
    const latest = spyRows[0];
    const sma20 = latest.sma20 ?? 0;
    const price = latest.close ?? 0;
    const return20d = spyRows.length >= 20 ? pctChange(spyRows[19].close ?? 0, price) : 0;

    if (price > sma20 && return20d > 0.01) trendState = "TRENDING_UP";
    else if (price < sma20 && return20d < -0.01) trendState = "TRENDING_DOWN";
  }

  // [STUB]: For real VIX, read from IB quote cache or Schwab REST cache.
  // Using equity_daily for $VIX if available, otherwise default to NORMAL_VOL.
  let volState: RegimeState["volState"] = "NORMAL_VOL";
  const vixRows = await db
    .select({ close: equityDailyTable.close })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, "VIX"))
    .orderBy(desc(equityDailyTable.date))
    .limit(1);

  if (vixRows.length > 0 && vixRows[0].close) {
    const vix = vixRows[0].close;
    if (vix < AI_LAB_CONFIG.VIX_LOW) volState = "LOW_VOL";
    else if (vix > AI_LAB_CONFIG.VIX_NORMAL) volState = "HIGH_VOL";
  }

  // [STUB]: breadthState from IB $ADD or from daily snapshot.
  // Default to trend-aligned for now.
  const breadthState: RegimeState["breadthState"] = trendState === "TRENDING_UP" ? "BULLISH" : "BEARISH";

  // [STUB]: macroFlags — plug in Benzinga economic calendar for EARNINGS_SEASON, FED_DAY, etc.
  const macroFlags: string[] = [];

  return {
    date: new Date().toISOString().slice(0, 10),
    trendState,
    volState,
    breadthState,
    macroFlags,
    pulseSummary: { stub: true },
  };
}

// ─── 2D: get_pattern_performance ────────────────────────────────────────────
// Queries historical idea outcomes by pattern tags to compute win rates.
// [STUB]: Returns placeholder data until enough ideas accumulate in DB.

export async function getPatternPerformance(
  patternTags: string[],
): Promise<PatternPerformance> {
  const patternId = [...patternTags].sort().join("+");

  // [STUB]: When we have enough data in ai_lab_ideas + ai_lab_idea_outcomes,
  // query real P&L by matching mainSignals JSONB against patternTags.
  // For now return placeholder indicating no historical data yet.
  return {
    patternId,
    recentWinRate: 0,
    avgPnl: 0,
    bestRegimes: [],
    worstRegimes: [],
    sampleSize: 0,
  };
}

// ─── 2E: get_scanner_alignment ──────────────────────────────────────────────
// Checks if the existing Discovery/Momentum scanner has scored this symbol.
// [STUB]: Reads from in-memory scan results if available.
// Plug in: import last scan result cache from deterministicScanner.v2.ts

export async function getScannerAlignment(symbol: string): Promise<ScannerAlignment> {
  const sym = symbol.toUpperCase();

  // [STUB]: In production, read from the latest scan results cache.
  // The v2 scanner stores results in memory; expose via a shared cache.
  return {
    symbol: sym,
    discoveryScore: null,
    momentumScore: null,
    modeAlignment: null,
  };
}

// ─── Correlation stub ───────────────────────────────────────────────────────
// [STUB]: Returns placeholder correlation. Replace with real 20d correlation
// computed from equity_daily close prices.

export async function getCorrelation(symbolA: string, symbolB: string): Promise<number> {
  if (symbolA.toUpperCase() === symbolB.toUpperCase()) return 1.0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [rowsA, rowsB] = await Promise.all([
    db.select({ date: equityDailyTable.date, close: equityDailyTable.close })
      .from(equityDailyTable)
      .where(and(eq(equityDailyTable.symbol, symbolA.toUpperCase()), gte(equityDailyTable.date, cutoffStr)))
      .orderBy(equityDailyTable.date),
    db.select({ date: equityDailyTable.date, close: equityDailyTable.close })
      .from(equityDailyTable)
      .where(and(eq(equityDailyTable.symbol, symbolB.toUpperCase()), gte(equityDailyTable.date, cutoffStr)))
      .orderBy(equityDailyTable.date),
  ]);

  const dateMapB = new Map(rowsB.map(r => [r.date, r.close ?? 0]));
  const pairs: [number, number][] = [];
  for (const a of rowsA) {
    const bClose = dateMapB.get(a.date);
    if (bClose !== undefined) pairs.push([a.close ?? 0, bClose]);
  }

  if (pairs.length < 10) return 0;

  const meanA = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let cov = 0, varA = 0, varB = 0;
  for (const [a, b] of pairs) {
    cov += (a - meanA) * (b - meanB);
    varA += (a - meanA) ** 2;
    varB += (b - meanB) ** 2;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : 0;
}
