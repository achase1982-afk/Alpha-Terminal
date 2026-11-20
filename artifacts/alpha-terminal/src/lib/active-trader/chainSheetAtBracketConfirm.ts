import type { ActiveTraderTemplatePrefs } from "./activeTraderPrefs";
import { buildAtTriggerConfirmSummary } from "./atTriggerConfirmSummary";
import { planAtOrderLegs, type AtOrderBuildInput, type SchwabInstruction } from "./atSchwabOrderBuilder";
import type { TriggerConfirmSummary } from "@/lib/orders/triggerOrderConfirmSummary";

export type ChainSheetAtBracketConfirm =
  | { mode: "single" }
  | { mode: "trigger"; summary: TriggerConfirmSummary; primaryInstruction: SchwabInstruction; quantity: number }
  | { mode: "unsupported"; message: string; testId: "at-chain-bracket-unsupported" };

function bracketDraftActive(prefs: ActiveTraderTemplatePrefs): boolean {
  return (
    prefs.template !== "Single" || !!(prefs.takeProfit?.enabled || prefs.stopLoss?.enabled)
  );
}

/** Human package line for a multi-leg confirm, e.g. `SPXW 7000C/7005C/7000P/6995P`. */
export function spreadConfirmContractLine(
  legs: Array<{ strike: number; optionType: string; schwabSymbol?: string | null }>,
  underlying: string,
): string {
  const occRoot = legs
    .map((leg) => {
      const sym = leg.schwabSymbol?.trim() ?? "";
      if (sym.length < 15) return "";
      return sym.slice(0, sym.length - 15).trim();
    })
    .find((root) => root.length > 0);
  const root = occRoot || underlying.replace(/^\$/, "").trim().toUpperCase() || "OPT";
  const parts = legs.map((leg) => {
    const cp = leg.optionType.toUpperCase().startsWith("P") ? "P" : "C";
    const strikeText = Number.isInteger(leg.strike) ? String(leg.strike) : String(leg.strike);
    return `${strikeText}${cp}`;
  });
  return `${root} ${parts.join("/")}`;
}

/** Build AT bracket trigger confirm for chain-sheet review from the same draft inputs as OrderTicket. */
export function buildChainSheetAtBracketConfirm(input: {
  prefs: ActiveTraderTemplatePrefs;
  legCount: number;
  primaryInstruction: SchwabInstruction;
  limitPrice: number;
  optionSymbol: string;
  underlyingSymbol: string;
  assetType?: "OPTION" | "EQUITY";
  quantityOverride?: number;
  contractLine?: string;
  contractCountForFees?: number;
}): ChainSheetAtBracketConfirm {
  if (!bracketDraftActive(input.prefs)) {
    return { mode: "single" };
  }

  const assetType = input.assetType ?? "OPTION";
  const effectiveQty = input.quantityOverride ?? input.prefs.qty;
  const isSpread = assetType === "OPTION" && input.legCount > 1;

  if (isSpread && input.prefs.stopLoss?.enabled) {
    return {
      mode: "unsupported",
      testId: "at-chain-bracket-unsupported",
      message:
        "Stop loss is not supported on multi-leg spreads in this builder. Use take profit only or switch to Single.",
    };
  }

  if (input.limitPrice <= 0 || !Number.isFinite(input.limitPrice)) {
    return {
      mode: "unsupported",
      testId: "at-chain-bracket-unsupported",
      message: "Set a valid limit price before reviewing bracket exits.",
    };
  }

  const buildInput: AtOrderBuildInput = {
    template: input.prefs.template,
    assetType,
    symbol: input.optionSymbol,
    underlyingSymbol: input.underlyingSymbol,
    primaryInstruction: input.primaryInstruction,
    quantity: effectiveQty,
    limitPrice: input.limitPrice,
    takeProfit: input.prefs.takeProfit,
    stopLoss: input.prefs.stopLoss,
    entryOrderType: input.prefs.orderType,
    exitDuration: input.prefs.exitDuration,
    stopLossOrderType: input.prefs.stopLossOrderType,
    stopLimitOffset: input.prefs.stopLimitOffset,
    isSpread,
  };

  const planned = planAtOrderLegs(buildInput);

  if (planned.validationError) {
    return {
      mode: "unsupported",
      testId: "at-chain-bracket-unsupported",
      message: planned.validationError,
    };
  }

  if (planned.legs.length < 2) {
    if (input.prefs.template === "TRG w/ bracket" || input.prefs.template === "OCO") {
      return {
        mode: "unsupported",
        testId: "at-chain-bracket-unsupported",
        message: "Enable take profit or stop loss — bracket template requires at least one exit leg.",
      };
    }
    return { mode: "single" };
  }

  const summary = buildAtTriggerConfirmSummary({
    legs: planned.legs,
    quantity: effectiveQty,
    optionSymbol: input.optionSymbol,
    underlyingSymbol: input.underlyingSymbol,
    assetType,
    contractLine: input.contractLine,
    contractCountForFees: input.contractCountForFees,
  });

  if (!summary) {
    return {
      mode: "unsupported",
      testId: "at-chain-bracket-unsupported",
      message: "Could not build bracket exit preview for this draft.",
    };
  }

  return {
    mode: "trigger",
    summary,
    primaryInstruction: input.primaryInstruction,
    quantity: effectiveQty,
  };
}