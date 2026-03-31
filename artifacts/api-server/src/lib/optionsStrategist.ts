import type { EngineOutput, ClusterName, MarketIndicators } from "./marketPulseEngine";

export interface OptionContract {
  strike: number;
  expiration: string;
  schwabSymbol?: string;
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  dte?: number;
}

export interface LegPayload {
  strike: number;
  type: "CALL" | "PUT";
  action: "BUY" | "SELL";
  bid: number;
  ask: number;
  mark: number;
  delta: number;
  volume: number;
  openInterest: number;
}

export interface ExitRules {
  profit_target_pct: number;
  profit_target_amount: number;
  stop_loss_pct: number;
  stop_loss_amount: number;
  time_exit: string;
}

export interface StrategyPayload {
  strategy_type: string;
  expiration_date: string;
  days_to_expiration: number;
  short_leg: LegPayload;
  long_leg: LegPayload;
  short_leg_2?: LegPayload;
  long_leg_2?: LegPayload;
  net_credit: number;
  max_profit: number;
  max_loss: number;
  breakeven: number;
  breakeven_upper?: number;
  probability_of_profit_pct: number;
  risk_reward_ratio: string;
  size_recommendation: string;
  contracts: number;
  exit_rules: ExitRules;
  undefined_risk?: boolean;
}

export type MarketRegime =
  | "HIGH_VOL_TRENDING_DOWN"
  | "HIGH_VOL_BOTTOMING"
  | "HIGH_VOL_TRENDING_UP"
  | "LOW_VOL_TRENDING_UP"
  | "LOW_VOL_RANGE_BOUND"
  | "RISING_VOL_TRANSITION"
  | "NO_REGIME";

export type StrategyType =
  | "BULL_PUT_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "BULL_CALL_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "CALL_DEBIT_SPREAD"
  | "PUT_DEBIT_SPREAD"
  | "IRON_CONDOR"
  | "SHORT_STRANGLE"
  | "SHORT_PUT"
  | "IRON_BUTTERFLY"
  | "LONG_CALL"
  | "LONG_PUT"
  | "LONG_CALL_45_90DTE"
  | "LONG_CALL_90DTE"
  | "CASH_SECURED_PUT";

export interface RegimeClassification {
  regime: MarketRegime;
  description: string;
  strategyUniverse: StrategyType[];
  dteRange: { min: number; max: number };
  deltaTargets: { shortStrike: number; longStrike?: number };
  sizeMultiplier: number;
}

export interface StrategistInput {
  pulse: {
    composite: number;
    confidence: number;
    label: string;
    todayEdge: string;
    size: string;
  };
  equity: {
    symbol: string;
    price: number;
    change: number;
    changePct: number;
  };
}

const MAX_RISK_PER_TRADE = 250;
const MIN_RR_GATE = 0.20;

function mid(c: OptionContract): number {
  return ((c.bid ?? 0) + (c.ask ?? 0)) / 2;
}

function isLiquid(c: OptionContract): boolean {
  const bid = c.bid ?? 0;
  const ask = c.ask ?? 0;
  if (bid <= 0 || ask <= 0) return false;
  if (ask < bid) return false;
  if ((c.volume ?? 0) <= 10) return false;
  if ((c.openInterest ?? 0) <= 100) return false;
  const m = (bid + ask) / 2;
  if (m <= 0) return false;
  if ((ask - bid) / m > 0.30) return false;
  return true;
}

