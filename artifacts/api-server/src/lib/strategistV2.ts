import { logger } from "./logger.js";
import { getCachedRegime, buildFallbackRegime, type StructuredRegime } from "./regimePostProcessor.js";
import { computeIOScore, type IOScoreResult } from "./ioScoreEngine.js";
import { getSettings, type StrategistConfig } from "./strategistSettings.js";
import { db, strategistTelemetryTable, equityDailyTable } from "@workspace/db";
import { desc, eq, sql, gte, and, inArray } from "drizzle-orm";
import { getBestAccessToken } from "./tokenStore.js";
import { fetchPolygonChain } from "./polygonChain.js";
import { checkEventConflicts, getUpcomingEvents } from "./calendarEventChecker.js";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";

export type TradeDirection = "BULLISH" | "BEARISH" | "NON_DIRECTIONAL";
export type StrategyType =
  | "bull_put_spread"
  | "bear_call_spread"
  | "call_debit_spread"
  | "put_debit_spread"
  | "iron_condor"
  | "butterfly"
  | "calendar";

export interface StrategistV2Result {
  status: "recommendation" | "no_viable_setup" | "toxic_block";
  ticker: string;
  recommendation?: {
    strategyLine: string;
    thesis: string;
    edgeAttribution: string;
    idioStrengthPct: number;
    macroPct: number;
    strategyType: StrategyType;
    direction: TradeDirection;
    legs: CandidateLeg[];
    credit?: number;
    debit?: number;
    maxProfit: number;
    maxLoss: number;
    breakeven: number;
    riskReward: number;
    dte: number;
    expiration: string;
  };
  blockReason?: string;
  regime: StructuredRegime;
  ioScore?: IOScoreResult;
  systemicRiskElevated: boolean;
  telemetryId?: number;
}

interface CandidateLeg {
  type: "call" | "put";
  side: "buy" | "sell";
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  openInterest: number;
}

interface Candidate {
  strategyType: StrategyType;
  direction: TradeDirection;
  legs: CandidateLeg[];
  credit?: number;
  debit?: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  riskReward: number;
  liquidityScore: number;
  candidateScore: number;
  dte: number;
  expiration: string;
}

interface TickerData {
  price: number;
  dailyChangePct: number;
  ivr: number | null;
  avgVolume20d: number;
  currentVolume: number;
  relativeVolume: number;
  sector: string;
  earningsWithin48h: boolean;
  earningsDaysAway: number | null;
  analystActions48h: string[];
  halted: boolean;
}

