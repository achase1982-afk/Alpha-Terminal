import { db, equityDailyTable } from "@workspace/db";
import { desc, eq, inArray, sql, gte } from "@workspace/db";
import { logger } from "./logger.js";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import type { EngineOutput, ClusterName } from "./marketPulseEngine.js";
import { clusterWeightCoverage } from "./marketPulseEngine.js";
import { getSettings } from "./strategistSettings.js";

export type DirectionalConviction =
  | "BULLISH"
  | "MODERATELY_BULLISH"
  | "NEUTRAL"
  | "TRANSITION"
  | "MODERATELY_BEARISH"
  | "BEARISH";

export type SystemicRiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "EXTREME";
export type CorrelationRegime = "LOW" | "NORMAL" | "HIGH";

export interface StructuredRegime {
  directionalConviction: DirectionalConviction;
  systemicRiskLevel: SystemicRiskLevel;
  correlationRegime: CorrelationRegime;
  compositeScore: number;
  idioOpportunityFlag: boolean;
  updatedAt: string;
  /** Share of cluster weight backed by live data, 0 to 1. */
  dataCoverage: number;
  /** True when enough of the pulse is dark that the reading should be discounted. */
  degraded: boolean;
  /** SPY/QQQ daily trend term, -2 to +2, or null when bars are short. */
  indexTrendScore: number | null;
}

let cachedRegime: StructuredRegime | null = null;
let lastUpdateMs = 0;
let updateIntervalMs = 5 * 60 * 1000;

export function getCachedRegime(): StructuredRegime | null {
  return cachedRegime;
}

export function isRegimeStale(): boolean {
  return !cachedRegime || Date.now() - lastUpdateMs > updateIntervalMs * 2;
}

/** Directional weights over the four clusters that carry direction. */
const DIRECTIONAL_WEIGHTS: ReadonlyArray<{ cluster: ClusterName; weight: number }> = [
  { cluster: "breadth", weight: 0.30 },
  { cluster: "riskAppetite", weight: 0.30 },
  { cluster: "rates", weight: 0.20 },
  { cluster: "macro", weight: 0.20 },
];

/**
 * Weighted directional score over the clusters that have data, plus an index
 * trend term when one is available.
 *
 * The old version read every cluster with `?? 0`, so a dark feed voted "flat"
 * at full weight. Once IBKR stopped paying for breadth that was 30% of the
 * directional score pinned to zero on every run, and the result was a standing
 * NEUTRAL that the strategist reads as "no edge". Renormalizing means a missing
 * cluster removes itself from the vote rather than outvoting the live ones.
 *
 * `trendScore` is a [-2, 2] reading of SPY and QQQ against their own 20-day
 * trend, derived from daily bars rather than any live index feed. It enters at
 * a fixed 0.25 weight alongside the renormalized clusters, so price action
 * still speaks when the internals are thin.
 */
export function deriveDirectionalConviction(pulse: EngineOutput, trendScore: number | null = null): DirectionalConviction {
  let weighted = 0;
  let weightPresent = 0;
  for (const { cluster, weight } of DIRECTIONAL_WEIGHTS) {
    const c = pulse.clusters[cluster];
    if (!c || c.dataQuality === "MISSING") continue;
    weighted += c.score * weight;
    weightPresent += weight;
  }

  if (trendScore !== null && Number.isFinite(trendScore)) {
    weighted += trendScore * 0.25;
    weightPresent += 0.25;
  }

  const regime = pulse.structuralRegime;
  if (regime === "TRANSITION") return "TRANSITION";

  // No directional input at all. NEUTRAL here means blind, not flat; callers
  // read `dataCoverage` on the regime to tell the two apart.
  if (weightPresent <= 0) return "NEUTRAL";

  const dirScore = weighted / weightPresent;

  if (dirScore >= 1.2) return "BULLISH";
  if (dirScore >= 0.4) return "MODERATELY_BULLISH";
  if (dirScore <= -1.2) return "BEARISH";
  if (dirScore <= -0.4) return "MODERATELY_BEARISH";
  return "NEUTRAL";
}

