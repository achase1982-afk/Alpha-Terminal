import { computeOrderEconomics, midpointFromBidAsk } from "@workspace/order-ticket-math";

export interface OptionLeg {
  direction: 'STO' | 'BTO';
  quantity: number;
  strike: number;
  type: 'P' | 'C';
  midPrice: number;
}

export interface CreditSpread {
  shortLeg: OptionLeg;
  longLeg: OptionLeg;
  underlyingPrice: number;
  quantity: number;
  expiration: string;
}

export interface StrategyLegLite {
  strike: number;
  optionType: 'CALL' | 'PUT' | string;
  instruction: string;
  expiration?: string;
  bid?: number | null;
  ask?: number | null;
}

export interface IronCondorShape {
  shortPut: StrategyLegLite;
  longPut: StrategyLegLite;
  shortCall: StrategyLegLite;
  longCall: StrategyLegLite;
  putWing: number;
  callWing: number;
}

export function detectIronCondor(
  legs: StrategyLegLite[] | null | undefined,
  isCredit: boolean | null | undefined,
): IronCondorShape | null {
  if (!legs || legs.length !== 4) return null;
  if (isCredit !== true) return null;
  const exps = new Set(legs.map(l => l.expiration ?? ''));
  if (exps.size !== 1) return null;
  // If leg quotes are populated, verify the structure is genuinely net credit
  // (sum of shorts mid > sum of longs mid) per IC spec.
  const havePrices = legs.every(l => typeof l.bid === 'number' && typeof l.ask === 'number');
  if (havePrices) {
    let shortsMid = 0;
    let longsMid = 0;
    for (const l of legs) {
      const mid = midpointFromBidAsk(l.bid, l.ask);
      if (mid == null) return null;
      if (l.instruction.startsWith('SELL')) shortsMid += mid;
      else if (l.instruction.startsWith('BUY')) longsMid += mid;
    }
    if (!(shortsMid > longsMid)) return null;
  }
  const puts = legs.filter(l => l.optionType === 'PUT');
  const calls = legs.filter(l => l.optionType === 'CALL');
  if (puts.length !== 2 || calls.length !== 2) return null;
  const shortPut = puts.find(l => l.instruction.startsWith('SELL'));
  const longPut = puts.find(l => l.instruction.startsWith('BUY'));
  const shortCall = calls.find(l => l.instruction.startsWith('SELL'));
  const longCall = calls.find(l => l.instruction.startsWith('BUY'));
  if (!shortPut || !longPut || !shortCall || !longCall) return null;
  if (!(shortPut.strike > longPut.strike)) return null;
  if (!(longCall.strike > shortCall.strike)) return null;
  if (!(shortPut.strike < shortCall.strike)) return null;
  return {
    shortPut, longPut, shortCall, longCall,
    putWing: shortPut.strike - longPut.strike,
    callWing: longCall.strike - shortCall.strike,
  };
}

export interface StrategyEconomics {
  maxRisk: number;
  maxProfit: number;
  breakevens: number[];
  isIronCondor: boolean;
}

export function computeStrategyEconomics(opts: {
  legs: StrategyLegLite[] | null | undefined;
  netPrice: number;
  quantity: number;
  isCredit: boolean | null | undefined;
  underlyingSymbol?: string;
}): StrategyEconomics {
  const { legs, quantity, isCredit } = opts;
  if (!legs || legs.length === 0) {
    return { maxRisk: 0, maxProfit: 0, breakevens: [], isIronCondor: false };
  }
  const econ = computeOrderEconomics({
    legs,
    limitPrice: opts.netPrice,
    quantity,
    isCredit,
    isOption: true,
    underlyingSymbol: opts.underlyingSymbol ?? "SPY",
  });
  if (!econ) {
    return { maxRisk: 0, maxProfit: 0, breakevens: [], isIronCondor: false };
  }
  return {
    maxRisk: econ.maxRisk,
    maxProfit: econ.maxProfit,
    breakevens: econ.breakevens,
    isIronCondor: econ.isIronCondor,
  };
}

export const calculateBullPutSpread = (spread: CreditSpread) => {
  const { shortLeg, longLeg, quantity } = spread;

  const netCreditPerShare = shortLeg.midPrice - longLeg.midPrice;
  const strikeWidth = shortLeg.strike - longLeg.strike;

  const maxProfit = netCreditPerShare * 100 * quantity;
  const maxRisk = (strikeWidth - netCreditPerShare) * 100 * quantity;
  const breakeven = shortLeg.strike - netCreditPerShare;
  const rewardRiskRatio = maxProfit / maxRisk;

  return {
    netCreditPerShare: Number(netCreditPerShare.toFixed(3)),
    maxProfit: Number(maxProfit.toFixed(2)),
    maxRisk: Number(maxRisk.toFixed(2)),
    breakeven: Number(breakeven.toFixed(3)),
    rewardRiskRatio: Number(rewardRiskRatio.toFixed(2)),
    estCreditDollars: Number((netCreditPerShare * 100 * quantity).toFixed(2)),
    netPriceForDisplay: Number(netCreditPerShare.toFixed(2)),
  };
};
