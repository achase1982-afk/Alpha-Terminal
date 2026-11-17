/** Schwab options commission (per contract, per order). */
export const SCHWAB_OPTION_COMMISSION_PER_CONTRACT = 0.65;

/** ORF/SEC/TAF-style regulatory bundle (est., per contract). */
export const SCHWAB_REGULATORY_FEE_EST_PER_CONTRACT = 0.02;

export interface SchwabOrderFeeEstimate {
  commission: number;
  regulatoryEst: number;
  totalEst: number;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function estimateSchwabOptionFees(contractQty: number): SchwabOrderFeeEstimate {
  const q = Math.max(0, contractQty);
  const commission = roundMoney(q * SCHWAB_OPTION_COMMISSION_PER_CONTRACT);
  const regulatoryEst = roundMoney(q * SCHWAB_REGULATORY_FEE_EST_PER_CONTRACT);
  return { commission, regulatoryEst, totalEst: roundMoney(commission + regulatoryEst) };
}

export function isCreditInstruction(instruction: string): boolean {
  return instruction.startsWith("SELL");
}

export function grossOptionPremiumDollars(pricePerContract: number, quantity: number): number {
  return roundMoney(Math.abs(pricePerContract) * Math.max(1, quantity) * 100);
}

export interface OrderNetCashFlow {
  gross: number;
  isCredit: boolean;
  commission: number;
  regulatoryEst: number;
  net: number;
  netIsCredit: boolean;
}

export function computeOrderNetCash(
  gross: number,
  isCredit: boolean,
  contractQty: number,
  feeOverride?: { commission: number; regulatoryEst: number },
): OrderNetCashFlow {
  const fees = feeOverride ?? estimateSchwabOptionFees(contractQty);
  const feeTotal = fees.commission + fees.regulatoryEst;
  if (isCredit) {
    const net = roundMoney(gross - feeTotal);
    return {
      gross,
      isCredit: true,
      commission: fees.commission,
      regulatoryEst: fees.regulatoryEst,
      net,
      netIsCredit: true,
    };
  }
  const net = roundMoney(gross + feeTotal);
  return {
    gross,
    isCredit: false,
    commission: fees.commission,
    regulatoryEst: fees.regulatoryEst,
    net,
    netIsCredit: false,
  };
}

export function formatMoneySigned(amount: number, isCredit: boolean): string {
  const label = isCredit ? "credit" : "debit";
  return `${label} $${amount.toFixed(2)}`;
}