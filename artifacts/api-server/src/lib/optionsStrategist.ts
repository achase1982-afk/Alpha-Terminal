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

interface ExpirationGroup {
  expirationDate: string;
  daysToExpiration: number;
}

const MAX_RISK_PER_TRADE = 250;

function mark(c: OptionContract): number {
  return ((c.bid ?? 0) + (c.ask ?? 0)) / 2;
}

function isLiquid(c: OptionContract): boolean {
  const bid = c.bid ?? 0;
  const ask = c.ask ?? 0;
  if (bid <= 0 || ask <= 0) return false;
  if (ask < bid) return false;
  if ((c.volume ?? 0) <= 10) return false;
  if ((c.openInterest ?? 0) <= 100) return false;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return false;
  const spread = ask - bid;
  if (spread / mid > 0.30) return false;
  return true;
}

function toLeg(c: OptionContract, type: "CALL" | "PUT", action: "BUY" | "SELL"): LegPayload {
  return {
    strike: c.strike,
    type,
    action,
    bid: c.bid ?? 0,
    ask: c.ask ?? 0,
    mark: Math.round(mark(c) * 100) / 100,
    delta: c.delta ?? 0,
    volume: c.volume ?? 0,
    openInterest: c.openInterest ?? 0,
  };
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function findBestExpiration(contracts: OptionContract[], minDTE: number, maxDTE: number): ExpirationGroup | null {
  const expirations = new Map<string, { date: string; dte: number }>();
  for (const c of contracts) {
    if (c.dte === undefined || c.dte < minDTE || c.dte > maxDTE) continue;
    if (!expirations.has(c.expiration)) {
      expirations.set(c.expiration, { date: c.expiration, dte: c.dte });
    }
  }
  if (expirations.size === 0) return null;
  const sorted = [...expirations.values()].sort((a, b) => a.dte - b.dte);
  return { expirationDate: sorted[0].date, daysToExpiration: sorted[0].dte };
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

function sizeContracts(maxLoss: number): number {
  if (maxLoss <= 0) return 0;
  return Math.floor(MAX_RISK_PER_TRADE / maxLoss);
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

export function buildBearCallSpread(calls: OptionContract[], symbol: string): StrategyPayload | null {
  const exp = findBestExpiration(calls, 1, 7) ?? findBestExpiration(calls, 1, 14);
  if (!exp) return null;

  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  if (expCalls.length < 2) return null;

  const shortLeg = findClosestDelta(expCalls, 0.20);
  if (!shortLeg) return null;

  const longLeg = expCalls
    .filter(c => c.strike > shortLeg.strike)
    .sort((a, b) => a.strike - b.strike)[0];
  if (!longLeg) return null;

  const netCredit = mark(shortLeg) - mark(longLeg);
  if (netCredit <= 0) return null;
  const strikeWidth = longLeg.strike - shortLeg.strike;
  const maxProfit = netCredit * 100;
  const maxLoss = (strikeWidth - netCredit) * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortLeg.delta ?? 0.20)) * 100);
  const breakeven = shortLeg.strike + netCredit;

  return {
    strategy_type: "Bear Call Spread (Call Credit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "CALL", "SELL"),
    long_leg: toLeg(longLeg, "CALL", "BUY"),
    net_credit: r2(netCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(breakeven),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${MAX_RISK_PER_TRADE} max risk per trade`,
    contracts,
    exit_rules: buildCreditExitRules(maxProfit),
  };
}

export function buildBearPutSpread(puts: OptionContract[], symbol: string): StrategyPayload | null {
  const exp = findBestExpiration(puts, 1, 7) ?? findBestExpiration(puts, 1, 14);
  if (!exp) return null;

  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expPuts.length < 2) return null;

  const longLeg = findClosestDelta(expPuts, 0.40);
  if (!longLeg) return null;

  const shortLeg = expPuts
    .filter(c => c.strike < longLeg.strike)
    .sort((a, b) => b.strike - a.strike)[0];
  if (!shortLeg) return null;

  const netDebit = mark(longLeg) - mark(shortLeg);
  if (netDebit <= 0) return null;
  const strikeWidth = longLeg.strike - shortLeg.strike;
  const maxProfit = (strikeWidth - netDebit) * 100;
  const maxLoss = netDebit * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss);
  if (contracts === 0) return null;
  const pop = Math.round(Math.abs(longLeg.delta ?? 0.40) * 100);
  const breakeven = longLeg.strike - netDebit;

  return {
    strategy_type: "Bear Put Spread (Put Debit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "PUT", "SELL"),
    long_leg: toLeg(longLeg, "PUT", "BUY"),
    net_credit: r2(-netDebit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(breakeven),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${MAX_RISK_PER_TRADE} max risk per trade`,
    contracts,
    exit_rules: buildDebitExitRules(maxProfit, maxLoss),
  };
}

export function buildBullPutSpread(puts: OptionContract[], symbol: string): StrategyPayload | null {
  const exp = findBestExpiration(puts, 1, 7) ?? findBestExpiration(puts, 1, 14);
  if (!exp) return null;

  const expPuts = getContractsForExpiration(puts, exp.expirationDate).filter(isLiquid);
  if (expPuts.length < 2) return null;

  const shortLeg = findClosestDelta(expPuts, 0.20);
  if (!shortLeg) return null;

  const longLeg = expPuts
    .filter(c => c.strike < shortLeg.strike)
    .sort((a, b) => b.strike - a.strike)[0];
  if (!longLeg) return null;

  const netCredit = mark(shortLeg) - mark(longLeg);
  if (netCredit <= 0) return null;
  const strikeWidth = shortLeg.strike - longLeg.strike;
  const maxProfit = netCredit * 100;
  const maxLoss = (strikeWidth - netCredit) * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortLeg.delta ?? 0.20)) * 100);
  const breakeven = shortLeg.strike - netCredit;

  return {
    strategy_type: "Bull Put Spread (Put Credit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "PUT", "SELL"),
    long_leg: toLeg(longLeg, "PUT", "BUY"),
    net_credit: r2(netCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(breakeven),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${MAX_RISK_PER_TRADE} max risk per trade`,
    contracts,
    exit_rules: buildCreditExitRules(maxProfit),
  };
}

export function buildBullCallSpread(calls: OptionContract[], symbol: string): StrategyPayload | null {
  const exp = findBestExpiration(calls, 1, 7) ?? findBestExpiration(calls, 1, 14);
  if (!exp) return null;

  const expCalls = getContractsForExpiration(calls, exp.expirationDate).filter(isLiquid);
  if (expCalls.length < 2) return null;

  const longLeg = findClosestDelta(expCalls, 0.40);
  if (!longLeg) return null;

  const shortLeg = expCalls
    .filter(c => c.strike > longLeg.strike)
    .sort((a, b) => a.strike - b.strike)[0];
  if (!shortLeg) return null;

  const netDebit = mark(longLeg) - mark(shortLeg);
  if (netDebit <= 0) return null;
  const strikeWidth = shortLeg.strike - longLeg.strike;
  const maxProfit = (strikeWidth - netDebit) * 100;
  const maxLoss = netDebit * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss);
  if (contracts === 0) return null;
  const pop = Math.round(Math.abs(longLeg.delta ?? 0.40) * 100);
  const breakeven = longLeg.strike + netDebit;

  return {
    strategy_type: "Bull Call Spread (Call Debit Spread)",
    expiration_date: exp.expirationDate,
    days_to_expiration: exp.daysToExpiration,
    short_leg: toLeg(shortLeg, "CALL", "SELL"),
    long_leg: toLeg(longLeg, "CALL", "BUY"),
    net_credit: r2(-netDebit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(breakeven),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${MAX_RISK_PER_TRADE} max risk per trade`,
    contracts,
    exit_rules: buildDebitExitRules(maxProfit, maxLoss),
  };
}