function toLeg(c: OptionContract, type: "CALL" | "PUT", action: "BUY" | "SELL"): LegPayload {
  return {
    strike: c.strike,
    type,
    action,
    bid: c.bid ?? 0,
    ask: c.ask ?? 0,
    mark: r2(mid(c)),
    delta: c.delta ?? 0,
    volume: c.volume ?? 0,
    openInterest: c.openInterest ?? 0,
  };
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function sizeContracts(maxLoss: number, multiplier: number): number {
  if (maxLoss <= 0) return 0;
  const adjusted = MAX_RISK_PER_TRADE * multiplier;
  return Math.floor(adjusted / maxLoss);
}

function buildCreditExitRules(maxProfit: number): ExitRules {
  return {
    profit_target_pct: 50,
    profit_target_amount: r2(maxProfit * 0.5),
    stop_loss_pct: 100,
    stop_loss_amount: r2(maxProfit),
    time_exit: "Close by expiration day if not exited",
  };
}

function buildDebitExitRules(maxProfit: number, maxLoss: number): ExitRules {
  return {
    profit_target_pct: 50,
    profit_target_amount: r2(maxProfit * 0.5),
    stop_loss_pct: 50,
    stop_loss_amount: r2(maxLoss * 0.5),
    time_exit: "Close by expiration day if not exited. Close early if debit loses 50% of value.",
  };
}

interface ExpirationGroup {
  expirationDate: string;
  daysToExpiration: number;
}

function getAllExpirations(contracts: OptionContract[], minDTE: number, maxDTE: number): ExpirationGroup[] {
  const map = new Map<string, ExpirationGroup>();
  for (const c of contracts) {
    if (c.dte === undefined || c.dte < minDTE || c.dte > maxDTE) continue;
    if (!map.has(c.expiration)) {
      map.set(c.expiration, { expirationDate: c.expiration, daysToExpiration: c.dte });
    }
  }
  return [...map.values()].sort((a, b) => a.daysToExpiration - b.daysToExpiration);
}

function getContractsForExpiration(contracts: OptionContract[], expDate: string): OptionContract[] {
  return contracts.filter(c => c.expiration === expDate);
}

function findClosestDelta(contracts: OptionContract[], targetDelta: number): OptionContract | null {
  if (contracts.length === 0) return null;
  return contracts.reduce((best, c) =>
    Math.abs(Math.abs(c.delta ?? 0) - targetDelta) < Math.abs(Math.abs(best.delta ?? 0) - targetDelta) ? c : best
  );
}

export function classifyRegime(
  engine: EngineOutput,
  indicators: MarketIndicators,
): RegimeClassification {
  const vix = indicators.vix;
  const vixChange = indicators.vixChange;
  const composite = engine.compositeScore;
  const confidence = engine.confidenceScore;
  const riskAppScore = engine.clusters.riskAppetite.score;
  const breadthScore = engine.clusters.breadth.score;

  if (confidence < 25 || vix === null) {
    return {
      regime: "NO_REGIME",
      description: vix === null
        ? "VIX data unavailable. Cannot classify regime without volatility context."
        : "Signals too conflicted to classify a regime. Mixed internals.",
      strategyUniverse: [],
      dteRange: { min: 0, max: 0 },
      deltaTargets: { shortStrike: 0 },
      sizeMultiplier: 0,
    };
  }

  if (vix >= 25) {
    if (vixChange !== null && vixChange > -2 && breadthScore < 0 && riskAppScore < 0) {
      return {
        regime: "HIGH_VOL_TRENDING_DOWN",
        description: "Active correction/selloff. Elevated fear, weak breadth, risk-off.",
        strategyUniverse: ["LONG_PUT", "BEAR_PUT_SPREAD", "PUT_DEBIT_SPREAD", "LONG_CALL_90DTE"],
        dteRange: { min: 30, max: 120 },
        deltaTargets: { shortStrike: 0.30 },
        sizeMultiplier: 0.5,
      };
    }

    if (vixChange !== null && vixChange < -5 && (breadthScore >= 0 || riskAppScore > 0)) {
      return {
        regime: "HIGH_VOL_BOTTOMING",
        description: "Potential bottom forming. VIX collapsing, internals improving.",
        strategyUniverse: ["BULL_PUT_SPREAD", "CALL_DEBIT_SPREAD", "LONG_CALL_45_90DTE", "CASH_SECURED_PUT"],
        dteRange: { min: 30, max: 90 },
        deltaTargets: { shortStrike: 0.25 },
        sizeMultiplier: 0.5,
      };
    }

    if (riskAppScore > 0 && composite > 0) {
      return {
        regime: "HIGH_VOL_TRENDING_UP",
        description: "Recovery rally with elevated vol. Premium is rich, use it.",
        strategyUniverse: ["BULL_PUT_SPREAD", "CALL_DEBIT_SPREAD", "IRON_CONDOR", "BULL_CALL_SPREAD"],
        dteRange: { min: 14, max: 60 },
        deltaTargets: { shortStrike: 0.25 },
        sizeMultiplier: 0.75,
      };
    }
  }

  if (vix !== null && vix < 20) {
    if (composite > 0.5 && riskAppScore > 0 && breadthScore >= 0) {
      return {
        regime: "LOW_VOL_TRENDING_UP",
        description: "Bull grind. Low vol, broad participation. Premium selling sweet spot.",
        strategyUniverse: ["BULL_PUT_SPREAD", "BEAR_CALL_SPREAD", "IRON_CONDOR", "SHORT_PUT"],
        dteRange: { min: 1, max: 14 },
        deltaTargets: { shortStrike: 0.15 },
        sizeMultiplier: 1.0,
      };
    }

    if (Math.abs(composite) < 0.5) {
      return {
        regime: "LOW_VOL_RANGE_BOUND",
        description: "Chop. No clear direction. Sell premium on both sides.",
        strategyUniverse: ["IRON_CONDOR", "SHORT_STRANGLE", "IRON_BUTTERFLY"],
        dteRange: { min: 7, max: 30 },
        deltaTargets: { shortStrike: 0.20 },
        sizeMultiplier: 1.0,
      };
    }
  }

  if (vix !== null && vix >= 20 && vix < 25) {
    if (vixChange !== null && vixChange > 3) {
      return {
        regime: "RISING_VOL_TRANSITION",
        description: "Vol expanding. Market transitioning. Reduce exposure, tighten stops.",
        strategyUniverse: ["IRON_CONDOR", "BEAR_CALL_SPREAD", "BULL_PUT_SPREAD", "LONG_PUT"],
        dteRange: { min: 14, max: 45 },
        deltaTargets: { shortStrike: 0.20 },
        sizeMultiplier: 0.5,
      };
    }
  }

  const fallbackRegime: MarketRegime = composite > 0.25 ? "LOW_VOL_TRENDING_UP" : composite < -0.25 ? "RISING_VOL_TRANSITION" : "LOW_VOL_RANGE_BOUND";
  return {
    regime: fallbackRegime,
    description: composite > 0.25
      ? "Moderate bullish conditions. Standard approach."
      : composite < -0.25
        ? "Transitioning conditions. Cautious approach."
        : "Standard conditions. Moderate approach.",
    strategyUniverse: composite > 0.25
      ? ["BULL_PUT_SPREAD", "BULL_CALL_SPREAD", "IRON_CONDOR"]
      : composite < -0.25
        ? ["BEAR_CALL_SPREAD", "BEAR_PUT_SPREAD", "IRON_CONDOR"]
        : ["IRON_CONDOR", "BULL_PUT_SPREAD", "BEAR_CALL_SPREAD"],
    dteRange: { min: 7, max: 45 },
    deltaTargets: { shortStrike: 0.20 },
    sizeMultiplier: 0.75,
  };
}

function isCreditStrategy(type: StrategyType): boolean {
  return ["BULL_PUT_SPREAD", "BEAR_CALL_SPREAD", "IRON_CONDOR", "SHORT_STRANGLE", "SHORT_PUT", "IRON_BUTTERFLY", "CASH_SECURED_PUT"].includes(type);
}

function scoreSetup(setup: StrategyPayload, type: StrategyType): number {
  let score = 0;
  const rr = setup.max_loss > 0 ? setup.max_profit / setup.max_loss : 0;

  if (isCreditStrategy(type)) {
    score += setup.probability_of_profit_pct * 0.4;
    score += rr * 100 * 0.3;
    score += Math.min(setup.short_leg.volume, 500) / 500 * 20 * 0.15;
    score += Math.min(setup.short_leg.openInterest, 5000) / 5000 * 20 * 0.15;
  } else {
    score += rr * 100 * 0.5;
    score += setup.probability_of_profit_pct * 0.2;
    score += Math.min(setup.long_leg.volume, 500) / 500 * 20 * 0.15;
    score += Math.min(setup.long_leg.openInterest, 5000) / 5000 * 20 * 0.15;
  }

  return score;
}

function buildBullPutSpreadForExp(
  puts: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expPuts.length < 2) return null;

  const shortLeg = findClosestDelta(expPuts, delta);
  if (!shortLeg) return null;

  const longLeg = expPuts
    .filter(c => c.strike < shortLeg.strike)
    .sort((a, b) => b.strike - a.strike)[0];
  if (!longLeg) return null;

  const netCredit = mid(shortLeg) - mid(longLeg);
  if (netCredit <= 0) return null;
  const strikeWidth = shortLeg.strike - longLeg.strike;
  const maxProfit = netCredit * 100;
  const maxLoss = (strikeWidth - netCredit) * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortLeg.delta ?? delta)) * 100);

  return {
    strategy_type: "Bull Put Spread (Put Credit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "PUT", "SELL"),
    long_leg: toLeg(longLeg, "PUT", "BUY"),
    net_credit: r2(netCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(shortLeg.strike - netCredit),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildCreditExitRules(maxProfit),
  };
}

