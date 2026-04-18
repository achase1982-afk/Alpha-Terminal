import { db, equityDailyTable, flowDailyAggregatesTable } from "@workspace/db";
import { desc, eq, sql, and, gte } from "drizzle-orm";
import { logger } from "./logger.js";
import { getSettings } from "./strategistSettings.js";

export type IOScoreAvailabilitySource =
  | "real"            // beta/R² and residual computed from real history
  | "fallback_no_data" // not enough equity/SPY history to fit a regression
  | "fallback_error";  // exception during computation
export interface IOScoreResult {
  final: number;
  /**
   * False when the underlying beta/R² regression could not be fit (insufficient
   * history or runtime error). When false, `final` is computed from fallback
   * defaults (rSquared=0.5, residualZ=0) and should be displayed as "N/A" in
   * the UI rather than a numeric score, because identical inputs at different
   * times will produce different "real" scores once the data pipeline catches
   * up — making fallback values look like real values masks the data gap and
   * causes the apparent IOScore to flip between e.g. 67 and 50.
   */
  available: boolean;
  dataAvailability: {
    source: IOScoreAvailabilitySource;
    equityDays: number;
    spyDays: number;
    pairs: number;
  };
  components: {
    marketIndependence: { rSquared: number; weight: number; contribution: number };
    abnormalMove: { zScoreRaw: number; zScoreNormalized: number; weight: number; contribution: number };
    catalyst: { flagValue: number; reason: string; weight: number; contribution: number };
    flowDivergence: { volOiRatio: number; skewDivergence: number; final: number; weight: number; contribution: number };
  };
  classification: "HIGH_IDIOSYNCRATIC" | "MIXED" | "MACRO_ALIGNED";
  beta: number;
  residualReturnZScore: number;
}

interface CatalystInfo {
  flagValue: number;
  reason: string;
}

export async function computeIOScore(
  ticker: string,
  catalystInfo: CatalystInfo,
  settings?: Awaited<ReturnType<typeof getSettings>>
): Promise<IOScoreResult> {
  const cfg = settings ?? (await getSettings());

  const betaLookback = cfg.betaR2Lookback;
  const residualLookback = cfg.residualReturnLookback ?? 10;
  const wR2 = cfg.ioWeightR2;
  const wResidual = cfg.ioWeightResidual;
  const wCatalyst = cfg.ioWeightCatalyst;
  const wFlow = cfg.ioWeightFlow;
  const highThreshold = cfg.ioThresholdHigh;
  const mixedFloor = cfg.ioThresholdMixed;

  const betaR2 = await computeBetaR2(ticker, betaLookback, residualLookback);
  const { rSquared, beta, residualZScore } = betaR2;

  const flowDiv = await computeFlowDivergence(ticker);

  const normalizedZScore = Math.min(1.0, Math.abs(residualZScore) / 3.0);

  let totalWeight = wR2 + wResidual + wCatalyst + wFlow;
  let effectiveFlowWeight = wFlow;
  if (flowDiv.available === false) {
    effectiveFlowWeight = 0;
    totalWeight = wR2 + wResidual + wCatalyst;
  }

  const normalize = totalWeight > 0 ? 1.0 / totalWeight : 1.0;

  const r2Contribution = (1 - rSquared) * (wR2 * normalize);
  const residualContribution = normalizedZScore * (wResidual * normalize);
  const catalystContribution = catalystInfo.flagValue * (wCatalyst * normalize);
  const flowContribution = flowDiv.final * (effectiveFlowWeight * normalize);

  const idioStrength = Math.min(1.0, Math.max(0.0,
    r2Contribution + residualContribution + catalystContribution + flowContribution
  ));

  let classification: IOScoreResult["classification"];
  if (idioStrength >= highThreshold) classification = "HIGH_IDIOSYNCRATIC";
  else if (idioStrength >= mixedFloor) classification = "MIXED";
  else classification = "MACRO_ALIGNED";

  return {
    final: Math.round(idioStrength * 100) / 100,
    available: betaR2.source === "real",
    dataAvailability: {
      source: betaR2.source,
      equityDays: betaR2.equityDays,
      spyDays: betaR2.spyDays,
      pairs: betaR2.pairs,
    },
    components: {
      marketIndependence: { rSquared, weight: wR2, contribution: Math.round(r2Contribution * 1000) / 1000 },
      abnormalMove: { zScoreRaw: residualZScore, zScoreNormalized: normalizedZScore, weight: wResidual, contribution: Math.round(residualContribution * 1000) / 1000 },
      catalyst: { flagValue: catalystInfo.flagValue, reason: catalystInfo.reason, weight: wCatalyst, contribution: Math.round(catalystContribution * 1000) / 1000 },
      flowDivergence: { volOiRatio: flowDiv.volOiRatio, skewDivergence: flowDiv.skewDivergence, final: flowDiv.final, weight: effectiveFlowWeight, contribution: Math.round(flowContribution * 1000) / 1000 },
    },
    classification,
    beta,
    residualReturnZScore: residualZScore,
  };
}

