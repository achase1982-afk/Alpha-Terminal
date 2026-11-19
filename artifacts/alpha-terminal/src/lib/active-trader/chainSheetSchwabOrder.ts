import type { ActiveTraderTemplatePrefs } from "./activeTraderPrefs";
import { optionPremiumStdev } from "./atBracketMath";
import {
  buildAtSchwabOrderJson,
  buildAtSpreadSchwabOrder,
  type AtOrderBuildInput,
  type SchwabInstruction,
} from "./atSchwabOrderBuilder";

export interface ChainSheetOrderLeg {
  direction: SchwabInstruction;
  quantity: number;
  schwabSymbol: string;
  expiration?: string;
  delta?: number | null;
  iv?: number | null;
}

function daysToExpiry(expiration: string | undefined, now = Date.now()): number | null {
  if (!expiration) return null;
  const day = expiration.slice(0, 10);
  const parsed = new Date(`${day}T16:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, (parsed.getTime() - now) / 86_400_000);
}

function wantsAdvancedOrder(prefs: ActiveTraderTemplatePrefs | undefined): boolean {
  if (!prefs) return false;
  if (prefs.takeProfit.enabled || prefs.stopLoss.enabled) return true;
  const route = prefs.advancedRoute ?? "AUTO";
  if (route !== "AUTO" && route !== "SINGLE") return true;
  const entry = prefs.schwabEntryType;
  if (entry && entry !== "LIMIT" && entry !== "MARKET") return true;
  if (prefs.routing && prefs.routing !== "BEST") return true;
  if (prefs.session && prefs.session !== "NORMAL") return true;
  return false;
}

function netOrder(input: {
  isCredit: boolean;
  duration: string;
  session: string;
  complexOrderStrategyType: string;
  legs: ChainSheetOrderLeg[];
  quantityMultiplier: number;
  limitPrice: number;
  routing?: ActiveTraderTemplatePrefs["routing"];
}): Record<string, unknown> {
  const order: Record<string, unknown> = {
    orderType: input.isCredit ? "NET_CREDIT" : "NET_DEBIT",
    session: input.session,
    duration: input.duration,
    complexOrderStrategyType: input.complexOrderStrategyType,
    orderStrategyType: "SINGLE",
    orderLegCollection: input.legs.map((leg) => ({
      instruction: leg.direction,
      quantity: leg.quantity * input.quantityMultiplier,
      instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
    })),
    price: input.limitPrice > 0 ? input.limitPrice : undefined,
  };
  if (input.routing && input.routing !== "BEST") order.requestedDestination = input.routing;
  return order;
}

/** Order body posted to Schwab from the chain / Active Trader ticket. */
export function buildChainSheetSchwabOrder(input: {
  prefs?: ActiveTraderTemplatePrefs;
  primaryInstruction?: SchwabInstruction;
  legs: ChainSheetOrderLeg[];
  quantityMultiplier: number;
  limitPrice: number;
  isCredit: boolean;
  complexOrderStrategyType: string;
  underlyingSymbol: string;
  underlyingPrice?: number | null;
  timeInForce: string;
  now?: number;
}): Record<string, unknown> {
  const prefs = input.prefs;
  const duration =
    prefs?.entryDuration === "GOOD_TILL_CANCEL"
      ? "GOOD_TILL_CANCEL"
      : prefs?.entryDuration === "FILL_OR_KILL"
        ? "FILL_OR_KILL"
        : input.timeInForce === "GTC"
          ? "GOOD_TILL_CANCEL"
          : "DAY";
  const session = prefs?.session ?? "NORMAL";
  if (!prefs || !wantsAdvancedOrder(prefs) || input.legs.length === 0) {
    return netOrder({
      isCredit: input.isCredit,
      duration,
      session,
      complexOrderStrategyType: input.complexOrderStrategyType,
      legs: input.legs,
      quantityMultiplier: input.quantityMultiplier,
      limitPrice: input.limitPrice,
      routing: prefs?.routing,
    });
  }

  const first = input.legs[0]!;
  const primary = input.primaryInstruction ?? first.direction;
  const stdevMode = prefs.takeProfit.mode === "stdev" || prefs.stopLoss.mode === "stdev";
  const premiumStdev = stdevMode
    ? optionPremiumStdev({
        delta: first.delta,
        iv: first.iv,
        dte: daysToExpiry(first.expiration, input.now),
        underlyingPrice: input.underlyingPrice,
      })
    : null;
  const shared: AtOrderBuildInput = {
    template: prefs.template,
    assetType: "OPTION",
    symbol: first.schwabSymbol,
    underlyingSymbol: input.underlyingSymbol.replace(/^\$/, ""),
    primaryInstruction: primary,
    quantity: first.quantity * input.quantityMultiplier,
    limitPrice: input.limitPrice,
    takeProfit: prefs.takeProfit,
    stopLoss: prefs.stopLoss,
    entryOrderType: prefs.orderType,
    entryDuration: duration,
    exitDuration: prefs.exitDuration,
    stopLossOrderType: prefs.stopLossOrderType,
    stopLimitOffset: prefs.stopLimitOffset,
    session,
    advancedRoute: prefs.advancedRoute,
    schwabEntryType: prefs.schwabEntryType,
    routing: prefs.routing,
    trailOffset: prefs.trailOffset,
    trailLinkType: prefs.trailLinkType,
    premiumStdev,
    isSpread: input.legs.length > 1,
  };

  if (input.legs.length === 1) return buildAtSchwabOrderJson(shared);
  return buildAtSpreadSchwabOrder({
    ...shared,
    isCredit: input.isCredit,
    complexOrderStrategyType: input.complexOrderStrategyType,
    spreadLegs: input.legs.map((leg) => ({
      instruction: leg.direction,
      quantity: leg.quantity * input.quantityMultiplier,
      symbol: leg.schwabSymbol,
    })),
  });
}
