import { db, equityDailyTable } from "@workspace/db";
import { desc, eq, inArray, sql, gte } from "drizzle-orm";
import { logger } from "./logger.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";
import type { EngineOutput, ClusterName } from "./marketPulseEngine.js";

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
}

let cachedRegime: StructuredRegime | null = null;
let lastUpdateMs = 0;
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export function getCachedRegime(): StructuredRegime | null {
  return cachedRegime;
}

export function isRegimeStale(): boolean {
  return !cachedRegime || Date.now() - lastUpdateMs > UPDATE_INTERVAL_MS * 2;
}

export function deriveDirectionalConviction(pulse: EngineOutput): DirectionalConviction {
  const breadth = pulse.clusters.breadth?.score ?? 0;
  const rates = pulse.clusters.rates?.score ?? 0;
  const riskApp = pulse.clusters.riskAppetite?.score ?? 0;
  const macro = pulse.clusters.macro?.score ?? 0;

  const dirScore = breadth * 0.30 + riskApp * 0.30 + rates * 0.20 + macro * 0.20;

  const regime = pulse.structuralRegime;
  if (regime === "TRANSITION") return "TRANSITION";

  if (dirScore >= 1.2) return "BULLISH";
  if (dirScore >= 0.4) return "MODERATELY_BULLISH";
  if (dirScore <= -1.2) return "BEARISH";
  if (dirScore <= -0.4) return "MODERATELY_BEARISH";
  return "NEUTRAL";
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

export async function computeCorrelationRegime(): Promise<CorrelationRegime> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const sample = LIQUID_CORE_SYMBOLS.slice(0, 30);

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

    if (avg > 0.75) return "HIGH";
    if (avg < 0.40) return "LOW";
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
  const directionalConviction = deriveDirectionalConviction(pulse);
  const systemicRiskLevel = deriveSystemicRiskLevel(pulse);
  const correlationRegime = await computeCorrelationRegime();
  const compositeScore = Math.round(((pulse.compositeScore + 2) / 4) * 100);

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
  };
  lastUpdateMs = Date.now();

  logger.info({ regime: cachedRegime }, "Regime post-processor updated");
  return cachedRegime;
}

export function buildFallbackRegime(): StructuredRegime {
  return {
    directionalConviction: "NEUTRAL",
    systemicRiskLevel: "MODERATE",
    correlationRegime: "NORMAL",
    compositeScore: 50,
    idioOpportunityFlag: true,
    updatedAt: new Date().toISOString(),
  };
}
