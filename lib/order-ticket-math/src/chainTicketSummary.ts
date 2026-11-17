import { aggregateSpreadNBBO } from "./optionQuotes.js";
import { computeOrderEconomics, type EconomicsLeg } from "./orderEconomics.js";
import {
  analyzeExpirationPayoff,
  payoffDollarsAtS,
  type ExpirationPayoffInput,
  type PayoffLeg,
} from "./expirationPayoff.js";
import { inferNetCreditFromLegStructure } from "./schwabOrderRisk.js";
import { parseCanonicalLimit, type LimitTickContext } from "./optionTickRound.js";
import {
  averageLegIv,
  computeOptionPopFromPayoff,
  yearsToExpiration,
} from "./optionPop.js";

export interface ChainTicketLegQuote extends EconomicsLeg {
  bid?: number | null;
  ask?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  iv?: number | null;
}

export interface ChainTicketSummaryInput {
  legs: ChainTicketLegQuote[];
  /** Limit per spread unit (per-share premium). */
  limitPrice: string | number | null | undefined;
  spreadQuantity: number;
  underlyingSymbol: string;
  /** When set, skip leg-structure credit/debit inference. */
  isCredit?: boolean | null;
  /** Spot for lognormal POP (required for reliable POP). */
  spotPrice?: number | null;
  /** Reference time for DTE (default `Date.now()`). */
  asOfMs?: number;
}

export interface ChainTicketSummary {
  spreadMid: number | null;
  spreadBid: number | null;
  spreadAsk: number | null;
  spreadCrossed: boolean;
  isCredit: boolean;
  limitPerShare: number | null;
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  buyingPowerEffect: number | null;
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  pop: number | null;
  grossNotional: number | null;
}

function tickCtx(symbol: string): LimitTickContext {
  return { underlyingSymbol: symbol, isOption: true };
}

function midFromLeg(bid?: number | null, ask?: number | null): number | null {
  if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (bid > ask) return null;
  return (bid + ask) / 2;
}

function inferCreditFromMids(legs: ChainTicketLegQuote[]): boolean | null {
  let net = 0;
  let complete = true;
  for (const leg of legs) {
    const mid = midFromLeg(leg.bid, leg.ask);
    if (mid == null) {
      complete = false;
      break;
    }
    const q = leg.quantity ?? 1;
    const isBuy = leg.instruction.startsWith("BUY");
    net += isBuy ? mid * q : -mid * q;
  }
  if (!complete) return null;
  if (Math.abs(net) < 1e-9) return null;
  return net < 0;
}