export async function analyzeTickerV2(ticker: string): Promise<StrategistV2Result> {
  const settings = await getSettings();
  const regime = getCachedRegime() ?? buildFallbackRegime();

  const toxicCheck = checkToxicGate(regime, settings);
  if (toxicCheck.triggered) {
    const result: StrategistV2Result = {
      status: "toxic_block",
      ticker,
      blockReason: `Cash is a position. Toxic market conditions: ${toxicCheck.reasons.join("; ")}`,
      regime,
      systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    };
    await logTelemetry(ticker, "toxic_block", regime, settings, null, null, toxicCheck, null, null, result.blockReason);
    return result;
  }

  const tickerData = await fetchTickerData(ticker);
  if (!tickerData) {
    const result: StrategistV2Result = {
      status: "no_viable_setup",
      ticker,
      blockReason: "No viable options setup: unable to fetch ticker data.",
      regime,
      systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    };
    await logTelemetry(ticker, "no_data", regime, settings, null, null, toxicCheck, null, null, result.blockReason);
    return result;
  }

  if (tickerData.halted) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, "No viable options setup: stock halted.");
  }

  const chain = await fetchOptionsChain(ticker, settings);
  if (!chain || chain.length === 0) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, "No viable options setup: no options chain.");
  }
  logger.info({ ticker, chainLength: chain.length, puts: chain.filter((c: any) => c.type === "put").length, calls: chain.filter((c: any) => c.type === "call").length }, "StrategistV2: options chain loaded");

  const atmSpreadPct = computeAtmSpread(chain, tickerData.price);
  if (atmSpreadPct > settings.maxBidAskSpreadPct / 100) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, `No viable options setup: ATM spread ${(atmSpreadPct * 100).toFixed(1)}% exceeds max ${settings.maxBidAskSpreadPct}%.`);
  }

  const catalystInfo = deriveCatalyst(tickerData);
  const ioScore = await computeIOScore(ticker, catalystInfo, settings);

  const earningsGate = checkEarningsGate(tickerData, settings);
  const { direction, directionReason } = determineDirection(ioScore, regime);
  let { creditOrDebit, creditReason } = determineCreditDebit(tickerData.ivr ?? 0, settings);

  if (earningsGate.triggered && creditOrDebit === "CREDIT") {
    creditOrDebit = "DEBIT";
    creditReason = `${creditReason}, overridden to DEBIT by earnings gate (earnings in ${earningsGate.daysUntil}d, IVR ${tickerData.ivr ?? 0} < floor ${settings.earningsIvrFloor})`;
  }

  const strategyType = selectStrategyType(direction, creditOrDebit);
  logger.info({ ticker, direction, creditOrDebit, strategyType, price: tickerData.price, ioClassification: ioScore.classification, earningsGate: earningsGate.triggered }, "StrategistV2: strategy selection");

  const candidates = buildCandidates(chain, strategyType, direction, tickerData.price, settings);
  const filterReasons: string[] = [];
  const viable = filterCandidates(candidates, settings, filterReasons);
  logger.info({ ticker, rawCandidates: candidates.length, viableCandidates: viable.length, filterReasons: filterReasons.slice(0, 5) }, "StrategistV2: candidate filtering");

  if (viable.length === 0) {
    const detail = candidates.length === 0
      ? `No candidates built for ${strategyType} (price=$${tickerData.price.toFixed(2)}, chain=${chain.length} contracts, DTE ${settings.preferredDteMin}-${settings.preferredDteMax}).`
      : `${candidates.length} candidates built but all filtered: ${filterReasons.slice(0, 3).join("; ")}.`;
    return noViable(ticker, regime, settings, toxicCheck, tickerData,
      `No viable options setup: ${detail}`,
      ioScore);
  }

  viable.sort((a, b) => b.candidateScore - a.candidateScore);
  const winner = viable[0];

  const idioStrengthPct = Math.round(ioScore.final * 100);
  const macroPct = 100 - idioStrengthPct;

  const thesis = buildThesis(ticker, winner, ioScore, regime, tickerData);
  const strategyLine = buildStrategyLine(ticker, winner);
  const edgeAttribution = `Edge source: Idiosyncratic ${idioStrengthPct}% / Macro ${macroPct}%`;

  const result: StrategistV2Result = {
    status: "recommendation",
    ticker,
    recommendation: {
      strategyLine,
      thesis,
      edgeAttribution,
      idioStrengthPct,
      macroPct,
      strategyType: winner.strategyType,
      direction,
      legs: winner.legs,
      credit: winner.credit,
      debit: winner.debit,
      maxProfit: winner.maxProfit,
      maxLoss: winner.maxLoss,
      breakeven: winner.breakeven,
      riskReward: winner.riskReward,
      dte: winner.dte,
      expiration: winner.expiration,
    },
    regime,
    ioScore,
    systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
  };

  const telemetryId = await logTelemetry(
    ticker, "recommendation", regime, settings, ioScore, tickerData, toxicCheck,
    { direction, directionReason, creditOrDebit, creditReason, strategyType },
    winner, thesis
  );
  result.telemetryId = telemetryId ?? undefined;

  return result;
}

function checkToxicGate(
  regime: StructuredRegime,
  settings: StrategistConfig
): { triggered: boolean; reasons: string[]; pathACheck: { extremeRisk: boolean; highCorrelation: boolean }; pathBCheck: { elevatedRisk: boolean; eventWithin24h: boolean; eventName: string | null } } {
  const pathACheck = {
    extremeRisk: regime.systemicRiskLevel === "EXTREME",
    highCorrelation: regime.correlationRegime === "HIGH",
  };
  const pathBCheck = {
    elevatedRisk: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    eventWithin24h: false,
    eventName: null as string | null,
  };

  if (!settings.toxicGateEnabled) return { triggered: false, reasons: [], pathACheck, pathBCheck };

  const reasons: string[] = [];

  if (settings.toxicPathAEnabled && pathACheck.extremeRisk && pathACheck.highCorrelation) {
    reasons.push("EXTREME systemic risk + HIGH correlation (flash crash / liquidity drain conditions)");
  }

  if (settings.toxicPathBEnabled && pathBCheck.elevatedRisk) {
    const upcoming = getUpcomingEvents(2);
    const now = Date.now();
    const horizon24h = now + 24 * 60 * 60 * 1000;
    const majorEvent = upcoming.find((e) => {
      if (e.type !== "fomc" && !(e.type === "economic" && e.title.includes("CPI"))) return false;
      if (e.type === "fomc" && e.title.toLowerCase().includes("minutes")) return false;
      const evTs = new Date(e.date + "T" + (e.time || "14:00") + ":00-04:00").getTime();
      return evTs >= now && evTs <= horizon24h;
    });
    if (majorEvent) {
      pathBCheck.eventWithin24h = true;
      pathBCheck.eventName = majorEvent.title;
      reasons.push(`${majorEvent.title} within 24h + ${regime.systemicRiskLevel} systemic risk`);
    }
  }

  return { triggered: reasons.length > 0, reasons, pathACheck, pathBCheck };
}

