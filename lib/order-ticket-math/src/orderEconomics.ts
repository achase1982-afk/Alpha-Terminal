import { parseCanonicalLimit, type LimitTickContext } from "./optionTickRound.js";

export type OptionRight = "CALL" | "PUT" | string;

export interface EconomicsLeg {
  strike: number;
  optionType: OptionRight;
  instruction: string;
  expiration?: string;
  /** Contracts per spread unit (e.g. 2 for the middle leg of a 1·2·1 butterfly). */
  quantity?: number;
}

export interface OrderEconomicsInput {
  legs?: EconomicsLeg[] | null;
  limitPrice: string | number | null | undefined;
  fallbackNetPrice?: number | null;
  quantity: number;
  isCredit?: boolean | null;
  isOption?: boolean;
  underlyingSymbol?: string;
  /** Per-contract Schwab options commission (default $0.65). */
  commissionPerContract?: number;
  /** Total option contracts (single-leg qty or sum of spread legs × spread qty). */
  contractCount?: number;
}

export interface OrderEconomicsResult {
  netPricePerShare: number;
  grossNotional: number;
  maxRisk: number;
  maxProfit: number;
  commissionTotal: number;
  totalCostInclFees: number;
  totalCreditAfterFees: number;
  buyingPowerEffect: number;
  breakevens: number[];
  isIronCondor: boolean;
}

function tickContext(input: OrderEconomicsInput): LimitTickContext {
  return {
    underlyingSymbol: input.underlyingSymbol ?? "",
    isOption: input.isOption !== false,
  };
}

function detectIronCondor(
  legs: EconomicsLeg[],
  isCredit: boolean | null | undefined,
): { putWing: number; callWing: number; shortPut: number; shortCall: number } | null {
  if (legs.length !== 4 || isCredit !== true) return null;
  const exps = new Set(legs.map((l) => l.expiration ?? ""));
  if (exps.size !== 1) return null;
  const puts = legs.filter((l) => l.optionType === "PUT");
  const calls = legs.filter((l) => l.optionType === "CALL");
  if (puts.length !== 2 || calls.length !== 2) return null;
  const shortPut = puts.find((l) => l.instruction.startsWith("SELL"));
  const longPut = puts.find((l) => l.instruction.startsWith("BUY"));
  const shortCall = calls.find((l) => l.instruction.startsWith("SELL"));
  const longCall = calls.find((l) => l.instruction.startsWith("BUY"));
  if (!shortPut || !longPut || !shortCall || !longCall) return null;
  if (shortPut.strike === shortCall.strike) return null;
  if (!(shortPut.strike > longPut.strike && longCall.strike > shortCall.strike && shortPut.strike < shortCall.strike)) {
    return null;
  }
  return {
    putWing: shortPut.strike - longPut.strike,
    callWing: longCall.strike - shortCall.strike,
    shortPut: shortPut.strike,
    shortCall: shortCall.strike,
  };
}

function legIntrinsicPerShare(leg: EconomicsLeg, spot: number): number {
  const q = leg.quantity ?? 1;
  const k = leg.strike;
  const sign = leg.instruction.startsWith("BUY") ? 1 : -1;
  const raw =
    leg.optionType === "CALL" ? Math.max(0, spot - k) : Math.max(0, k - spot);
  return sign * raw * q;
}

function portfolioValuePerShare(legs: EconomicsLeg[], spot: number): number {
  return legs.reduce((s, l) => s + legIntrinsicPerShare(l, spot), 0);
}

function payoffSampleSpots(legs: EconomicsLeg[]): number[] {
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const spots = new Set<number>([0, 1e9]);
  if (strikes.length > 0) {
    spots.add(strikes[0] - 1);
    spots.add(strikes[strikes.length - 1] + 1);
  }
  for (const k of strikes) {
    spots.add(k);
    spots.add(k - 0.001);
    spots.add(k + 0.001);
  }
  for (let i = 0; i < strikes.length - 1; i++) {
    spots.add((strikes[i] + strikes[i + 1]) / 2);
  }
  return [...spots];
}

/**
 * Max loss for a same-expiration option package with bounded payoff.
 * P/L at spot S = (mark-to-expiry value + entry cash) × 100 × spread qty.
 */
function threeLegButterflyMaxLoss(
  legs: EconomicsLeg[],
  net: number,
  spreadQty: number,
  isCredit: boolean,
): number | null {
  if (legs.length !== 3) return null;
  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const q = (l: EconomicsLeg) => l.quantity ?? 1;
  if (!(q(sorted[0]) === 1 && q(sorted[1]) === 2 && q(sorted[2]) === 1)) return null;
  const wLo = sorted[1].strike - sorted[0].strike;
  const wHi = sorted[2].strike - sorted[1].strike;
  if (wLo <= 0 || wHi <= 0) return null;
  const mult = 100 * spreadQty;
  const symmetric = Math.abs(wLo - wHi) < 1e-6;
  if (symmetric) {
    return isCredit
      ? Math.max(0, wLo - net) * mult
      : Math.max(0, net) * mult;
  }
  return isCredit
    ? Math.max(0, Math.max(wLo, wHi) - net) * mult
    : Math.max(0, Math.abs(wHi - wLo) + net) * mult;
}

