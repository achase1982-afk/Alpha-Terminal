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