function determineDirection(
  ioScore: IOScoreResult,
  regime: StructuredRegime
): { direction: TradeDirection; directionReason: string } {
  if (ioScore.classification === "HIGH_IDIOSYNCRATIC") {
    const dir = ioScore.residualReturnZScore > 0 ? "BULLISH" : "BEARISH";
    return {
      direction: dir,
      directionReason: `idioStrength ${ioScore.final} >= threshold, residual return ${ioScore.residualReturnZScore > 0 ? "positive" : "negative"}`,
    };
  }

  const dc = regime.directionalConviction;
  if (dc === "BULLISH" || dc === "MODERATELY_BULLISH") {
    return { direction: "BULLISH", directionReason: `regime directional conviction: ${dc}` };
  }
  if (dc === "BEARISH" || dc === "MODERATELY_BEARISH") {
    return { direction: "BEARISH", directionReason: `regime directional conviction: ${dc}` };
  }
  if (dc === "TRANSITION") {
    return { direction: "NON_DIRECTIONAL", directionReason: "TRANSITION regime – favor IV-friendly structures" };
  }
  return { direction: "NON_DIRECTIONAL", directionReason: "NEUTRAL macro, low idiosyncratic – range-bound structures" };
}

function determineCreditDebit(
  ivr: number,
  settings: StrategistConfig
): { creditOrDebit: "CREDIT" | "DEBIT"; creditReason: string } {
  if (ivr >= settings.ivrCreditDebitThreshold) {
    return { creditOrDebit: "CREDIT", creditReason: `IVR ${ivr} >= ${settings.ivrCreditDebitThreshold} threshold` };
  }
  return { creditOrDebit: "DEBIT", creditReason: `IVR ${ivr} < ${settings.ivrCreditDebitThreshold} threshold` };
}

function selectStrategyType(
  direction: TradeDirection,
  creditOrDebit: "CREDIT" | "DEBIT"
): StrategyType {
  if (creditOrDebit === "CREDIT") {
    if (direction === "BULLISH") return "bull_put_spread";
    if (direction === "BEARISH") return "bear_call_spread";
    return "iron_condor";
  }
  if (direction === "BULLISH") return "call_debit_spread";
  if (direction === "BEARISH") return "put_debit_spread";
  return "butterfly";
}

function checkEarningsGate(
  tickerData: TickerData,
  settings: StrategistConfig
): { triggered: boolean; daysUntil: number | null; earningsDate: string | null } {
  if (settings.earningsProximityHours === 0) {
    return { triggered: false, daysUntil: null, earningsDate: null };
  }

  const proximityDays = settings.earningsProximityHours / 24;
  const daysAway = tickerData.earningsDaysAway;

  if (daysAway != null && daysAway <= proximityDays) {
    const ivr = tickerData.ivr ?? 0;
    if (ivr < settings.earningsIvrFloor) {
      return {
        triggered: true,
        daysUntil: daysAway,
        earningsDate: null,
      };
    }
  }

  return { triggered: false, daysUntil: daysAway, earningsDate: null };
}

function computeAtmSpread(chain: any[], price: number): number {
  const atm = chain.filter((c: any) => Math.abs(c.strike - price) / price < 0.02);
  if (atm.length === 0) return 1;
  const spreads = atm.map((c: any) => {
    const mid = (c.bid + c.ask) / 2;
    return mid > 0 ? (c.ask - c.bid) / mid : 1;
  });
  return Math.min(...spreads);
}

function deriveCatalyst(tickerData: TickerData): { flagValue: number; reason: string } {
  if (tickerData.earningsWithin48h) return { flagValue: 1.0, reason: "earnings_within_48h" };
  if (tickerData.analystActions48h.length >= 2) return { flagValue: 0.5, reason: "analyst_cluster" };
  if (tickerData.analystActions48h.length === 1) return { flagValue: 0.3, reason: "analyst_action" };
  return { flagValue: 0, reason: "none" };
}

