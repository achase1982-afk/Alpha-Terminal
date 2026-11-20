import type { AtPlannedLeg } from "./atSchwabOrderBuilder";
import {
  buildTriggerOrderConfirmSummary,
  parseOccOptionContractLine,
  type TriggerConfirmSummary,
} from "@/lib/orders/triggerOrderConfirmSummary";
import type { SchwabInstruction } from "./atSchwabOrderBuilder";

export function buildAtTriggerConfirmSummary(params: {
  legs: AtPlannedLeg[];
  quantity: number;
  optionSymbol: string;
  underlyingSymbol: string;
  assetType?: "OPTION" | "EQUITY";
  /** Package description for a multi-leg entry. Single contracts keep the OCC line. */
  contractLine?: string;
  /** Contracts charged a commission. Spreads are more than the package quantity. */
  contractCountForFees?: number;
}): TriggerConfirmSummary | null {
  if (params.legs.length < 2) return null;
  const isEquity = params.assetType === "EQUITY";
  const cleanUnderlying = params.underlyingSymbol.replace(/^\$/, "").trim().toUpperCase();
  const contractLine =
    params.contractLine?.trim() ||
    (isEquity
      ? `${cleanUnderlying} SHARES`
      : parseOccOptionContractLine(params.optionSymbol, params.underlyingSymbol));
  const orders = params.legs.map((leg, idx) => {
    const orderNumber = idx + 1;
    const instruction = leg.instruction as SchwabInstruction;
    return {
      orderNumber,
      isTriggerParent: orderNumber === 1,
      triggeredByOrder: orderNumber === 1 ? undefined : 1,
      instruction,
      quantity: params.quantity,
      contractLine,
      limitPrice: leg.price ?? 0,
      orderType: (leg.orderType === "STOP" ? "STOP" : "LIMIT") as "LIMIT" | "STOP",
      contractCountForFees: isEquity ? 0 : (params.contractCountForFees ?? params.quantity),
      assetType: params.assetType ?? "OPTION",
    };
  });

  const childLegs = orders.filter((o) => o.orderNumber > 1);
  const hasOco = childLegs.length >= 2;

  const tpLeg = params.legs.find((l) => l.orderType !== "STOP" && l.role !== "1st");
  const slLeg = params.legs.find((l) => l.orderType === "STOP");

  let breakevenLines: string[] | undefined;
  const entry = params.legs[0];
  if (isEquity && entry?.price != null && entry.price > 0) {
    breakevenLines = [`Break-even: $${entry.price.toFixed(2)} / sh`];
  } else if (entry.price != null && entry.instruction.startsWith("BUY_TO_OPEN")) {
    const occ = parseOccOptionContractLine(params.optionSymbol, params.underlyingSymbol);
    const strikeMatch = occ.match(/(\d+(?:\.\d+)?)\s+(CALL|PUT)/);
    if (strikeMatch) {
      const strike = parseFloat(strikeMatch[1]);
      const be = strike + entry.price;
      breakevenLines = [`Break-even (est.): underlying ≈ ${be.toFixed(2)} at expiration (long ${strikeMatch[2].toLowerCase()})`];
    }
  }

  return buildTriggerOrderConfirmSummary({
    orders,
    combinedIfAllFill: hasOco ? undefined : {},
    ocoOutcomes: hasOco
      ? [
          ...(tpLeg ? [{ label: "If TP fills", exitOrderNumber: params.legs.indexOf(tpLeg) + 1 }] : []),
          ...(slLeg ? [{ label: "If SL fills", exitOrderNumber: params.legs.indexOf(slLeg) + 1 }] : []),
        ]
      : undefined,
    breakevenLines,
  });
}