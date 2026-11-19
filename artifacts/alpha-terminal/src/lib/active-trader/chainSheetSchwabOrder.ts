import type { StrategyLeg } from "@/components/StrategyBuilder";
import {
  inferSchwabComplexOrderStrategyType,
  schwabPriceFromTicket,
  type LimitTickContext,
} from "@workspace/order-ticket-math";
import type { ActiveTraderTemplatePrefs } from "./activeTraderPrefs";
import { buildAtSchwabOrderJson, type SchwabInstruction } from "./atSchwabOrderBuilder";
import { buildChainSheetBracketEconomics } from "./chainSheetBracketEconomics";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

function primaryLegOptionSymbol(leg: StrategyLeg, underlying: string): string | undefined {
  const trimmed = leg.schwabSymbol?.trim();
  if (trimmed) return trimmed;
  const built = buildSchwabOptionKey(
    underlying,
    leg.expiration,
    leg.strike,
    leg.optionType === "CALL" ? "C" : "P",
  );
  const key = built.trim();
  return key || undefined;
}

export type ChainSheetOrderBuildInput = {
  symbol: string;
  legs: StrategyLeg[];
  spreadQuantity: number;
  limitPrice: string;
  limitTickCtx: LimitTickContext;
  timeInForce: "DAY" | "GTC";
  isCredit: boolean;
  entryGrossDollars: number | null;
  atBracketDraft?: {
    prefs: ActiveTraderTemplatePrefs;
    primaryInstruction: SchwabInstruction;
  } | null;
  distinctLegCount: number;
};

function bracketPrefsActive(prefs: ActiveTraderTemplatePrefs): boolean {
  return (
    prefs.template !== "Single" || !!(prefs.takeProfit?.enabled || prefs.stopLoss?.enabled)
  );
}

function closingInstruction(open: string): string {
  if (open === "SELL_TO_OPEN") return "BUY_TO_CLOSE";
  if (open === "BUY_TO_OPEN") return "SELL_TO_CLOSE";
  return open;
}

function inferComplexType(legs: StrategyLeg[]): string {
  return inferSchwabComplexOrderStrategyType(
    legs.map((leg) => ({
      strike: leg.strike,
      optionType: leg.optionType,
      instruction: leg.direction,
      quantity: leg.quantity,
      expiration: leg.expiration,
      schwabSymbol: leg.schwabSymbol,
    })),
  );
}

function buildSpreadNetEntry(input: ChainSheetOrderBuildInput, price: number): Record<string, unknown> {
  const complexType = inferComplexType(input.legs);
  return {
    orderType: input.isCredit ? "NET_CREDIT" : "NET_DEBIT",
    session: "NORMAL",
    duration: input.timeInForce,
    complexOrderStrategyType: complexType,
    orderStrategyType: "SINGLE",
    orderLegCollection: input.legs.map((leg) => ({
      instruction: leg.direction,
      quantity: leg.quantity * input.spreadQuantity,
      instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
    })),
    price,
  };
}

export function buildChainSheetSchwabOrder(
  input: ChainSheetOrderBuildInput,
  priceOverride?: number,
): Record<string, unknown> {
  const parsed = priceOverride ?? schwabPriceFromTicket(input.limitTickCtx, input.limitPrice);
  if (parsed == null || parsed <= 0) {
    return { error: "invalid_limit" };
  }

  const draft = input.atBracketDraft;
  if (!draft || !bracketPrefsActive(draft.prefs)) {
    return buildSpreadNetEntry(input, parsed);
  }

  const leg = input.legs[0];
  const optionSymbol = leg ? primaryLegOptionSymbol(leg, input.symbol) : undefined;
  if (!optionSymbol) {
    return { error: "missing_option_symbol" };
  }

  const totalContracts =
    input.legs.reduce((s, l) => s + l.quantity, 0) * input.spreadQuantity;

  const econ = buildChainSheetBracketEconomics({
    prefs: draft.prefs,
    primaryInstruction: draft.primaryInstruction,
    lockedLimit: parsed,
    legCount: input.distinctLegCount,
    optionSymbol,
    underlyingSymbol: input.symbol.replace(/^\$/, ""),
    spreadQuantity: input.spreadQuantity,
    totalContracts,
    entryGrossDollars: input.entryGrossDollars,
    isCredit: input.isCredit,
  });

  if (econ.bracketConfirm.mode === "unsupported") {
    return { error: econ.bracketConfirm.message };
  }

  const exitDuration = draft.prefs.exitDuration ?? "GOOD_TILL_CANCEL";

  if (input.distinctLegCount === 1) {
    return buildAtSchwabOrderJson({
      template: draft.prefs.template,
      assetType: "OPTION",
      symbol: optionSymbol,
      underlyingSymbol: input.symbol.replace(/^\$/, ""),
      primaryInstruction: draft.primaryInstruction,
      quantity: input.spreadQuantity,
      limitPrice: parsed,
      takeProfit: draft.prefs.takeProfit,
      stopLoss: draft.prefs.stopLoss,
      entryOrderType: draft.prefs.orderType,
      entryDuration: input.timeInForce,
      exitDuration,
      stopLossOrderType: draft.prefs.stopLossOrderType,
      stopLimitOffset: draft.prefs.stopLimitOffset,
    });
  }

  if (!draft.prefs.takeProfit?.enabled || econ.takeProfitLimit == null) {
    return buildSpreadNetEntry(input, parsed);
  }

  const exitPrice = econ.takeProfitLimit;

  const entry = buildSpreadNetEntry(input, parsed);
  const closeIsDebit = input.isCredit;
  const child: Record<string, unknown> = {
    orderStrategyType: "SINGLE",
    session: "NORMAL",
    duration: exitDuration,
    complexOrderStrategyType: entry.complexOrderStrategyType,
    orderType: closeIsDebit ? "NET_DEBIT" : "NET_CREDIT",
    price: exitPrice,
    orderLegCollection: input.legs.map((leg) => ({
      instruction: closingInstruction(leg.direction),
      quantity: leg.quantity * input.spreadQuantity,
      instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
    })),
  };

  return {
    ...entry,
    orderStrategyType: "TRIGGER",
    childOrderStrategies: [child],
  };
}