function buildCandidates(
  chain: any[],
  strategyType: StrategyType,
  direction: TradeDirection,
  price: number,
  settings: StrategistConfig
): Candidate[] {
  const candidates: Candidate[] = [];
  const width = settings.spreadWidth;
  const dteMin = settings.preferredDteMin;
  const dteMax = settings.preferredDteMax;

  const expirations = new Set<string>();
  for (const c of chain) {
    if (c.dte >= dteMin && c.dte <= dteMax) expirations.add(c.expiration);
  }

  for (const exp of expirations) {
    const expChain = chain.filter((c: any) => c.expiration === exp);
    const puts = expChain.filter((c: any) => c.type === "put" || c.optionType === "PUT").sort((a: any, b: any) => a.strike - b.strike);
    const calls = expChain.filter((c: any) => c.type === "call" || c.optionType === "CALL").sort((a: any, b: any) => a.strike - b.strike);
    const dte = expChain[0]?.dte ?? 0;

    if (strategyType === "bull_put_spread") {
      for (const shortPut of puts) {
        if (shortPut.strike >= price) continue;
        if (Math.abs(shortPut.delta ?? 0) < 0.20 || Math.abs(shortPut.delta ?? 0) > 0.40) continue;
        const longStrike = shortPut.strike - width;
        const longPut = puts.find((p: any) => Math.abs(p.strike - longStrike) < 0.5);
        if (!longPut) continue;
        const credit = (shortPut.mid ?? (shortPut.bid + shortPut.ask) / 2) - (longPut.mid ?? (longPut.bid + longPut.ask) / 2);
        if (credit <= 0) continue;
        const maxProfit = credit * 100;
        const maxLoss = (width - credit) * 100;
        candidates.push({
          strategyType, direction: "BULLISH",
          legs: [
            toLeg(shortPut, "put", "sell"), toLeg(longPut, "put", "buy"),
          ],
          credit, maxProfit, maxLoss, breakeven: shortPut.strike - credit,
          riskReward: maxLoss > 0 ? maxProfit / maxLoss : 0,
          liquidityScore: legLiqScore(shortPut, longPut),
          candidateScore: 0, dte, expiration: exp,
        });
      }
    }

    if (strategyType === "bear_call_spread") {
      for (const shortCall of calls) {
        if (shortCall.strike <= price) continue;
        if (Math.abs(shortCall.delta ?? 0) < 0.20 || Math.abs(shortCall.delta ?? 0) > 0.40) continue;
        const longStrike = shortCall.strike + width;
        const longCall = calls.find((c: any) => Math.abs(c.strike - longStrike) < 0.5);
        if (!longCall) continue;
        const credit = (shortCall.mid ?? (shortCall.bid + shortCall.ask) / 2) - (longCall.mid ?? (longCall.bid + longCall.ask) / 2);
        if (credit <= 0) continue;
        const maxProfit = credit * 100;
        const maxLoss = (width - credit) * 100;
        candidates.push({
          strategyType, direction: "BEARISH",
          legs: [
            toLeg(shortCall, "call", "sell"), toLeg(longCall, "call", "buy"),
          ],
          credit, maxProfit, maxLoss, breakeven: shortCall.strike + credit,
          riskReward: maxLoss > 0 ? maxProfit / maxLoss : 0,
          liquidityScore: legLiqScore(shortCall, longCall),
          candidateScore: 0, dte, expiration: exp,
        });
      }
    }

    if (strategyType === "call_debit_spread") {
      for (const longCall of calls) {
        if (longCall.strike > price * 1.02) continue;
        if (Math.abs(longCall.delta ?? 0) < 0.40 || Math.abs(longCall.delta ?? 0) > 0.65) continue;
        const shortStrike = longCall.strike + width;
        const shortCall = calls.find((c: any) => Math.abs(c.strike - shortStrike) < 0.5);
        if (!shortCall) continue;
        const debit = (longCall.mid ?? (longCall.bid + longCall.ask) / 2) - (shortCall.mid ?? (shortCall.bid + shortCall.ask) / 2);
        if (debit <= 0) continue;
        const maxLoss = debit * 100;
        const maxProfit = (width - debit) * 100;
        candidates.push({
          strategyType, direction: "BULLISH",
          legs: [
            toLeg(longCall, "call", "buy"), toLeg(shortCall, "call", "sell"),
          ],
          debit, maxProfit, maxLoss, breakeven: longCall.strike + debit,
          riskReward: maxProfit > 0 && maxLoss > 0 ? maxProfit / maxLoss : 0,
          liquidityScore: legLiqScore(longCall, shortCall),
          candidateScore: 0, dte, expiration: exp,
        });
      }
    }

    if (strategyType === "put_debit_spread") {
      for (const longPut of puts) {
        if (longPut.strike < price * 0.98) continue;
        if (Math.abs(longPut.delta ?? 0) < 0.40 || Math.abs(longPut.delta ?? 0) > 0.65) continue;
        const shortStrike = longPut.strike - width;
        const shortPut = puts.find((p: any) => Math.abs(p.strike - shortStrike) < 0.5);
        if (!shortPut) continue;
        const debit = (longPut.mid ?? (longPut.bid + longPut.ask) / 2) - (shortPut.mid ?? (shortPut.bid + shortPut.ask) / 2);
        if (debit <= 0) continue;
        const maxLoss = debit * 100;
        const maxProfit = (width - debit) * 100;
        candidates.push({
          strategyType, direction: "BEARISH",
          legs: [
            toLeg(longPut, "put", "buy"), toLeg(shortPut, "put", "sell"),
          ],
          debit, maxProfit, maxLoss, breakeven: longPut.strike - debit,
          riskReward: maxProfit > 0 && maxLoss > 0 ? maxProfit / maxLoss : 0,
          liquidityScore: legLiqScore(longPut, shortPut),
          candidateScore: 0, dte, expiration: exp,
        });
      }
    }

    if (strategyType === "iron_condor") {
      const putSide = puts.filter((p: any) => p.strike < price && Math.abs(p.delta ?? 0) >= 0.15 && Math.abs(p.delta ?? 0) <= 0.35);
      const callSide = calls.filter((c: any) => c.strike > price && Math.abs(c.delta ?? 0) >= 0.15 && Math.abs(c.delta ?? 0) <= 0.35);

      for (const shortPut of putSide) {
        const longPut = puts.find((p: any) => Math.abs(p.strike - (shortPut.strike - width)) < 0.5);
        if (!longPut) continue;
        for (const shortCall of callSide) {
          const longCall = calls.find((c: any) => Math.abs(c.strike - (shortCall.strike + width)) < 0.5);
          if (!longCall) continue;
          const putCredit = (shortPut.mid ?? (shortPut.bid + shortPut.ask) / 2) - (longPut.mid ?? (longPut.bid + longPut.ask) / 2);
          const callCredit = (shortCall.mid ?? (shortCall.bid + shortCall.ask) / 2) - (longCall.mid ?? (longCall.bid + longCall.ask) / 2);
          const totalCredit = putCredit + callCredit;
          if (totalCredit <= 0) continue;
          const maxProfit = totalCredit * 100;
          const maxLoss = (width - totalCredit) * 100;
          candidates.push({
            strategyType, direction: "NON_DIRECTIONAL",
            legs: [
              toLeg(longPut, "put", "buy"), toLeg(shortPut, "put", "sell"),
              toLeg(shortCall, "call", "sell"), toLeg(longCall, "call", "buy"),
            ],
            credit: totalCredit, maxProfit, maxLoss,
            breakeven: shortPut.strike - totalCredit,
            riskReward: maxLoss > 0 ? maxProfit / maxLoss : 0,
            liquidityScore: (legLiqScore(shortPut, longPut) + legLiqScore(shortCall, longCall)) / 2,
            candidateScore: 0, dte, expiration: exp,
          });
        }
      }
    }

    if (strategyType === "butterfly") {
      const atmStrike = calls.reduce((best: any, c: any) =>
        Math.abs(c.strike - price) < Math.abs(best.strike - price) ? c : best, calls[0]);
      if (!atmStrike) continue;
      const center = atmStrike.strike;
      const lower = calls.find((c: any) => Math.abs(c.strike - (center - width)) < 0.5);
      const upper = calls.find((c: any) => Math.abs(c.strike - (center + width)) < 0.5);
      const centerOption = calls.find((c: any) => Math.abs(c.strike - center) < 0.5);
      if (!lower || !upper || !centerOption) continue;
      const debit = (lower.mid ?? (lower.bid + lower.ask) / 2)
        - 2 * (centerOption.mid ?? (centerOption.bid + centerOption.ask) / 2)
        + (upper.mid ?? (upper.bid + upper.ask) / 2);
      if (debit <= 0) continue;
      const maxProfit = (width - debit) * 100;
      const maxLoss = debit * 100;
      candidates.push({
        strategyType, direction: "NON_DIRECTIONAL",
        legs: [
          toLeg(lower, "call", "buy"), toLeg(centerOption, "call", "sell"),
          toLeg(centerOption, "call", "sell"), toLeg(upper, "call", "buy"),
        ],
        debit, maxProfit, maxLoss, breakeven: (center - width) + debit,
        riskReward: maxLoss > 0 ? maxProfit / maxLoss : 0,
        liquidityScore: 0.7,
        candidateScore: 0, dte, expiration: exp,
      });
    }

    if (strategyType === "butterfly" || strategyType === "calendar") {
      const atmCall = calls.reduce((best: any, c: any) =>
        Math.abs(c.strike - price) < Math.abs(best.strike - price) ? c : best, calls[0]);
      if (atmCall) {
        const calStrike = atmCall.strike;
        const allAtStrike = expChain.filter((c: any) =>
          Math.abs(c.strike - calStrike) < 0.5 &&
          (c.type === "call" || c.optionType === "CALL")
        ).sort((a: any, b: any) => (a.dte ?? 0) - (b.dte ?? 0));
        if (allAtStrike.length >= 2) {
          const frontMonth = allAtStrike[0];
          const backMonth = allAtStrike[allAtStrike.length - 1];
          if (frontMonth && backMonth && frontMonth !== backMonth) {
            const frontMid = frontMonth.mid ?? (frontMonth.bid + frontMonth.ask) / 2;
            const backMid = backMonth.mid ?? (backMonth.bid + backMonth.ask) / 2;
            const debit = backMid - frontMid;
            if (debit > 0) {
              const maxLoss = debit * 100;
              const maxProfit = maxLoss * 0.5;
              candidates.push({
                strategyType: "calendar", direction: "NON_DIRECTIONAL",
                legs: [
                  toLeg(frontMonth, "call", "sell"),
                  toLeg(backMonth, "call", "buy"),
                ],
                debit, maxProfit, maxLoss, breakeven: calStrike,
                riskReward: maxProfit > 0 && maxLoss > 0 ? maxProfit / maxLoss : 0,
                liquidityScore: legLiqScore(frontMonth, backMonth),
                candidateScore: 0, dte: frontMonth.dte ?? dte, expiration: frontMonth.expiration ?? exp,
              });
            }
          }
        }
      }
    }
  }

  for (const c of candidates) {
    c.candidateScore = c.riskReward * c.liquidityScore;
  }

  return candidates;
}