export function computeChainTicketSummary(input: ChainTicketSummaryInput): ChainTicketSummary | null {
  if (input.legs.length === 0) return null;
  const ctx = tickCtx(input.underlyingSymbol);
  const qty = Math.max(1, Math.floor(input.spreadQuantity) || 1);

  const agg = aggregateSpreadNBBO(
    input.legs.map((l) => ({
      instruction: l.instruction,
      bid: l.bid,
      ask: l.ask,
      quantity: l.quantity,
    })),
  );

  const inferred =
    input.isCredit ??
    inferNetCreditFromLegStructure(input.legs) ??
    inferCreditFromMids(input.legs) ??
    false;

  const fallbackMid = agg?.mid ?? null;
  const limitPerShare = parseCanonicalLimit(input.limitPrice, ctx, fallbackMid);
  if (limitPerShare == null || limitPerShare <= 0) {
    let netDelta = 0;
    let netGamma = 0;
    let netTheta = 0;
    let netVega = 0;
    for (const leg of input.legs) {
      const sign = leg.instruction.startsWith("BUY") ? 1 : -1;
      const lq = (leg.quantity ?? 1) * qty;
      if (leg.delta != null) netDelta += leg.delta * lq * sign;
      if (leg.gamma != null) netGamma += leg.gamma * lq * sign;
      if (leg.theta != null) netTheta += leg.theta * lq * sign;
      if (leg.vega != null) netVega += leg.vega * lq * sign;
    }
    const pop: number | null = null;
    return {
      spreadMid: agg?.mid ?? null,
      spreadBid: agg?.bid ?? null,
      spreadAsk: agg?.ask ?? null,
      spreadCrossed: agg?.crossed ?? false,
      isCredit: inferred,
      limitPerShare: null,
      maxProfit: null,
      maxLoss: null,
      breakevens: [],
      buyingPowerEffect: null,
      netDelta: netDelta * 100,
      netGamma: netGamma * 100,
      netTheta: netTheta * 100,
      netVega: netVega * 100,
      pop,
      grossNotional: null,
    };
  }

  const econ = computeOrderEconomics({
    underlyingSymbol: input.underlyingSymbol,
    isOption: true,
    legs: input.legs,
    limitPrice: limitPerShare,
    quantity: qty,
    isCredit: inferred,
    contractCount: input.legs.reduce((s, l) => s + (l.quantity ?? 1), 0) * qty,
  });

  let netDelta = 0;
  let netGamma = 0;
  let netTheta = 0;
  let netVega = 0;
  for (const leg of input.legs) {
    const sign = leg.instruction.startsWith("BUY") ? 1 : -1;
    const lq = (leg.quantity ?? 1) * qty;
    if (leg.delta != null) netDelta += leg.delta * lq * sign;
    if (leg.gamma != null) netGamma += leg.gamma * lq * sign;
    if (leg.theta != null) netTheta += leg.theta * lq * sign;
    if (leg.vega != null) netVega += leg.vega * lq * sign;
  }
  const exp =
    input.legs.map((l) => l.expiration).find((e) => e && e.trim().length > 0) ?? "";
  const tYears = exp ? yearsToExpiration(exp, input.asOfMs ?? Date.now()) : null;
  const iv = averageLegIv(input.legs);
  let pop: number | null = null;
  if (
    input.spotPrice != null &&
    input.spotPrice > 0 &&
    tYears != null &&
    iv != null &&
    (econ?.breakevens?.length ?? 0) > 0
  ) {
    const payoff: ExpirationPayoffInput = {
      legs: input.legs.map((l) => ({
        strike: l.strike,
        optionType: l.optionType,
        instruction: l.instruction,
        expiration: l.expiration,
        quantity: l.quantity,
      })),
      netPerShare: limitPerShare,
      spreadUnits: qty,
      isCredit: inferred,
      isOption: true,
    };
    pop = computeOptionPopFromPayoff({
      spot: input.spotPrice,
      breakevens: econ?.breakevens ?? [],
      iv,
      tYears,
      payoff,
    });
  }

  return {
    spreadMid: agg?.mid ?? null,
    spreadBid: agg?.bid ?? null,
    spreadAsk: agg?.ask ?? null,
    spreadCrossed: agg?.crossed ?? false,
    isCredit: inferred,
    limitPerShare,
    maxProfit: econ && Number.isFinite(econ.maxProfit) ? econ.maxProfit : null,
    maxLoss: econ?.maxRisk ?? null,
    breakevens: econ?.breakevens ?? [],
    buyingPowerEffect: econ?.buyingPowerEffect ?? null,
    netDelta: netDelta * 100,
    netGamma: netGamma * 100,
    netTheta: netTheta * 100,
    netVega: netVega * 100,
    pop,
    grossNotional: econ?.grossNotional ?? null,
  };
}

/** Test helper: dense scan reference for expiration payoff (same as expirationPayoff tests). */
export function referenceBruteForcePayoff(input: ExpirationPayoffInput): {
  maxLoss: number | null;
  maxProfit: number;
  breakevens: number[];
} {
  const strikes = input.legs
    .filter((l) => l.optionType === "CALL" || l.optionType === "PUT")
    .map((l) => l.strike);
  const hi = strikes.length ? Math.max(...strikes) + 25 : 50;
  let minP = Infinity;
  let maxP = -Infinity;
  for (let s = 0; s <= hi; s += 0.25) {
    const p = payoffDollarsAtS(input, s);
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }
  let slope = 0;
  for (const leg of input.legs as PayoffLeg[]) {
    if (leg.optionType === "CALL") {
      const q = leg.quantity ?? 1;
      slope += leg.instruction.startsWith("BUY") ? q : -q;
    }
  }
  const dollarRight = slope * 100 * input.spreadUnits;
  const unboundedLoss = dollarRight < 0;
  const maxLoss = unboundedLoss ? null : Math.max(0, -minP);
  const maxProfit = dollarRight > 0 ? Number.POSITIVE_INFINITY : Math.max(0, maxP);
  const engine = analyzeExpirationPayoff(input);
  return { maxLoss, maxProfit, breakevens: engine.breakevens };
}