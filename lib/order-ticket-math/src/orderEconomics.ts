import { parseTickRoundedLimit } from "./optionTickRound.js";

export type OptionRight = "CALL" | "PUT" | string;

export interface EconomicsLeg {
  strike: number;
  optionType: OptionRight;
  instruction: string;
  expiration?: string;
}

export interface OrderEconomicsInput {
  legs?: EconomicsLeg[] | null;
  limitPrice: string | number | null | undefined;
  fallbackNetPrice?: number | null;
  quantity: number;
  isCredit?: boolean | null;
  isOption?: boolean;
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

export function computeOrderEconomics(input: OrderEconomicsInput): OrderEconomicsResult | null {
  const qty = Math.max(1, Math.floor(input.quantity) || 1);
  const net = parseTickRoundedLimit(input.limitPrice, input.fallbackNetPrice ?? null);
  if (net == null || net <= 0) return null;

  const commissionPer = input.commissionPerContract ?? 0.65;
  const contracts =
    input.contractCount ??
    (input.legs && input.legs.length > 0
      ? input.legs.reduce((sum, l) => sum + ((l as { quantity?: number }).quantity ?? 1), 0) * qty
      : qty);

  const multiplier = input.isOption === false ? 1 : 100;
  const grossNotional = net * multiplier * qty;

  let maxRisk = grossNotional;
  let maxProfit = 0;

  const legs = input.legs ?? [];
  const isCredit = !!input.isCredit;

  if (legs.length >= 2) {
    const ic = detectIronCondor(legs, isCredit);
    if (ic) {
      const wing = Math.max(ic.putWing, ic.callWing);
      maxRisk = Math.max(0, (wing - net) * 100 * qty);
      maxProfit = Math.max(0, net * 100 * qty);
    } else {
      const strikes = legs.map((l) => l.strike).sort((a, b) => a - b);
      const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : 0;
      maxRisk = Math.max(0, isCredit ? (width - net) * 100 * qty : net * 100 * qty);
      maxProfit = Math.max(0, isCredit ? net * 100 * qty : (width - net) * 100 * qty);
    }
  } else if (legs.length === 1 || input.isOption) {
    maxRisk = isCredit ? grossNotional : grossNotional;
    maxProfit = isCredit ? grossNotional : Number.POSITIVE_INFINITY;
    if (!isCredit) maxProfit = 0;
  }

  const commissionTotal = contracts * commissionPer;
  const totalCostInclFees = grossNotional + commissionTotal;
  const totalCreditAfterFees = Math.max(0, grossNotional - commissionTotal);
  const buyingPowerEffect = isCredit ? totalCreditAfterFees : -(maxRisk + commissionTotal);

  return {
    netPricePerShare: net,
    grossNotional: Number(grossNotional.toFixed(2)),
    maxRisk: Number(maxRisk.toFixed(2)),
    maxProfit: Number.isFinite(maxProfit) ? Number(maxProfit.toFixed(2)) : maxProfit,
    commissionTotal: Number(commissionTotal.toFixed(2)),
    totalCostInclFees: Number(totalCostInclFees.toFixed(2)),
    totalCreditAfterFees: Number(totalCreditAfterFees.toFixed(2)),
    buyingPowerEffect: Number(buyingPowerEffect.toFixed(2)),
  };
}