function toLeg(option: any, type: "call" | "put", side: "buy" | "sell"): CandidateLeg {
  return {
    type, side,
    strike: option.strike,
    expiration: option.expiration,
    bid: option.bid ?? 0,
    ask: option.ask ?? 0,
    mid: option.mid ?? (option.bid + option.ask) / 2,
    delta: option.delta ?? 0,
    openInterest: option.openInterest ?? option.open_interest ?? 0,
  };
}

function legLiqScore(a: any, b: any): number {
  const aSpread = a.mid > 0 ? (a.ask - a.bid) / a.mid : 1;
  const bSpread = b.mid > 0 ? (b.ask - b.bid) / b.mid : 1;
  const avgSpread = (aSpread + bSpread) / 2;
  return Math.max(0, 1 - avgSpread / 0.25);
}

function filterCandidates(candidates: Candidate[], settings: StrategistConfig, filterReasons: string[]): Candidate[] {
  return candidates.filter((c) => {
    for (const leg of c.legs) {
      if (leg.openInterest < settings.minOpenInterest) {
        filterReasons.push(`${leg.strike} ${leg.type}: OI ${leg.openInterest} below ${settings.minOpenInterest}`);
        return false;
      }
      const spreadPct = leg.mid > 0 ? (leg.ask - leg.bid) / leg.mid : 1;
      if (spreadPct > settings.maxBidAskSpreadPct / 100) {
        filterReasons.push(`${leg.strike} ${leg.type}: spread ${(spreadPct * 100).toFixed(0)}% above ${settings.maxBidAskSpreadPct}%`);
        return false;
      }
    }
    if (c.riskReward < 0.15) {
      filterReasons.push(`${c.strategyType}: R/R ${c.riskReward.toFixed(2)} below 0.15`);
      return false;
    }
    return true;
  });
}

