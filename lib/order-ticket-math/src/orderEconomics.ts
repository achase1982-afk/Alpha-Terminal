import { resolveBuyingPowerEffect, type BuyingPowerEffectKind } from "./buyingPowerEffect.js";
import { analyzeExpirationPayoff, type PayoffLeg } from "./expirationPayoff.js";
import { isSingleExpiryStrategy } from "./expiryGate.js";
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
  commissionPerContract?: number;
  contractCount?: number;
  /** Close / sell-to-close: cash proceeds only, no BP reserve estimate. */
  closesPosition?: boolean;
}

export interface OrderEconomicsResult {
  netPricePerShare: number;
  grossNotional: number;
  maxRisk: number | null;
  /** Null when payoff is not modeled (e.g. multi-expiry calendar). */
  maxProfit: number | null;
  commissionTotal: number;
  totalCostInclFees: number;
  totalCreditAfterFees: number;
  /** Signed cash after fees: positive = credit received, negative = debit paid. */
  netCashFlow: number;
  /** Collateral / BP reserved (≤ 0 when set). Never premium credit. */
  buyingPowerEffect: number | null;
  buyingPowerEffectKind: BuyingPowerEffectKind;
  /** True unless broker-reported BP is wired in. */
  buyingPowerEffectIsEstimate: boolean;
  breakevens: number[];
  isIronCondor: boolean;
  /** False for multi-expiry structures where expiration payoff is not run. */
  expirationPayoffModeled: boolean;
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
): boolean {
  if (legs.length !== 4 || isCredit !== true) return false;
  const exps = new Set(legs.map((l) => l.expiration ?? ""));
  if (exps.size !== 1) return false;
  const puts = legs.filter((l) => l.optionType === "PUT");
  const calls = legs.filter((l) => l.optionType === "CALL");
  if (puts.length !== 2 || calls.length !== 2) return false;
  const shortPut = puts.find((l) => l.instruction.startsWith("SELL"));
  const longPut = puts.find((l) => l.instruction.startsWith("BUY"));
  const shortCall = calls.find((l) => l.instruction.startsWith("SELL"));
  const longCall = calls.find((l) => l.instruction.startsWith("BUY"));
  if (!shortPut || !longPut || !shortCall || !longCall) return false;
  if (shortPut.strike === shortCall.strike) return false;
  return (
    shortPut.strike > longPut.strike &&
    longCall.strike > shortCall.strike &&
    shortPut.strike < shortCall.strike
  );
}

function stockPayoffLegs(qty: number, isCredit: boolean): PayoffLeg[] {
  return [
    {
      strike: 0,
      optionType: "EQUITY",
      instruction: isCredit ? "SELL_SHORT" : "BUY",
      quantity: qty,
      assetType: "EQUITY",
    },
  ];
}

export function computeOrderEconomics(input: OrderEconomicsInput): OrderEconomicsResult | null {
  const qty = Math.max(1, Math.floor(input.quantity) || 1);
  const ctx = tickContext(input);
  const net = parseCanonicalLimit(input.limitPrice, ctx, input.fallbackNetPrice ?? null);
  if (net == null || net <= 0) return null;

  const commissionPer = input.commissionPerContract ?? 0.65;
  const isOptionOrder = input.isOption !== false;
  const isCredit = !!input.isCredit;
  const legs = input.legs ?? [];
  const contracts =
    input.contractCount ??
    (legs.length > 0
      ? legs.reduce((sum, l) => sum + (l.quantity ?? 1), 0) * qty
      : qty);

  const multiplier = isOptionOrder ? 100 : 1;
  const grossNotional = net * multiplier * qty;

  const payoffLegs: PayoffLeg[] =
    !isOptionOrder && legs.length === 0
      ? stockPayoffLegs(qty, isCredit)
      : legs.map((l) => ({ ...l }));

  const expirationPayoffModeled =
    isOptionOrder && legs.length > 0 ? isSingleExpiryStrategy(legs) : true;

  const payoff = expirationPayoffModeled
    ? analyzeExpirationPayoff({
        legs: payoffLegs,
        netPerShare: net,
        spreadUnits: qty,
        isCredit,
        isOption: isOptionOrder,
      })
    : { maxLoss: null, maxProfit: null as number | null, breakevens: [] as number[] };

  const maxRisk = expirationPayoffModeled ? payoff.maxLoss : null;
  const maxProfit = expirationPayoffModeled
    ? Number.isFinite(payoff.maxProfit)
      ? payoff.maxProfit
      : null
    : null;

  const commissionTotal = isOptionOrder ? contracts * commissionPer : 0;
  const totalCostInclFees = grossNotional + commissionTotal;
  const totalCreditAfterFees = Math.max(0, grossNotional - commissionTotal);
  const netCashFlow = isCredit
    ? totalCreditAfterFees
    : -totalCostInclFees;

  const bp = resolveBuyingPowerEffect({
    legs,
    isCredit,
    isOption: isOptionOrder,
    maxRisk,
    grossNotional,
    commissionTotal,
    netPerShare: net,
    spreadUnits: qty,
    closesPosition: input.closesPosition === true,
  });

  return {
    netPricePerShare: net,
    grossNotional: Number(grossNotional.toFixed(2)),
    maxRisk: maxRisk != null ? Number(maxRisk.toFixed(2)) : null,
    maxProfit:
      maxProfit != null && Number.isFinite(maxProfit) ? Number(maxProfit.toFixed(2)) : null,
    commissionTotal: Number(commissionTotal.toFixed(2)),
    totalCostInclFees: Number(totalCostInclFees.toFixed(2)),
    totalCreditAfterFees: Number(totalCreditAfterFees.toFixed(2)),
    netCashFlow: Number(netCashFlow.toFixed(2)),
    buyingPowerEffect:
      bp.buyingPowerEffect != null ? Number(bp.buyingPowerEffect.toFixed(2)) : null,
    buyingPowerEffectKind: bp.buyingPowerEffectKind,
    buyingPowerEffectIsEstimate: bp.buyingPowerEffectIsEstimate,
    breakevens: expirationPayoffModeled ? payoff.breakevens : [],
    isIronCondor: detectIronCondor(legs, isCredit),
    expirationPayoffModeled,
  };
}