export function maxLossFromExpirationPayoff(
  legs: EconomicsLeg[],
  net: number,
  spreadQty: number,
  isCredit: boolean,
): number | null {
  if (legs.length === 0) return null;
  const fly3 = threeLegButterflyMaxLoss(legs, net, spreadQty, isCredit);
  if (fly3 != null) return fly3;
  const mult = 100 * spreadQty;
  let maxLoss = 0;
  for (const spot of payoffSampleSpots(legs)) {
    const V = portfolioValuePerShare(legs, spot);
    const loss = isCredit
      ? Math.max(0, Math.abs(V) - net) * mult
      : Math.max(0, net - V) * mult;
    if (loss > maxLoss) maxLoss = loss;
  }
  return maxLoss;
}

function computeBreakevens(
  legs: EconomicsLeg[],
  net: number,
  isCredit: boolean,
  ic: ReturnType<typeof detectIronCondor>,
): number[] {
  if (ic) {
    return [ic.shortPut - net, ic.shortCall + net];
  }
  const breakevens: number[] = [];
  const allCalls = legs.every((l) => l.optionType === "CALL");
  const allPuts = legs.every((l) => l.optionType === "PUT");
  const strikes = legs.map((l) => l.strike).sort((a, b) => a - b);
  const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : 0;
  if (legs.length === 2 && width > 0) {
    const sellLeg = legs.find((l) => l.instruction.startsWith("SELL"));
    if (sellLeg) {
      if (allPuts) breakevens.push(sellLeg.strike - (isCredit ? net : -net));
      else if (allCalls) breakevens.push(sellLeg.strike + (isCredit ? net : -net));
    }
  } else if (legs.length === 2 && !allCalls && !allPuts) {
    const callLeg = legs.find((l) => l.optionType === "CALL");
    const putLeg = legs.find((l) => l.optionType === "PUT");
    if (callLeg && putLeg) {
      breakevens.push(putLeg.strike - net);
      breakevens.push(callLeg.strike + net);
    }
  }
  return breakevens;
}

export function computeOrderEconomics(input: OrderEconomicsInput): OrderEconomicsResult | null {
  const qty = Math.max(1, Math.floor(input.quantity) || 1);
  const ctx = tickContext(input);
  const net = parseCanonicalLimit(input.limitPrice, ctx, input.fallbackNetPrice ?? null);
  if (net == null || net <= 0) return null;

  const commissionPer = input.commissionPerContract ?? 0.65;
  const isOptionOrder = input.isOption !== false;
  const contracts =
    input.contractCount ??
    (input.legs && input.legs.length > 0
      ? input.legs.reduce((sum, l) => sum + ((l as { quantity?: number }).quantity ?? 1), 0) * qty
      : qty);

  const multiplier = isOptionOrder ? 100 : 1;
  const grossNotional = net * multiplier * qty;

  let maxRisk = grossNotional;
  let maxProfit = 0;

  const legs = input.legs ?? [];
  const isCredit = !!input.isCredit;
  const ic = detectIronCondor(legs, isCredit);

  if (legs.length >= 2) {
    maxRisk = maxLossFromExpirationPayoff(legs, net, qty, isCredit) ?? grossNotional;
    let maxProfitPerShare = 0;
    for (const spot of payoffSampleSpots(legs)) {
      const V = portfolioValuePerShare(legs, spot);
      const profit = isCredit ? Math.max(0, net - V) : Math.max(0, V - net);
      if (profit > maxProfitPerShare) maxProfitPerShare = profit;
    }
    maxProfit = maxProfitPerShare * 100 * qty;
  } else if (legs.length === 1 || isOptionOrder) {
    maxRisk = grossNotional;
    maxProfit = isCredit ? grossNotional : Number.POSITIVE_INFINITY;
  }

  const commissionTotal = isOptionOrder ? contracts * commissionPer : 0;
  const totalCostInclFees = grossNotional + commissionTotal;
  const totalCreditAfterFees = Math.max(0, grossNotional - commissionTotal);
  const buyingPowerEffect = isCredit ? totalCreditAfterFees : -(maxRisk + commissionTotal);

  const breakevens = legs.length >= 2 ? computeBreakevens(legs, net, isCredit, ic) : [];

  return {
    netPricePerShare: net,
    grossNotional: Number(grossNotional.toFixed(2)),
    maxRisk: Number(maxRisk.toFixed(2)),
    maxProfit: Number.isFinite(maxProfit) ? Number(maxProfit.toFixed(2)) : maxProfit,
    commissionTotal: Number(commissionTotal.toFixed(2)),
    totalCostInclFees: Number(totalCostInclFees.toFixed(2)),
    totalCreditAfterFees: Number(totalCreditAfterFees.toFixed(2)),
    buyingPowerEffect: Number(buyingPowerEffect.toFixed(2)),
    breakevens,
    isIronCondor: ic != null,
  };
}