const STRATEGY_NAMES: Record<StrategyType, string> = {
  bull_put_spread: "Bull put spread",
  bear_call_spread: "Bear call spread",
  call_debit_spread: "Call debit spread",
  put_debit_spread: "Put debit spread",
  iron_condor: "Iron condor",
  butterfly: "Butterfly",
  calendar: "Calendar",
};

function buildStrategyLine(ticker: string, candidate: Candidate): string {
  const name = STRATEGY_NAMES[candidate.strategyType] ?? candidate.strategyType;
  const legDescs = candidate.legs.map(
    (l) => `${l.side === "sell" ? "Sell" : "Buy"} ${candidate.expiration} $${l.strike} ${l.type}`
  );
  const priceStr = candidate.credit
    ? `for $${candidate.credit.toFixed(2)} credit`
    : `for $${(candidate.debit ?? 0).toFixed(2)} debit`;
  return `${name} on ${ticker}: ${legDescs.join(", ")} ${priceStr}.`;
}

function buildThesis(
  ticker: string,
  candidate: Candidate,
  ioScore: IOScoreResult,
  regime: StructuredRegime,
  tickerData: TickerData
): string {
  const idioPct = Math.round(ioScore.final * 100);
  const name = STRATEGY_NAMES[candidate.strategyType] ?? candidate.strategyType;

  let sentence1: string;
  if (ioScore.classification === "HIGH_IDIOSYNCRATIC") {
    const catalystDesc = ioScore.components.catalyst.reason !== "none"
      ? ` from ${ioScore.components.catalyst.reason.replace(/_/g, " ")}`
      : "";
    const volDesc = tickerData.relativeVolume >= 2
      ? ` and ${tickerData.relativeVolume.toFixed(1)}x relative volume`
      : "";
    sentence1 = `${name} on ${ticker}. Primary driver: ${idioPct}% idiosyncratic edge${catalystDesc}${volDesc}.`;
  } else {
    sentence1 = `${name} on ${ticker}. Primary driver: stock correlates with the broad market ${regime.directionalConviction.toLowerCase().replace(/_/g, " ")} trend.`;
  }

  const riskLabel = regime.systemicRiskLevel.toLowerCase();
  const sentence2 = `Macro regime is ${regime.directionalConviction} with ${riskLabel} systemic risk${
    regime.systemicRiskLevel === "ELEVATED" ? " – gap risk is elevated even on idiosyncratic setups" : ""
  }.`;

  return `${sentence1} ${sentence2}`;
}