/** Bars needed before the trend term is trusted. */
const TREND_MIN_BARS = 21;

/** Scores one symbol's closes: position against its 20-day mean plus 5- and 10-day drift. */
export function scoreCloseSeriesTrend(closes: readonly number[]): number | null {
  if (closes.length < TREND_MIN_BARS) return null;
  const recent = closes.slice(-TREND_MIN_BARS);
  const last = recent[recent.length - 1];
  if (!Number.isFinite(last) || last <= 0) return null;

  const sma20 = recent.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const distPct = ((last - sma20) / sma20) * 100;
  const chg5 = ((last - recent[recent.length - 6]) / recent[recent.length - 6]) * 100;
  const chg10 = ((last - recent[recent.length - 11]) / recent[recent.length - 11]) * 100;

  const band = (v: number, edges: readonly [number, number, number]): number => {
    if (v >= edges[2]) return 2;
    if (v >= edges[1]) return 1;
    if (v >= edges[0]) return 0.5;
    if (v > -edges[0]) return 0;
    if (v > -edges[1]) return -0.5;
    if (v > -edges[2]) return -1;
    return -2;
  };

  const parts = [band(distPct, [0.5, 1.5, 3.0]), band(chg5, [0.5, 2.0, 4.0]), band(chg10, [1.0, 3.0, 6.0])];
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.max(-2, Math.min(2, Math.round(avg * 1000) / 1000));
}

/**
 * Index trend from daily bars for SPY and QQQ. Uses `equity_daily`, which is
 * backfilled from Polygon, so it needs no live index feed and keeps working
 * when the streamers are down.
 */
export async function computeIndexTrendScore(): Promise<number | null> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 70);
    const rows = await db
      .select({ symbol: equityDailyTable.symbol, date: equityDailyTable.date, close: equityDailyTable.close })
      .from(equityDailyTable)
      .where(
        sql`${equityDailyTable.symbol} IN ('SPY','QQQ') AND ${equityDailyTable.date} >= ${cutoff.toISOString().slice(0, 10)}`,
      )
      .orderBy(equityDailyTable.symbol, equityDailyTable.date);

    const bySymbol = new Map<string, number[]>();
    for (const r of rows) {
      const arr = bySymbol.get(r.symbol) ?? [];
      arr.push(r.close);
      bySymbol.set(r.symbol, arr);
    }

    const scores: number[] = [];
    for (const sym of ["SPY", "QQQ"]) {
      const s = scoreCloseSeriesTrend(bySymbol.get(sym) ?? []);
      if (s !== null) scores.push(s);
    }
    if (scores.length === 0) return null;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;
  } catch (err) {
    logger.warn({ err }, "Index trend score unavailable");
    return null;
  }
}

export function deriveSystemicRiskLevel(pulse: EngineOutput): SystemicRiskLevel {
  const vol = pulse.clusters.volLevel?.score ?? 0;
  const volTerm = pulse.clusters.volTerm?.score ?? 0;
  const credit = pulse.clusters.credit?.score ?? 0;

  const riskScore = ((-vol) * 0.40 + (-volTerm) * 0.30 + (-credit) * 0.30);

  if (riskScore >= 1.5) return "EXTREME";
  if (riskScore >= 0.8) return "ELEVATED";
  if (riskScore >= 0.3) return "MODERATE";
  return "LOW";
}

