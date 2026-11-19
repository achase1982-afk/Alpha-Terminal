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

export type VisibleTicketOrderType = "LIMIT" | "MARKET";

export type ResolvedChainOrderType =
  | { ok: true; orderType: "LIMIT" | "MARKET" | "NET_CREDIT" | "NET_DEBIT"; label: string }
  | { ok: false; reason: string };

/** One order type for the dock, Review, and the Schwab payload. */
export function resolveVisibleChainOrderType(input: {
  visible: VisibleTicketOrderType;
  isCredit: boolean;
  legCount: number;
  session?: string | null;
}): ResolvedChainOrderType {
  if (input.visible === "MARKET" && input.session === "SEAMLESS") {
    return {
      ok: false,
      reason: "Market orders aren't available for a seamless session. Choose Limit.",
    };
  }
  if (input.visible === "MARKET" && input.legCount > 1) {
    return {
      ok: false,
      reason: "Market orders aren't available for this strategy. Choose Limit.",
    };
  }
  if (input.visible === "MARKET") return { ok: true, orderType: "MARKET", label: "Market" };
  if (input.legCount > 1) {
    return input.isCredit
      ? { ok: true, orderType: "NET_CREDIT", label: "Net credit" }
      : { ok: true, orderType: "NET_DEBIT", label: "Net debit" };
  }
  return { ok: true, orderType: "LIMIT", label: "Limit" };
}

function netOrder(input: {
  orderType: string;
  duration: string;
  session: string;
  complexOrderStrategyType: string;
  legs: ChainSheetOrderLeg[];
  quantityMultiplier: number;
  limitPrice: number;
  routing?: ActiveTraderTemplatePrefs["routing"];
}): Record<string, unknown> {
  const order: Record<string, unknown> = {
    orderType: input.orderType,
    session: input.session,
    duration: input.duration,
    complexOrderStrategyType: input.complexOrderStrategyType,
    orderStrategyType: "SINGLE",
    orderLegCollection: input.legs.map((leg) => ({
      instruction: leg.direction,
      quantity: leg.quantity * input.quantityMultiplier,
      instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
    })),
    price: input.orderType === "MARKET" || input.limitPrice <= 0 ? undefined : input.limitPrice,
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
  /** Limit/Market selection on the ticket. Defaults to Limit. */
  visibleOrderType?: VisibleTicketOrderType;
  complexOrderStrategyType: string;
  underlyingSymbol: string;
  underlyingPrice?: number | null;
  timeInForce: string;
  now?: number;
}): Record<string, unknown> {
  const prefs = input.prefs;
  const visible = input.visibleOrderType ?? "LIMIT";
  const resolved = resolveVisibleChainOrderType({
    visible,
    isCredit: input.isCredit,
    legCount: input.legs.length,
    session: prefs?.session ?? "NORMAL",
  });
  if (!resolved.ok) return { error: resolved.reason };
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
      orderType: resolved.orderType,
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
    entryOrderType: visible === "MARKET" ? "MKT" : "LIMIT",
    entryDuration: duration,
    exitDuration: prefs.exitDuration,
    stopLossOrderType: prefs.stopLossOrderType,
    stopLimitOffset: prefs.stopLimitOffset,
    session,
    advancedRoute: prefs.advancedRoute,
    schwabEntryType: visible === "MARKET" ? "MARKET" : "LIMIT",
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