async function fetchTickerData(ticker: string): Promise<TickerData | null> {
  try {
    const token = await getBestAccessToken();
    if (!token) return null;

    const res = await fetch(`${SCHWAB_API}/quotes?symbols=${ticker}&fields=quote,fundamental`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const q = data[ticker]?.quote ?? data[ticker.toUpperCase()]?.quote;
    const f = data[ticker]?.fundamental ?? data[ticker.toUpperCase()]?.fundamental ?? {};
    if (!q) return null;

    const price = q.lastPrice ?? q.mark ?? 0;
    const avgVol = f.avg10DaysVolume ?? f.avgVol10Days ?? 1;
    const currentVol = q.totalVolume ?? 0;

    const eventResult = checkEventConflicts(ticker, 45, "iron_condor");
    const earningsEvents = getUpcomingEvents(10).filter((e) => e.type === "earnings" && e.title.toLowerCase().includes(ticker.toLowerCase()));
    let earningsDaysAway: number | null = null;
    if (earningsEvents.length > 0) {
      const evDate = new Date(earningsEvents[0].date + "T16:00:00-04:00");
      earningsDaysAway = Math.max(0, Math.round((evDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    }
    const earningsWithin48h = earningsDaysAway != null && earningsDaysAway <= 2;

    let ivr: number | null = null;
    try {
      const ivrRows = await db
        .select({ ivr: equityDailyTable.ivr })
        .from(equityDailyTable)
        .where(and(
          eq(equityDailyTable.symbol, ticker.toUpperCase()),
          sql`${equityDailyTable.ivr} IS NOT NULL`
        ))
        .orderBy(desc(equityDailyTable.date))
        .limit(1);
      if (ivrRows.length > 0 && ivrRows[0].ivr != null) {
        ivr = ivrRows[0].ivr;
      }
    } catch (e) {
      logger.warn({ err: e, ticker }, "StrategistV2: IVR fetch from DB failed");
    }

    return {
      price,
      dailyChangePct: q.netPercentChangeInDouble ?? 0,
      ivr,
      avgVolume20d: avgVol,
      currentVolume: currentVol,
      relativeVolume: avgVol > 0 ? currentVol / avgVol : 1,
      sector: f.sector ?? "Unknown",
      earningsWithin48h,
      earningsDaysAway,
      analystActions48h: [],
      halted: q.securityStatus === "Halted" || q.securityStatus === "HALTED",
    };
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: failed to fetch ticker data");
    return null;
  }
}

async function fetchOptionsChain(ticker: string, settings: StrategistConfig): Promise<any[]> {
  try {
    const apiKey = process.env.POLYGON_API_KEY || "";
    const chain = await fetchPolygonChain(ticker, apiKey, { maxDte: settings.preferredDteMax });
    if (!chain || !chain.calls || (chain.calls.length === 0 && chain.puts.length === 0)) {
      const token = await getBestAccessToken();
      if (!token) return [];
      const res = await fetch(
        `${SCHWAB_API}/chains?symbol=${ticker}&strikeCount=20&strategy=SINGLE&range=OTM`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return [];
      const data = await res.json() as any;
      return flattenSchwabChain(data, settings);
    }

    const taggedCalls = (chain.calls || []).map((c: any) => ({ ...c, type: "call", optionType: "CALL", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    const taggedPuts = (chain.puts || []).map((c: any) => ({ ...c, type: "put", optionType: "PUT", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    const allContracts = [...taggedCalls, ...taggedPuts];
    return allContracts.filter((c: any) => {
      const dte = c.dte ?? 0;
      return dte >= settings.preferredDteMin && dte <= settings.preferredDteMax;
    });
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: failed to fetch options chain");
    return [];
  }
}

function flattenSchwabChain(data: any, settings: StrategistConfig): any[] {
  const result: any[] = [];
  for (const side of ["callExpDateMap", "putExpDateMap"]) {
    const map = data[side];
    if (!map) continue;
    const optType = side.includes("call") ? "CALL" : "PUT";
    for (const [expKey, strikes] of Object.entries(map as Record<string, any>)) {
      for (const [strikeKey, arr] of Object.entries(strikes as Record<string, any[]>)) {
        for (const opt of arr) {
          const dte = opt.daysToExpiration ?? 0;
          if (dte < settings.preferredDteMin || dte > settings.preferredDteMax) continue;
          result.push({
            strike: parseFloat(strikeKey),
            expiration: expKey.split(":")[0],
            optionType: optType,
            type: optType.toLowerCase(),
            bid: opt.bid ?? 0,
            ask: opt.ask ?? 0,
            mid: (opt.bid + opt.ask) / 2,
            delta: opt.delta ?? 0,
            openInterest: opt.openInterest ?? 0,
            volume: opt.totalVolume ?? 0,
            impliedVolatility: opt.volatility ?? 0,
            dte,
          });
        }
      }
    }
  }
  return result;
}

async function noViable(
  ticker: string,
  regime: StructuredRegime,
  settings: StrategistConfig,
  toxicCheck: any,
  tickerData: TickerData | null,
  reason: string,
  ioScore?: IOScoreResult | null
): Promise<StrategistV2Result> {
  await logTelemetry(ticker, "no_viable_setup", regime, settings, ioScore ?? null, tickerData, toxicCheck, null, null, reason);
  return {
    status: "no_viable_setup",
    ticker,
    blockReason: reason,
    regime,
    ioScore: ioScore ?? undefined,
    systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
  };
}

async function logTelemetry(
  ticker: string, result: string, regime: StructuredRegime, settings: StrategistConfig,
  ioScore: IOScoreResult | null, tickerData: TickerData | null,
  toxicCheck: any, strategyDecision: any, winner: Candidate | null, thesis?: string | null
): Promise<number | null> {
  try {
    const earningsGateData = tickerData ? checkEarningsGate(tickerData, settings) : null;
    const [row] = await db.insert(strategistTelemetryTable).values({
      ticker,
      result,
      regime: regime as any,
      tickerData: tickerData as any,
      idioScore: ioScore as any,
      toxicGate: {
        triggered: toxicCheck.triggered,
        reasons: toxicCheck.reasons,
        path_a_check: toxicCheck.pathACheck,
        path_b_check: toxicCheck.pathBCheck,
      } as any,
      viability: null,
      earningsGate: earningsGateData as any,
      strategyDecision: strategyDecision as any,
      candidatesGenerated: null,
      candidatesFiltered: null,
      filterReasons: null,
      winningCandidate: winner as any,
      edgeAttribution: ioScore ? { idiosyncratic_pct: Math.round(ioScore.final * 100), macro_pct: 100 - Math.round(ioScore.final * 100) } as any : null,
      recommendationThesis: thesis ?? null,
    }).returning({ id: strategistTelemetryTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry logging failed");
    return null;
  }
}