function buildBearCallSpreadForExp(
  calls: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  if (expCalls.length < 2) return null;

  const shortLeg = findClosestDelta(expCalls, delta);
  if (!shortLeg) return null;

  const longLeg = expCalls
    .filter(c => c.strike > shortLeg.strike)
    .sort((a, b) => a.strike - b.strike)[0];
  if (!longLeg) return null;

  const netCredit = mid(shortLeg) - mid(longLeg);
  if (netCredit <= 0) return null;
  const strikeWidth = longLeg.strike - shortLeg.strike;
  const maxProfit = netCredit * 100;
  const maxLoss = (strikeWidth - netCredit) * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortLeg.delta ?? delta)) * 100);

  return {
    strategy_type: "Bear Call Spread (Call Credit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "CALL", "SELL"),
    long_leg: toLeg(longLeg, "CALL", "BUY"),
    net_credit: r2(netCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(shortLeg.strike + netCredit),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildCreditExitRules(maxProfit),
  };
}

function buildBullCallSpreadForExp(
  calls: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  if (expCalls.length < 2) return null;

  const longLeg = findClosestDelta(expCalls, Math.min(delta + 0.20, 0.50));
  if (!longLeg) return null;

  const shortLeg = expCalls
    .filter(c => c.strike > longLeg.strike)
    .sort((a, b) => a.strike - b.strike)[0];
  if (!shortLeg) return null;

  const netDebit = mid(longLeg) - mid(shortLeg);
  if (netDebit <= 0) return null;
  const strikeWidth = shortLeg.strike - longLeg.strike;
  const maxProfit = (strikeWidth - netDebit) * 100;
  const maxLoss = netDebit * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round(Math.abs(longLeg.delta ?? 0.40) * 100);

  return {
    strategy_type: "Bull Call Spread (Call Debit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "CALL", "SELL"),
    long_leg: toLeg(longLeg, "CALL", "BUY"),
    net_credit: r2(-netDebit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(longLeg.strike + netDebit),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildDebitExitRules(maxProfit, maxLoss),
  };
}

function buildBearPutSpreadForExp(
  puts: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expPuts.length < 2) return null;

  const longLeg = findClosestDelta(expPuts, Math.min(delta + 0.20, 0.50));
  if (!longLeg) return null;

  const shortLeg = expPuts
    .filter(c => c.strike < longLeg.strike)
    .sort((a, b) => b.strike - a.strike)[0];
  if (!shortLeg) return null;

  const netDebit = mid(longLeg) - mid(shortLeg);
  if (netDebit <= 0) return null;
  const strikeWidth = longLeg.strike - shortLeg.strike;
  const maxProfit = (strikeWidth - netDebit) * 100;
  const maxLoss = netDebit * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round(Math.abs(longLeg.delta ?? 0.40) * 100);

  return {
    strategy_type: "Bear Put Spread (Put Debit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "PUT", "SELL"),
    long_leg: toLeg(longLeg, "PUT", "BUY"),
    net_credit: r2(-netDebit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(longLeg.strike - netDebit),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildDebitExitRules(maxProfit, maxLoss),
  };
}

function buildIronCondorForExp(
  calls: OptionContract[],
  puts: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expCalls.length < 2 || expPuts.length < 2) return null;

  const shortCall = findClosestDelta(expCalls, delta);
  const shortPut = findClosestDelta(expPuts, delta);
  if (!shortCall || !shortPut) return null;

  const longCall = expCalls
    .filter(c => c.strike > shortCall.strike)
    .sort((a, b) => a.strike - b.strike)[0];
  const longPut = expPuts
    .filter(c => c.strike < shortPut.strike)
    .sort((a, b) => b.strike - a.strike)[0];
  if (!longCall || !longPut) return null;

  const callCredit = mid(shortCall) - mid(longCall);
  const putCredit = mid(shortPut) - mid(longPut);
  const totalCredit = callCredit + putCredit;
  if (totalCredit <= 0) return null;

  const maxWidth = Math.max(longCall.strike - shortCall.strike, shortPut.strike - longPut.strike);
  const maxProfit = totalCredit * 100;
  const maxLoss = (maxWidth - totalCredit) * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortCall.delta ?? delta) - Math.abs(shortPut.delta ?? delta)) * 100);

  return {
    strategy_type: "Iron Condor",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortPut, "PUT", "SELL"),
    long_leg: toLeg(longPut, "PUT", "BUY"),
    short_leg_2: toLeg(shortCall, "CALL", "SELL"),
    long_leg_2: toLeg(longCall, "CALL", "BUY"),
    net_credit: r2(totalCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(shortPut.strike - totalCredit),
    breakeven_upper: r2(shortCall.strike + totalCredit),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildCreditExitRules(maxProfit),
  };
}

