import type { EconomicsLeg } from "./orderEconomics.js";

export type BuyingPowerEffectKind =
  | "estimated"
  | "cash_secured"
  | "not_estimated"
  | "none";

export interface BuyingPowerResolution {
  buyingPowerEffect: number | null;
  buyingPowerEffectKind: BuyingPowerEffectKind;
  buyingPowerEffectIsEstimate: boolean;
}

function isClosingInstruction(instruction: string): boolean {
  return instruction.includes("CLOSE") || instruction === "SELL";
}

function isSellToOpen(instruction: string): boolean {
  return instruction.startsWith("SELL") && !instruction.includes("CLOSE");
}

/** Single-leg cash-secured short put (naked short put). */
export function isCashSecuredShortPut(legs: EconomicsLeg[], isCredit: boolean): boolean {
  if (!isCredit || legs.length !== 1) return false;
  const leg = legs[0];
  return leg.optionType === "PUT" && isSellToOpen(leg.instruction);
}

export function cashSecuredPutCollateral(
  leg: EconomicsLeg,
  spreadUnits: number,
  netPerShare: number,
): number {
  const strike = leg.strike;
  const qty = (leg.quantity ?? 1) * spreadUnits;
  const collateral = strike * 100 * qty;
  const premium = netPerShare * 100 * qty;
  return Math.max(0, collateral - premium);
}

export function resolveBuyingPowerEffect(input: {
  legs: EconomicsLeg[];
  isCredit: boolean;
  isOption: boolean;
  maxRisk: number | null;
  grossNotional: number;
  commissionTotal: number;
  netPerShare: number;
  spreadUnits: number;
  closesPosition?: boolean;
}): BuyingPowerResolution {
  if (input.closesPosition) {
    return {
      buyingPowerEffect: null,
      buyingPowerEffectKind: "none",
      buyingPowerEffectIsEstimate: false,
    };
  }

  const closingOnly =
    input.legs.length > 0 && input.legs.every((l) => isClosingInstruction(l.instruction));
  if (closingOnly) {
    return {
      buyingPowerEffect: null,
      buyingPowerEffectKind: "none",
      buyingPowerEffectIsEstimate: false,
    };
  }

  if (input.isCredit) {
    if (input.maxRisk != null) {
      return {
        buyingPowerEffect: -input.maxRisk,
        buyingPowerEffectKind: "estimated",
        buyingPowerEffectIsEstimate: true,
      };
    }
    if (isCashSecuredShortPut(input.legs, input.isCredit)) {
      const collateral = cashSecuredPutCollateral(
        input.legs[0],
        input.spreadUnits,
        input.netPerShare,
      );
      return {
        buyingPowerEffect: -Number(collateral.toFixed(2)),
        buyingPowerEffectKind: "cash_secured",
        buyingPowerEffectIsEstimate: true,
      };
    }
    return {
      buyingPowerEffect: null,
      buyingPowerEffectKind: "not_estimated",
      buyingPowerEffectIsEstimate: true,
    };
  }

  const riskForBp = input.maxRisk ?? input.grossNotional;
  return {
    buyingPowerEffect: -Number((riskForBp + input.commissionTotal).toFixed(2)),
    buyingPowerEffectKind: "estimated",
    buyingPowerEffectIsEstimate: true,
  };
}