async function computeBetaR2(
  ticker: string,
  lookbackDays: number,
  residualLookback: number = 10
): Promise<{
  rSquared: number;
  beta: number;
  residualZScore: number;
  source: IOScoreAvailabilitySource;
  equityDays: number;
  spyDays: number;
  pairs: number;
}> {
  try {
    // Calendar-day cutoff bumped 1.5× → 2.2× lookbackDays. Trading days are
    // ~5/7 of calendar days, so 1.5× returned only ~lookbackDays trading
    // sessions before SPY-pair matching dropped some — for lookbackDays=30
    // that left as few as 21-25 pairs after weekends/holidays/missing rows,
    // which is borderline against the 8-pair minimum and noisy on stocks with
    // any ingestion gaps. 2.2× gives ~33 trading days for a 30-day lookback,
    // a much safer margin while still keeping the regression "recent."
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.ceil(lookbackDays * 2.2));
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const rows = await db
      .select({
        symbol: equityDailyTable.symbol,
        date: equityDailyTable.date,
        close: equityDailyTable.close,
      })
      .from(equityDailyTable)
      .where(
        sql`${equityDailyTable.symbol} IN (${sql`${ticker}`}, ${sql`${"SPY"}`}) AND ${equityDailyTable.date} >= ${cutoffStr}`
      )
      .orderBy(equityDailyTable.date);

    const bySymbol = new Map<string, { date: string; close: number }[]>();
    for (const r of rows) {
      const arr = bySymbol.get(r.symbol) ?? [];
      arr.push({ date: r.date, close: r.close });
      bySymbol.set(r.symbol, arr);
    }

    const tickerData = bySymbol.get(ticker) ?? [];
    const spyData = bySymbol.get("SPY") ?? [];

    if (tickerData.length < 10 || spyData.length < 10) {
      // Diagnostic: surface the SPECIFIC reason data is starved so we can fix
      // ingestion gaps rather than guessing. Three categories:
      //  1. ticker missing (newly listed, spinoff, ticker change) → tickerData=0
      //  2. SPY missing (ingestion job dead) → spyData=0  ← infrastructural
      //  3. ticker present but short history → tickerData < 10 (newly listed)
      const reason =
        tickerData.length === 0 ? "ticker_no_rows_in_equity_daily"
        : spyData.length === 0 ? "spy_no_rows_in_equity_daily_INFRA_BUG"
        : tickerData.length < 10 ? "ticker_history_too_short"
        : "spy_history_too_short_INFRA_BUG";
      logger.warn(
        { ticker, tickerDays: tickerData.length, spyDays: spyData.length, lookbackDays, cutoffStr, reason },
        "IOScore: insufficient daily history for beta/R² — returning fallback (will surface as N/A in UI)",
      );
      return {
        rSquared: 0.5, beta: 1.0, residualZScore: 0,
        source: "fallback_no_data",
        equityDays: tickerData.length, spyDays: spyData.length, pairs: 0,
      };
    }

    const spyByDate = new Map<string, number>();
    for (let i = 1; i < spyData.length; i++) {
      spyByDate.set(spyData[i].date, (spyData[i].close - spyData[i - 1].close) / spyData[i - 1].close);
    }

    const pairs: [number, number][] = [];
    const tickerReturns: number[] = [];
    for (let i = 1; i < tickerData.length; i++) {
      const spyRet = spyByDate.get(tickerData[i].date);
      if (spyRet === undefined) continue;
      const tickerRet = (tickerData[i].close - tickerData[i - 1].close) / tickerData[i - 1].close;
      pairs.push([spyRet, tickerRet]);
      tickerReturns.push(tickerRet);
    }

    if (pairs.length < 8) {
      logger.warn(
        { ticker, pairs: pairs.length, tickerDays: tickerData.length, spyDays: spyData.length },
        "IOScore: insufficient overlapping return pairs — returning fallback (will surface as N/A in UI)",
      );
      return {
        rSquared: 0.5, beta: 1.0, residualZScore: 0,
        source: "fallback_no_data",
        equityDays: tickerData.length, spyDays: spyData.length, pairs: pairs.length,
      };
    }

    const recent = pairs.slice(-lookbackDays);

    const n = recent.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (const [x, y] of recent) {
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y;
    }
    const beta = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
    const alpha = (sumY - beta * sumX) / n;

    let ssTot = 0, ssRes = 0;
    const residuals: number[] = [];
    for (const [x, y] of recent) {
      const predicted = alpha + beta * x;
      const residual = y - predicted;
      residuals.push(residual);
      ssTot += (y - sumY / n) ** 2;
      ssRes += residual ** 2;
    }
    const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const stdResidual = Math.sqrt(
      residuals.reduce((a, r) => a + (r - meanResidual) ** 2, 0) / (residuals.length - 1 || 1)
    );

    const recentResiduals = residuals.slice(-residualLookback);
    const avgRecentResidual = recentResiduals.length > 0
      ? recentResiduals.reduce((a, b) => a + b, 0) / recentResiduals.length
      : 0;
    const residualZScore = stdResidual > 0 ? avgRecentResidual / stdResidual : 0;

    return {
      rSquared: Math.round(rSquared * 100) / 100,
      beta: Math.round(beta * 100) / 100,
      residualZScore: Math.round(residualZScore * 100) / 100,
      source: "real",
      equityDays: tickerData.length,
      spyDays: spyData.length,
      pairs: pairs.length,
    };
  } catch (err) {
    logger.error({ err, ticker }, "IOScore: beta/R² computation failed");
    return {
      rSquared: 0.5, beta: 1.0, residualZScore: 0,
      source: "fallback_error",
      equityDays: 0, spyDays: 0, pairs: 0,
    };
  }
}