function buildShortStrangleForExp(
  calls: OptionContract[],
  puts: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expCalls.length === 0 || expPuts.length === 0) return null;

  const shortCall = findClosestDelta(expCalls, delta);
  const shortPut = findClosestDelta(expPuts, delta);
  if (!shortCall || !shortPut) return null;

  const totalCredit = mid(shortCall) + mid(shortPut);
  if (totalCredit <= 0) return null;

  const maxProfit = totalCredit * 100;
  const managedStop = totalCredit * 2 * 100;
  const contracts = sizeContracts(managedStop, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortCall.delta ?? delta) - Math.abs(shortPut.delta ?? delta)) * 100);

  return {
    strategy_type: "Short Strangle (Undefined Risk — managed stop at 2x credit)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortPut, "PUT", "SELL"),
    long_leg: toLeg(shortCall, "CALL", "SELL"),
    net_credit: r2(totalCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(managedStop),
    breakeven: r2(shortPut.strike - totalCredit),
    breakeven_upper: r2(shortCall.strike + totalCredit),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / managedStop)}:1`,
    size_recommendation: `Sized to $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk with 2x credit stop`,
    contracts,
    undefined_risk: true,
    exit_rules: {
      profit_target_pct: 50,
      profit_target_amount: r2(maxProfit * 0.5),
      stop_loss_pct: 200,
      stop_loss_amount: r2(managedStop),
      time_exit: "Close by expiration day if not exited. MANDATORY stop at 2x credit received.",
    },
  };
}

function buildShortPutForExp(
  puts: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expPuts.length === 0) return null;

  const shortLeg = findClosestDelta(expPuts, delta);
  if (!shortLeg) return null;

  const premium = mid(shortLeg);
  if (premium <= 0) return null;

  const maxProfit = premium * 100;
  const managedStop = premium * 3 * 100;
  const contracts = sizeContracts(managedStop, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortLeg.delta ?? delta)) * 100);

  const dummyLong = toLeg(shortLeg, "PUT", "BUY");
  dummyLong.strike = 0;
  dummyLong.mark = 0;
  dummyLong.bid = 0;
  dummyLong.ask = 0;

  return {
    strategy_type: "Short Put (Undefined Risk — managed stop at 3x premium)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "PUT", "SELL"),
    long_leg: dummyLong,
    net_credit: r2(premium),
    max_profit: r2(maxProfit),
    max_loss: r2(managedStop),
    breakeven: r2(shortLeg.strike - premium),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / managedStop)}:1`,
    size_recommendation: `Sized to $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk with 3x premium stop`,
    contracts,
    undefined_risk: true,
    exit_rules: {
      profit_target_pct: 50,
      profit_target_amount: r2(maxProfit * 0.5),
      stop_loss_pct: 300,
      stop_loss_amount: r2(managedStop),
      time_exit: "Close by expiration day if not exited. MANDATORY stop at 3x premium received.",
    },
  };
}

