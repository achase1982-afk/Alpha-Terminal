import { estimateSchwabOptionFees, roundMoney } from "@/lib/orders/schwabOrderFees";
import type { ActiveTraderTemplatePrefs } from "./activeTraderPrefs";
import {
  buildChainSheetAtBracketConfirm,
  type ChainSheetAtBracketConfirm,
} from "./chainSheetAtBracketConfirm";
import { planAtOrderLegs, type AtOrderBuildInput, type SchwabInstruction } from "./atSchwabOrderBuilder";

export type ChainSheetBracketEconomics = {
  targetExitDollars: number | null;
  estNetProfit: number | null;
  estNetUnavailable: boolean;
  bracketConfirm: ChainSheetAtBracketConfirm;
  /** Shared exit limit per spread (premium) from the order builder, when TP is enabled. */
  takeProfitLimit: number | null;
};

function atOrderBuildInput(input: {
  prefs: ActiveTraderTemplatePrefs;
  primaryInstruction: SchwabInstruction;
  lockedLimit: number;
  legCount: number;
  optionSymbol: string;
  underlyingSymbol: string;
  spreadQuantity: number;
  assetType?: "OPTION" | "EQUITY";
}): AtOrderBuildInput {
  const assetType = input.assetType ?? "OPTION";
  return {
    template: input.prefs.template,
    assetType,
    symbol: input.optionSymbol,
    underlyingSymbol: input.underlyingSymbol,
    primaryInstruction: input.primaryInstruction,
    quantity: input.spreadQuantity,
    limitPrice: input.lockedLimit,
    takeProfit: input.prefs.takeProfit,
    stopLoss: input.prefs.stopLoss,
    entryOrderType: input.prefs.orderType,
    exitDuration: input.prefs.exitDuration,
    stopLossOrderType: input.prefs.stopLossOrderType,
    stopLimitOffset: input.prefs.stopLimitOffset,
    isSpread: assetType === "OPTION" && input.legCount > 1,
  };
}

/**
 * One calculated exit for dock, review confirm, and Schwab bracket preview — uses the
 * locked entry limit and saved bracket prefs (not live bid/ask).
 */
export function buildChainSheetBracketEconomics(input: {
  prefs: ActiveTraderTemplatePrefs;
  primaryInstruction: SchwabInstruction;
  lockedLimit: number | null;
  legCount: number;
  optionSymbol: string;
  underlyingSymbol: string;
  spreadQuantity: number;
  totalContracts: number;
  entryGrossDollars: number | null;
  isCredit: boolean;
  assetType?: "OPTION" | "EQUITY";
  /** Multi-leg package line. Single contracts keep the OCC description. */
  contractLine?: string;
}): ChainSheetBracketEconomics {
  const assetType = input.assetType ?? "OPTION";
  const multiplier = assetType === "EQUITY" ? 1 : 100;
  const bracketConfirm =
    input.lockedLimit != null && input.lockedLimit > 0
      ? buildChainSheetAtBracketConfirm({
          prefs: input.prefs,
          legCount: input.legCount,
          primaryInstruction: input.primaryInstruction,
          limitPrice: input.lockedLimit,
          optionSymbol: input.optionSymbol,
          underlyingSymbol: input.underlyingSymbol,
          assetType,
          quantityOverride: input.spreadQuantity,
          contractLine: input.contractLine,
          contractCountForFees: input.totalContracts > 0 ? input.totalContracts : undefined,
        })
      : ({
          mode: "unsupported",
          testId: "at-chain-bracket-unsupported",
          message: "Set a valid locked limit before reviewing bracket exits.",
        } as const);

  if (input.lockedLimit == null || input.lockedLimit <= 0 || !Number.isFinite(input.lockedLimit)) {
    return {
      targetExitDollars: null,
      estNetProfit: null,
      estNetUnavailable: true,
      bracketConfirm,
      takeProfitLimit: null,
    };
  }

  const tpEnabled = !!input.prefs.takeProfit?.enabled;
  const planned = planAtOrderLegs(
    atOrderBuildInput({
      prefs: input.prefs,
      primaryInstruction: input.primaryInstruction,
      lockedLimit: input.lockedLimit,
      legCount: input.legCount,
      optionSymbol: input.optionSymbol,
      underlyingSymbol: input.underlyingSymbol,
      spreadQuantity: input.spreadQuantity,
      assetType,
    }),
  );

  const tpLeg = planned.legs.find((l) => l.role !== "1st" && l.orderType !== "STOP");
  const takeProfitLimit = tpLeg?.price ?? null;

  let targetExitDollars: number | null = null;
  if (tpEnabled && takeProfitLimit != null) {
    targetExitDollars = roundMoney(Math.abs(takeProfitLimit) * input.spreadQuantity * multiplier);
  }

  const bracketBlocksSend =
    bracketConfirm.mode === "unsupported" || !!planned.validationError;

  let estNetProfit: number | null = null;
  let estNetUnavailable = true;

  if (tpEnabled) {
    if (
      takeProfitLimit == null ||
      input.entryGrossDollars == null ||
      bracketBlocksSend
    ) {
      estNetUnavailable = true;
    } else {
      const exitDollars = Math.abs(takeProfitLimit) * input.spreadQuantity * multiplier;
      const roundTrip =
        assetType === "EQUITY"
          ? 0
          : (() => {
              const oneWay = estimateSchwabOptionFees(input.totalContracts);
              return roundMoney(2 * (oneWay.commission + oneWay.regulatoryEst));
            })();
      const grossEdge = input.isCredit
        ? input.entryGrossDollars - exitDollars
        : exitDollars - input.entryGrossDollars;
      estNetProfit = roundMoney(grossEdge - roundTrip);
      estNetUnavailable = false;
    }
  }

  return {
    targetExitDollars,
    estNetProfit,
    estNetUnavailable,
    bracketConfirm,
    takeProfitLimit,
  };
}