export async function computeCorrelationRegime(settings?: { correlationLowCeiling: number; correlationHighFloor: number }): Promise<CorrelationRegime> {
  try {
    const cfg = settings ?? await getSettings();
    const lowCeiling = cfg.correlationLowCeiling;
    const highFloor = cfg.correlationHighFloor;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const sample = LIQUID_CORE_SYMBOL_STRINGS.slice(0, 30);

    const rows = await db
      .select({
        symbol: equityDailyTable.symbol,
        date: equityDailyTable.date,
        close: equityDailyTable.close,
      })
      .from(equityDailyTable)
      .where(
        sql`${equityDailyTable.symbol} IN (${sql.join(
          [...sample, "SPY"].map((s) => sql`${s}`),
          sql`,`
        )}) AND ${equityDailyTable.date} >= ${cutoffStr}`
      )
      .orderBy(equityDailyTable.symbol, equityDailyTable.date);

    const bySymbol = new Map<string, { date: string; close: number }[]>();
    for (const r of rows) {
      const arr = bySymbol.get(r.symbol) ?? [];
      arr.push({ date: r.date, close: r.close });
      bySymbol.set(r.symbol, arr);
    }

    const spyData = bySymbol.get("SPY");
    if (!spyData || spyData.length < 10) return "NORMAL";

    const spyReturns = new Map<string, number>();
    for (let i = 1; i < spyData.length; i++) {
      spyReturns.set(spyData[i].date, (spyData[i].close - spyData[i - 1].close) / spyData[i - 1].close);
    }

    const correlations: number[] = [];
    for (const [sym, data] of bySymbol) {
      if (sym === "SPY" || data.length < 10) continue;

      const pairs: [number, number][] = [];
      for (let i = 1; i < data.length; i++) {
        const spyRet = spyReturns.get(data[i].date);
        if (spyRet === undefined) continue;
        const tickerRet = (data[i].close - data[i - 1].close) / data[i - 1].close;
        pairs.push([tickerRet, spyRet]);
      }
      if (pairs.length < 8) continue;

      const corr = pearsonCorrelation(pairs);
      if (!isNaN(corr)) correlations.push(corr);
    }

    if (correlations.length === 0) return "NORMAL";
    const avg = correlations.reduce((a, b) => a + b, 0) / correlations.length;

    if (avg > highFloor) return "HIGH";
    if (avg < lowCeiling) return "LOW";
    return "NORMAL";
  } catch (err) {
    logger.error({ err }, "Failed to compute correlation regime");
    return "NORMAL";
  }
}

function pearsonCorrelation(pairs: [number, number][]): number {
  const n = pairs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const [x, y] of pairs) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }
  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export async function updateRegimeFromPulse(pulse: EngineOutput): Promise<StructuredRegime> {
  const cfg = await getSettings();
  updateIntervalMs = (cfg.regimeUpdateFrequencyMin ?? 5) * 60 * 1000;
  const indexTrendScore = await computeIndexTrendScore();
  const directionalConviction = deriveDirectionalConviction(pulse, indexTrendScore);
  const systemicRiskLevel = deriveSystemicRiskLevel(pulse);
  const correlationRegime = await computeCorrelationRegime(cfg);
  const compositeScore = Math.round(((pulse.compositeScore + 2) / 4) * 100);
  const dataCoverage = clusterWeightCoverage(pulse.clusters);
  const degraded = dataCoverage < DEGRADED_COVERAGE_FLOOR;

  const idioOpportunityFlag =
    (directionalConviction === "NEUTRAL" || directionalConviction === "TRANSITION") &&
    systemicRiskLevel !== "EXTREME";

  cachedRegime = {
    directionalConviction,
    systemicRiskLevel,
    correlationRegime,
    compositeScore: Math.max(0, Math.min(100, compositeScore)),
    idioOpportunityFlag,
    updatedAt: new Date().toISOString(),
    dataCoverage,
    degraded,
    indexTrendScore,
  };
  lastUpdateMs = Date.now();

  logger.info({ regime: cachedRegime }, "Regime post-processor updated");
  return cachedRegime;
}

/** Below this share of live cluster weight the pulse reading is called degraded. */
export const DEGRADED_COVERAGE_FLOOR = 0.6;

export function buildFallbackRegime(): StructuredRegime {
  return {
    directionalConviction: "NEUTRAL",
    systemicRiskLevel: "MODERATE",
    correlationRegime: "NORMAL",
    compositeScore: 50,
    idioOpportunityFlag: true,
    updatedAt: new Date().toISOString(),
    dataCoverage: 0,
    degraded: true,
    indexTrendScore: null,
  };
}