function buildCashSecuredPutForExp(
  puts: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  return buildShortPutForExp(puts, exp, delta, sizeMul);
}

function buildIronButterflyForExp(
  calls: OptionContract[],
  puts: OptionContract[],
  exp: ExpirationGroup,
  _delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expCalls.length < 2 || expPuts.length < 2) return null;

  const shortCall = findClosestDelta(expCalls, 0.50);
  const shortPut = findClosestDelta(expPuts, 0.50);
  if (!shortCall || !shortPut) return null;

  const longCall = expCalls
    .filter(c => c.strike > shortCall.strike)
    .sort((a, b) => a.strike - b.strike)[1] ?? expCalls.filter(c => c.strike > shortCall.strike).sort((a, b) => a.strike - b.strike)[0];
  const longPut = expPuts
    .filter(c => c.strike < shortPut.strike)
    .sort((a, b) => b.strike - a.strike)[1] ?? expPuts.filter(c => c.strike < shortPut.strike).sort((a, b) => b.strike - a.strike)[0];
  if (!longCall || !longPut) return null;

  const callCredit = mid(shortCall) - mid(longCall);
  const putCredit = mid(shortPut) - mid(longPut);
  const totalCredit = callCredit + putCredit;
  if (totalCredit <= 0) return null;

  const maxWidth = Math.max(longCall.strike - shortCall.strike, shortPut.strike - longPut.strike);
  const maxProfit = totalCredit * 100;
  const maxLoss = (maxWidth - totalCredit) * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortCall.delta ?? 0.50) - Math.abs(shortPut.delta ?? 0.50)) * 100);

  return {
    strategy_type: "Iron Butterfly",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortPut, "PUT", "SELL"),
    long_leg: toLeg(longPut, "PUT", "BUY"),
    short_leg_2: toLeg(shortCall, "CALL", "SELL"),
    long_leg_2: toLeg(longCall, "CALL", "BUY"),
    net_credit: r2(totalCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(shortPut.strike - totalCredit),
    breakeven_upper: r2(shortCall.strike + totalCredit),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildCreditExitRules(maxProfit),
  };
}