async function computeFlowDivergence(
  ticker: string
): Promise<{ volOiRatio: number; skewDivergence: number; final: number; available: boolean }> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 5);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const rows = await db
      .select({
        underlyingSymbol: flowDailyAggregatesTable.underlyingSymbol,
        avgVolOiRatio: flowDailyAggregatesTable.avgVolOiRatio,
        pcSkew: flowDailyAggregatesTable.pcSkew,
      })
      .from(flowDailyAggregatesTable)
      .where(gte(flowDailyAggregatesTable.date, cutoffStr))
      .orderBy(desc(flowDailyAggregatesTable.date));

    const tickerRows = rows.filter((r) => r.underlyingSymbol === ticker);
    if (tickerRows.length === 0) {
      return { volOiRatio: 0, skewDivergence: 0, final: 0, available: false };
    }

    const allSkews = rows.filter((r) => r.pcSkew != null).map((r) => r.pcSkew!);
    const marketAvgSkew = allSkews.length > 0
      ? allSkews.reduce((a, b) => a + b, 0) / allSkews.length
      : 1.0;

    const tickerVOI = tickerRows[0]?.avgVolOiRatio ?? 0;
    const tickerSkew = tickerRows[0]?.pcSkew ?? 1.0;

    const volOiRatio = tickerVOI;
    const skewDivergence = Math.abs(tickerSkew - marketAvgSkew);

    const flowDiv = Math.min(1.0, (volOiRatio / 3.0) * skewDivergence);

    return {
      volOiRatio: Math.round(volOiRatio * 100) / 100,
      skewDivergence: Math.round(skewDivergence * 100) / 100,
      final: Math.round(flowDiv * 100) / 100,
      available: true,
    };
  } catch (err) {
    logger.error({ err, ticker }, "IOScore: flow divergence computation failed");
    return { volOiRatio: 0, skewDivergence: 0, final: 0, available: false };
  }
}