export function buildIronCondor(calls: OptionContract[], puts: OptionContract[], symbol: string): StrategyPayload | null {
  const callExp = findBestExpiration(calls, 1, 7) ?? findBestExpiration(calls, 1, 14);
  const putExp = findBestExpiration(puts, 1, 7) ?? findBestExpiration(puts, 1, 14);
  if (!callExp || !putExp) return null;

  const expDate = callExp.expirationDate;
  const expCalls = getContractsForExpiration(calls, expDate).filter(isLiquid);
  const expPuts = getContractsForExpiration(puts, expDate).filter(isLiquid);
  if (expCalls.length < 2 || expPuts.length < 2) return null;

  const shortCall = findClosestDelta(expCalls, 0.16);
  const shortPut = findClosestDelta(expPuts, 0.16);
  if (!shortCall || !shortPut) return null;

  const longCall = expCalls
    .filter(c => c.strike > shortCall.strike)
    .sort((a, b) => a.strike - b.strike)[0];
  const longPut = expPuts
    .filter(c => c.strike < shortPut.strike)
    .sort((a, b) => b.strike - a.strike)[0];
  if (!longCall || !longPut) return null;

  const callCredit = mark(shortCall) - mark(longCall);
  const putCredit = mark(shortPut) - mark(longPut);
  const totalCredit = callCredit + putCredit;
  if (totalCredit <= 0) return null;

  const callWidth = longCall.strike - shortCall.strike;
  const putWidth = shortPut.strike - longPut.strike;
  const maxWidth = Math.max(callWidth, putWidth);
  const maxProfit = totalCredit * 100;
  const maxLoss = (maxWidth - totalCredit) * 100;
  if (maxLoss <= 0) return null;
  const contracts = sizeContracts(maxLoss);
  if (contracts === 0) return null;
  const pop = Math.round((1 - Math.abs(shortCall.delta ?? 0.16) - Math.abs(shortPut.delta ?? 0.16)) * 100);
  const breakevenLower = shortPut.strike - totalCredit;
  const breakevenUpper = shortCall.strike + totalCredit;

  return {
    strategy_type: "Iron Condor",
    expiration_date: expDate,
    days_to_expiration: callExp.daysToExpiration,
    short_leg: toLeg(shortPut, "PUT", "SELL"),
    long_leg: toLeg(longPut, "PUT", "BUY"),
    short_leg_2: toLeg(shortCall, "CALL", "SELL"),
    long_leg_2: toLeg(longCall, "CALL", "BUY"),
    net_credit: r2(totalCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(maxLoss),
    breakeven: r2(breakevenLower),
    breakeven_upper: r2(breakevenUpper),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / maxLoss)}:1`,
    size_recommendation: `Based on $${MAX_RISK_PER_TRADE} max risk per trade`,
    contracts,
    exit_rules: buildCreditExitRules(maxProfit),
  };
}

export function buildShortStrangle(calls: OptionContract[], puts: OptionContract[], symbol: string): StrategyPayload | null {
  const callExp = findBestExpiration(calls, 1, 7) ?? findBestExpiration(calls, 1, 14);
  const putExp = findBestExpiration(puts, 1, 7) ?? findBestExpiration(puts, 1, 14);
  if (!callExp || !putExp) return null;

  const expDate = callExp.expirationDate;
  const expCalls = getContractsForExpiration(calls, expDate).filter(isLiquid);
  const expPuts = getContractsForExpiration(puts, expDate).filter(isLiquid);
  if (expCalls.length === 0 || expPuts.length === 0) return null;

  const shortCall = findClosestDelta(expCalls, 0.16);
  const shortPut = findClosestDelta(expPuts, 0.16);
  if (!shortCall || !shortPut) return null;

  const totalCredit = mark(shortCall) + mark(shortPut);
  if (totalCredit <= 0) return null;

  const maxProfit = totalCredit * 100;
  const managedStopLoss = totalCredit * 2 * 100;
  const pop = Math.round((1 - Math.abs(shortCall.delta ?? 0.16) - Math.abs(shortPut.delta ?? 0.16)) * 100);
  const breakevenLower = shortPut.strike - totalCredit;
  const breakevenUpper = shortCall.strike + totalCredit;
  const contracts = sizeContracts(managedStopLoss);
  if (contracts === 0) return null;

  return {
    strategy_type: "Short Strangle (Undefined Risk — managed stop at 2x credit)",
    expiration_date: expDate,
    days_to_expiration: callExp.daysToExpiration,
    short_leg: toLeg(shortPut, "PUT", "SELL"),
    long_leg: toLeg(shortCall, "CALL", "SELL"),
    net_credit: r2(totalCredit),
    max_profit: r2(maxProfit),
    max_loss: r2(managedStopLoss),
    breakeven: r2(breakevenLower),
    breakeven_upper: r2(breakevenUpper),
    probability_of_profit_pct: pop,
    risk_reward_ratio: `${r2(maxProfit / managedStopLoss)}:1`,
    size_recommendation: `Sized to $${MAX_RISK_PER_TRADE} max risk with 2x credit stop`,
    contracts,
    exit_rules: {
      profit_target_pct: 50,
      profit_target_amount: r2(maxProfit * 0.5),
      stop_loss_pct: 200,
      stop_loss_amount: r2(managedStopLoss),
      time_exit: "Close by expiration day if not exited. MANDATORY stop at 2x credit received.",
    },
  };
}

export function selectStrategies(
  edge: string,
  calls: OptionContract[],
  puts: OptionContract[],
  symbol: string,
): StrategyPayload[] {
  const strategies: StrategyPayload[] = [];

  if (edge === "BEARISH_EDGE") {
    const bcs = buildBearCallSpread(calls, symbol);
    if (bcs) strategies.push(bcs);
    const bps = buildBearPutSpread(puts, symbol);
    if (bps) strategies.push(bps);
  } else if (edge === "BULLISH_EDGE") {
    const bps = buildBullPutSpread(puts, symbol);
    if (bps) strategies.push(bps);
    const bcs = buildBullCallSpread(calls, symbol);
    if (bcs) strategies.push(bcs);
  } else if (edge === "NEUTRAL_EDGE") {
    const ic = buildIronCondor(calls, puts, symbol);
    if (ic) strategies.push(ic);
    const ss = buildShortStrangle(calls, puts, symbol);
    if (ss) strategies.push(ss);
  }

  return strategies;
}

export const STRATEGIST_SYSTEM_PROMPT = `You are a professional options trading analyst presenting trade recommendations.
You receive a JSON payload containing a market pulse analysis and pre-calculated options strategies.

ABSOLUTE RULES:
1. You MUST NOT change, recalculate, or adjust any number from the payload.
2. You MUST NOT invent strikes, premiums, or expiration dates. Use ONLY what is in the payload.
3. You MUST NOT suggest additional trades beyond what the payload contains.
4. Every number you mention (strikes, credit, max profit, max loss, POP, breakeven) MUST match the payload exactly.
5. Your job is ONLY to explain WHY this trade makes sense given the market pulse and to present it clearly.

For each strategy, explain:
- Why this strategy fits the current market environment (connect pulse bias to strategy choice)
- The specific entry: which strikes to sell, which to buy, what expiration
- The risk/reward profile in plain English
- The exit rules
- Any conditions that would invalidate the trade thesis

Format the output as structured sections. Be concise and professional.
Do NOT add disclaimers about not being financial advice -- the user is a professional trader.`;