function buildLongPutForExp(
  puts: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expPuts.length === 0) return null;

  const longLeg = findClosestDelta(expPuts, Math.min(delta + 0.10, 0.40));
  if (!longLeg) return null;

  const premium = mid(longLeg);
  if (premium <= 0) return null;
  const maxLoss = premium * 100;
  const maxProfit = (longLeg.strike - premium) * 100;
  if (maxProfit <= 0) return null;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round(Math.abs(longLeg.delta ?? 0.40) * 100);

  const dummyShort = toLeg(longLeg, "PUT", "SELL");
  dummyShort.strike = 0;
  dummyShort.mark = 0;
  dummyShort.bid = 0;
  dummyShort.ask = 0;

  return {
    strategy_type: "Long Put",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: dummyShort,
    long_leg: toLeg(longLeg, "PUT", "BUY"),
    net_credit: r2(-premium),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(longLeg.strike - premium),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildDebitExitRules(maxProfit, maxLoss),
  };
}

function buildLongCallForExp(
  calls: OptionContract[],
  exp: ExpirationGroup,
  delta: number,
  sizeMul: number,
): StrategyPayload | null {
  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  if (expCalls.length === 0) return null;

  const longLeg = findClosestDelta(expCalls, Math.min(delta + 0.10, 0.50));
  if (!longLeg) return null;

  const premium = mid(longLeg);
  if (premium <= 0) return null;
  const maxLoss = premium * 100;
  const maxProfit = premium * 3 * 100;
  const contracts = sizeContracts(maxLoss, sizeMul);
  if (contracts === 0) return null;
  const pop = Math.round(Math.abs(longLeg.delta ?? 0.40) * 100);

  const dummyShort = toLeg(longLeg, "CALL", "SELL");
  dummyShort.strike = 0;
  dummyShort.mark = 0;
  dummyShort.bid = 0;
  dummyShort.ask = 0;

  return {
    strategy_type: "Long Call",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: dummyShort,
    long_leg: toLeg(longLeg, "CALL", "BUY"),
    net_credit: r2(-premium),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(longLeg.strike + premium),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${Math.round(MAX_RISK_PER_TRADE * sizeMul)} max risk per trade`,
    contracts,
    exit_rules: buildDebitExitRules(maxProfit, maxLoss),
  };
}

function buildStrategyForExpiration(
  type: StrategyType,
  calls: OptionContract[],
  puts: OptionContract[],
  exp: ExpirationGroup,
  regime: RegimeClassification,
): StrategyPayload | null {
  const d = regime.deltaTargets.shortStrike;
  const s = regime.sizeMultiplier;

  switch (type) {
    case "BULL_PUT_SPREAD":
      return buildBullPutSpreadForExp(puts, exp, d, s);
    case "BEAR_CALL_SPREAD":
      return buildBearCallSpreadForExp(calls, exp, d, s);
    case "BULL_CALL_SPREAD":
    case "CALL_DEBIT_SPREAD":
      return buildBullCallSpreadForExp(calls, exp, d, s);
    case "BEAR_PUT_SPREAD":
    case "PUT_DEBIT_SPREAD":
      return buildBearPutSpreadForExp(puts, exp, d, s);
    case "IRON_CONDOR":
      return buildIronCondorForExp(calls, puts, exp, d, s);
    case "SHORT_STRANGLE":
      return buildShortStrangleForExp(calls, puts, exp, d, s);
    case "SHORT_PUT":
    case "CASH_SECURED_PUT":
      return buildShortPutForExp(puts, exp, d, s);
    case "IRON_BUTTERFLY":
      return buildIronButterflyForExp(calls, puts, exp, 0.50, s);
    case "LONG_PUT":
      return buildLongPutForExp(puts, exp, d, s);
    case "LONG_CALL":
    case "LONG_CALL_45_90DTE":
    case "LONG_CALL_90DTE":
      return buildLongCallForExp(calls, exp, d, s);
    default:
      return null;
  }
}

function findBestSetupForStrategy(
  type: StrategyType,
  calls: OptionContract[],
  puts: OptionContract[],
  regime: RegimeClassification,
): StrategyPayload | null {
  let dteMin = regime.dteRange.min;
  let dteMax = regime.dteRange.max;

  if (type === "LONG_CALL_45_90DTE") { dteMin = 45; dteMax = 90; }
  if (type === "LONG_CALL_90DTE") { dteMin = 90; dteMax = 180; }

  const contractSource = ["BULL_PUT_SPREAD", "BEAR_PUT_SPREAD", "PUT_DEBIT_SPREAD", "SHORT_PUT", "CASH_SECURED_PUT", "LONG_PUT"].includes(type)
    ? puts
    : ["BULL_CALL_SPREAD", "BEAR_CALL_SPREAD", "CALL_DEBIT_SPREAD", "LONG_CALL", "LONG_CALL_45_90DTE", "LONG_CALL_90DTE"].includes(type)
      ? calls
      : [...calls, ...puts];

  const expirations = getAllExpirations(contractSource, dteMin, dteMax);
  if (expirations.length === 0) return null;

  let bestSetup: StrategyPayload | null = null;
  let bestScore = -Infinity;

  for (const exp of expirations) {
    const setup = buildStrategyForExpiration(type, calls, puts, exp, regime);
    if (!setup) continue;

    const rr = setup.max_loss > 0 ? setup.max_profit / setup.max_loss : 0;
    if (rr < MIN_RR_GATE) continue;

    const score = scoreSetup(setup, type);
    if (score > bestScore) {
      bestScore = score;
      bestSetup = setup;
    }
  }

  return bestSetup;
}

export function selectStrategiesByRegime(
  regime: RegimeClassification,
  calls: OptionContract[],
  puts: OptionContract[],
): StrategyPayload[] {
  const results: StrategyPayload[] = [];

  for (const stratType of regime.strategyUniverse) {
    const setup = findBestSetupForStrategy(stratType, calls, puts, regime);
    if (setup) results.push(setup);
  }

  results.sort((a, b) => {
    const rrA = a.max_loss > 0 ? a.max_profit / a.max_loss : 0;
    const rrB = b.max_loss > 0 ? b.max_profit / b.max_loss : 0;
    return rrB - rrA;
  });

  return results.slice(0, 4);
}

export function selectStrategies(
  edge: string,
  calls: OptionContract[],
  puts: OptionContract[],
  _symbol: string,
): StrategyPayload[] {
  const fallbackRegime: RegimeClassification = {
    regime: "LOW_VOL_RANGE_BOUND",
    description: "Fallback",
    strategyUniverse: edge === "BEARISH_EDGE"
      ? ["BEAR_CALL_SPREAD", "BEAR_PUT_SPREAD"]
      : edge === "BULLISH_EDGE"
        ? ["BULL_PUT_SPREAD", "BULL_CALL_SPREAD"]
        : ["IRON_CONDOR", "SHORT_STRANGLE"],
    dteRange: { min: 1, max: 14 },
    deltaTargets: { shortStrike: 0.20 },
    sizeMultiplier: 1.0,
  };
  return selectStrategiesByRegime(fallbackRegime, calls, puts);
}

export function checkOverrideConflict(
  userDirection: string,
  composite: number,
  label: string,
): string | null {
  if (userDirection === "BEARISH_EDGE" && composite > 0.5) {
    return `Manual override: BEARISH strategy conflicts with pulse (composite +${r2(composite)}, ${label}). The best bearish setups may have poor R/R in this environment.`;
  }
  if (userDirection === "BULLISH_EDGE" && composite < -0.5) {
    return `Manual override: BULLISH strategy conflicts with pulse (composite ${r2(composite)}, ${label}). The best bullish setups may have poor R/R in this environment.`;
  }
  return null;
}

export const STRATEGIST_SYSTEM_PROMPT = `You are a professional options trading analyst presenting trade recommendations.
You receive a JSON payload containing a market pulse analysis, regime classification, and pre-calculated options strategies.

ABSOLUTE RULES:
1. You MUST NOT change, recalculate, or adjust any number from the payload.
2. You MUST NOT invent strikes, premiums, or expiration dates. Use ONLY what is in the payload.
3. You MUST NOT suggest additional trades beyond what the payload contains.
4. Every number you mention (strikes, credit, max profit, max loss, POP, breakeven) MUST match the payload exactly.
5. Your job is ONLY to explain WHY this trade makes sense given the market regime and to present it clearly.

For each strategy, explain:
- Why this strategy fits the current market regime (connect regime to strategy choice)
- The specific entry: which strikes to sell, which to buy, what expiration
- The risk/reward profile in plain English
- The exit rules
- Any conditions that would invalidate the trade thesis

Format the output as structured sections. Be concise and professional.
Do NOT add disclaimers about not being financial advice -- the user is a professional trader.`;
