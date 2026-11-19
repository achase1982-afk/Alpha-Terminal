import { isBlockedFuturesAssetType, isBlockedFuturesTradeSymbol } from "@workspace/order-ticket-math";
import type {
  AtAdvancedRoute,
  AtExitDuration,
  AtOrderType,
  AtRouting,
  AtSchwabEntryType,
  AtStopLossOrderType,
  AtTemplateKind,
  AtTrailLinkType,
  BracketLegPrefs,
} from "./activeTraderPrefs";
import { computeBracketPrices, isLongEntry, roundAtPremium, stopLimitPriceFromStop } from "./atBracketMath";

export type SchwabOptionInstruction =
  | "BUY_TO_OPEN"
  | "SELL_TO_OPEN"
  | "BUY_TO_CLOSE"
  | "SELL_TO_CLOSE";

export type SchwabEquityInstruction = "BUY" | "SELL" | "SELL_SHORT" | "BUY_TO_COVER";

export type SchwabInstruction = SchwabOptionInstruction | SchwabEquityInstruction;

const OPENING = new Set<string>([
  "BUY_TO_OPEN",
  "SELL_TO_OPEN",
  "BUY",
  "SELL_SHORT",
]);

export function humanInstruction(instr: SchwabInstruction): string {
  const map: Record<string, string> = {
    BUY_TO_OPEN: "Buy to open",
    SELL_TO_OPEN: "Sell to open",
    BUY_TO_CLOSE: "Buy to close",
    SELL_TO_CLOSE: "Sell to close",
    BUY: "Buy",
    SELL: "Sell",
    SELL_SHORT: "Sell short",
    BUY_TO_COVER: "Buy to cover",
  };
  return map[instr] ?? instr;
}

export function isOpeningInstruction(instr: string): boolean {
  return OPENING.has(instr);
}

/** Closing leg that pairs with a primary opening instruction (Schwab convention). */
export function closingInstructionForOpen(instr: SchwabInstruction): SchwabInstruction {
  switch (instr) {
    case "BUY_TO_OPEN":
      return "SELL_TO_CLOSE";
    case "SELL_TO_OPEN":
      return "BUY_TO_CLOSE";
    case "BUY":
      return "SELL";
    case "SELL_SHORT":
      return "BUY_TO_COVER";
    default:
      return instr;
  }
}

export interface AtPlannedLeg {
  role: "1st" | "2nd" | "3rd";
  instruction: SchwabInstruction;
  label: string;
  orderType?: string;
  price?: number;
  stopPrice?: number;
}

export interface AtOrderBuildInput {
  template: AtTemplateKind;
  assetType: "OPTION" | "EQUITY";
  symbol: string;
  underlyingSymbol?: string;
  primaryInstruction: SchwabInstruction;
  quantity: number;
  limitPrice: number;
  takeProfit?: BracketLegPrefs;
  stopLoss?: BracketLegPrefs;
  targetPrice?: number;
  stopPrice?: number;
  entryOrderType?: AtOrderType;
  session?: string;
  /** Entry parent TIF (from ticket). */
  duration?: string;
  entryDuration?: string;
  /** OCO children TIF — Schwab sample defaults to GTC. */
  exitDuration?: AtExitDuration;
  stopLossOrderType?: AtStopLossOrderType;
  stopLimitOffset?: number;
  /** Vertical / multi-leg — STOP children are rejected by Schwab. */
  isSpread?: boolean;
  /** One standard deviation of premium, used when a bracket leg mode is `stdev`. */
  premiumStdev?: number | null;
  advancedRoute?: AtAdvancedRoute;
  schwabEntryType?: AtSchwabEntryType;
  routing?: AtRouting;
  trailOffset?: number;
  trailLinkType?: AtTrailLinkType;
}

function primarySchwabOrderType(entryOrderType: AtOrderType | undefined): "LIMIT" | "MARKET" {
  return entryOrderType === "MKT" ? "MARKET" : "LIMIT";
}

function bracketCtx(input: AtOrderBuildInput) {
  return {
    underlyingSymbol: input.underlyingSymbol,
    assetType: input.assetType,
  };
}

function bracketRoundInput(input: AtOrderBuildInput, entryPrice: number) {
  return {
    entryPrice,
    quantity: input.quantity,
    primaryInstruction: input.primaryInstruction,
    tp: input.takeProfit ?? { enabled: false, mode: "percent", offset: 0 },
    sl: input.stopLoss ?? { enabled: false, mode: "percent", offset: 0 },
    premiumStdev: input.premiumStdev,
    ...bracketCtx(input),
  };
}

/** Rounded entry limit — bracket math uses this, not the raw stream mid. */
export function canonicalAtEntryLimit(input: AtOrderBuildInput): number {
  return roundAtPremium(input.limitPrice, bracketRoundInput(input, input.limitPrice));
}

/** Tick-rounded prices for UI previews — matches `buildAtSchwabOrderJson` / `planAtOrderLegs`. */
export function atBracketPreviewPrices(input: AtOrderBuildInput): {
  entryLimit: number;
  takeProfit: number | null;
  stopLoss: number | null;
} {
  const entryLimit = canonicalAtEntryLimit(input);
  const { tp, sl } = resolveBracketPrices(input, entryLimit);
  return { entryLimit, takeProfit: tp, stopLoss: sl };
}

/**
 * One bracket leg's @ preview with the other leg disabled (settings TP / SL rows).
 * Uses the same rounded entry base as the Schwab builder.
 */
export function atBracketLegPreviewPrice(
  input: AtOrderBuildInput,
  leg: "takeProfit" | "stopLoss",
): number | null {
  const entryLimit = canonicalAtEntryLimit(input);
  const disabled: BracketLegPrefs = { enabled: false, mode: "percent", offset: leg === "takeProfit" ? 10 : -10 };
  const patched: AtOrderBuildInput = {
    ...input,
    takeProfit: leg === "takeProfit" ? input.takeProfit : disabled,
    stopLoss: leg === "stopLoss" ? input.stopLoss : disabled,
  };
  const { tp, sl } = resolveBracketPrices(patched, entryLimit);
  return leg === "takeProfit" ? tp : sl;
}

export function resolveBracketPrices(
  input: AtOrderBuildInput,
  entryBase: number,
): { tp: number | null; sl: number | null } {
  const tp = input.takeProfit ?? { enabled: false, mode: "percent", offset: 10 };
  const sl = input.stopLoss ?? { enabled: false, mode: "percent", offset: -10 };
  const fromPrefs = computeBracketPrices({
    entryPrice: entryBase,
    quantity: input.quantity,
    primaryInstruction: input.primaryInstruction,
    tp,
    sl,
    premiumStdev: input.premiumStdev,
    underlyingSymbol: input.underlyingSymbol,
    assetType: input.assetType,
  });
  const roundInput = bracketRoundInput(input, entryBase);
  return {
    tp:
      input.targetPrice != null
        ? roundAtPremium(input.targetPrice, roundInput)
        : fromPrefs.takeProfit,
    sl:
      input.stopPrice != null ? roundAtPremium(input.stopPrice, roundInput) : fromPrefs.stopLoss,
  };
}

export function usesBracketExit(input: AtOrderBuildInput): boolean {
  return !!(input.takeProfit?.enabled || input.stopLoss?.enabled);
}

export function validateAtChildLegs(
  template: AtTemplateKind,
  primary: SchwabInstruction,
  children: SchwabInstruction[],
): string | null {
  if (template === "Single") return null;
  if (!isOpeningInstruction(primary)) return null;
  for (const child of children) {
    if (isOpeningInstruction(child)) {
      return `Child leg cannot use an opening instruction (${humanInstruction(child)}) on the same contract as the entry. Use ${humanInstruction(closingInstructionForOpen(primary))} instead.`;
    }
  }
  return null;
}

function templateRequiresBracket(template: AtTemplateKind): boolean {
  return template === "TRG w/ bracket" || template === "OCO";
}

export function planAtOrderLegs(input: AtOrderBuildInput): {
  legs: AtPlannedLeg[];
  validationError: string | null;
} {
  const close = closingInstructionForOpen(input.primaryInstruction);
  const entryLimit = canonicalAtEntryLimit(input);

  const legs: AtPlannedLeg[] = [
    {
      role: "1st",
      instruction: input.primaryInstruction,
      label: humanInstruction(input.primaryInstruction),
      orderType: "LIMIT",
      price: entryLimit,
    },
  ];

  if (templateRequiresBracket(input.template) && !usesBracketExit(input)) {
    return {
      legs,
      validationError: "Enable take profit or stop loss — bracket template requires at least one exit leg.",
    };
  }

  if (input.isSpread && input.stopLoss?.enabled) {
    return {
      legs,
      validationError:
        "Stop loss is not supported on multi-leg spreads. Schwab rejects STOP on complex orders — use take profit (NET credit/debit) only.",
    };
  }

  if (input.advancedRoute === "SINGLE") {
    return { legs, validationError: null };
  }

  const { tp, sl } = resolveBracketPrices(input, entryLimit);
  if (input.takeProfit?.enabled && tp == null) {
    return {
      legs,
      validationError:
        "Take profit price could not be computed. A standard-deviation target needs the contract's delta, IV, and days to expiration.",
    };
  }
  if (input.stopLoss?.enabled && !input.isSpread && sl == null) {
    return {
      legs,
      validationError: "Stop loss price could not be computed for this target unit.",
    };
  }

  const bracket = usesBracketExit(input);
  const slType = input.stopLossOrderType ?? "STOP";
  const children: SchwabInstruction[] = [];

  if (bracket && tp != null) {
    children.push(close);
    legs.push({
      role: "2nd",
      instruction: close,
      label: humanInstruction(close),
      orderType: "LIMIT",
      price: tp,
    });
  }
  if (bracket && sl != null && !input.isSpread) {
    children.push(close);
    const stopLeg: AtPlannedLeg = {
      role: children.length > 1 ? "3rd" : "2nd",
      instruction: close,
      label: humanInstruction(close),
      orderType: slType === "STOP_LIMIT" ? "STOP_LIMIT" : "STOP",
      stopPrice: sl,
    };
    if (slType === "STOP_LIMIT") {
      const off = input.stopLimitOffset ?? 0.05;
      stopLeg.price = stopLimitPriceFromStop(sl, input.primaryInstruction, off, bracketCtx(input));
    } else {
      stopLeg.price = sl;
    }
    legs.push(stopLeg);
  }

  const validationError =
    children.length > 0 ? validateAtChildLegs(input.template, input.primaryInstruction, children) : null;
  if (input.advancedRoute === "OCO") {
    const closes = legs.filter((leg) => leg.role !== "1st");
    if (closes.length < 2) {
      return {
        legs: closes,
        validationError: "OCO needs a take profit and a stop loss.",
      };
    }
    return { legs: closes, validationError };
  }
  return { legs, validationError };
}

function mkLeg(instr: SchwabInstruction, qty: number, symbol: string, assetType: "OPTION" | "EQUITY") {
  return {
    instruction: instr,
    quantity: qty,
    instrument: { symbol, assetType },
  };
}

function withDestination(payload: Record<string, unknown>, routing: AtRouting | undefined): Record<string, unknown> {
  if (routing && routing !== "BEST") payload.requestedDestination = routing;
  return payload;
}

function singlePayload(
  asset: "OPTION" | "EQUITY",
  session: string,
  duration: string,
  orderType: string,
  priceFields: Record<string, unknown>,
  leg: ReturnType<typeof mkLeg>,
  routing?: AtRouting,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    orderStrategyType: "SINGLE",
    session,
    duration,
    orderType,
    ...priceFields,
    orderLegCollection: [leg],
  };
  if (asset === "OPTION") payload.complexOrderStrategyType = "NONE";
  return withDestination(payload, routing);
}

function resolvedEntryType(input: AtOrderBuildInput): AtSchwabEntryType {
  if (input.schwabEntryType) return input.schwabEntryType;
  return primarySchwabOrderType(input.entryOrderType);
}

function entryOrderFields(
  input: AtOrderBuildInput,
  entryLimit: number,
): { orderType: string; fields: Record<string, unknown> } {
  const session = input.session ?? "NORMAL";
  let orderType: AtSchwabEntryType = resolvedEntryType(input);
  if ((orderType === "MARKET" || orderType === "TRAILING_STOP") && session === "SEAMLESS") {
    orderType = "LIMIT";
  }
  const trail = input.trailOffset ?? 0.1;
  const link = input.trailLinkType ?? "VALUE";
  switch (orderType) {
    case "MARKET":
      return { orderType, fields: {} };
    case "STOP":
      return { orderType, fields: { stopPrice: entryLimit } };
    case "STOP_LIMIT": {
      const off = input.stopLimitOffset ?? 0.05;
      const limitPx = stopLimitPriceFromStop(entryLimit, input.primaryInstruction, off, bracketCtx(input));
      return { orderType, fields: { stopPrice: entryLimit, price: limitPx } };
    }
    case "TRAILING_STOP":
      return {
        orderType,
        fields: {
          stopPriceLinkBasis: "MARK",
          stopPriceLinkType: link,
          stopPriceOffset: trail,
        },
      };
    case "TRAILING_STOP_LIMIT":
      return {
        orderType,
        fields: {
          stopPriceLinkBasis: "MARK",
          stopPriceLinkType: link,
          stopPriceOffset: trail,
          priceLinkBasis: "STOP",
          priceLinkType: "VALUE",
          priceOffset: input.stopLimitOffset ?? 0.05,
        },
      };
    default:
      return { orderType: "LIMIT", fields: { price: entryLimit } };
  }
}

type AtRoute = "SINGLE" | "TRIGGER" | "TRIGGER_OCO" | "OCO";

function resolvedRoute(input: AtOrderBuildInput, exitCount: number): AtRoute {
  const explicit = input.advancedRoute;
  if (explicit && explicit !== "AUTO") return explicit;
  if (exitCount >= 2) return "TRIGGER_OCO";
  if (exitCount === 1) return "TRIGGER";
  return "SINGLE";
}

/** Build Schwab order JSON for Active Trader templates. */
export function buildAtSchwabOrderJson(input: AtOrderBuildInput): Record<string, unknown> {
  const underlying = (input.underlyingSymbol || input.symbol).trim();
  if (
    isBlockedFuturesTradeSymbol(underlying) ||
    isBlockedFuturesTradeSymbol(input.symbol) ||
    isBlockedFuturesAssetType(input.assetType)
  ) {
    return { error: "futures_orders_unsupported" };
  }
  const { validationError } = planAtOrderLegs(input);
  if (validationError) {
    return { error: validationError };
  }

  const session = input.session ?? "NORMAL";
  const entryDuration = input.entryDuration ?? input.duration ?? "DAY";
  const exitDuration = input.exitDuration ?? "GOOD_TILL_CANCEL";
  const qty = input.quantity;
  const sym = input.symbol;
  const asset = input.assetType;
  const close = closingInstructionForOpen(input.primaryInstruction);
  const routing = input.routing;

  const entryLimit = canonicalAtEntryLimit(input);
  const { tp, sl } = resolveBracketPrices(input, entryLimit);
  const entry = entryOrderFields(input, entryLimit);
  const openLeg = mkLeg(input.primaryInstruction, qty, sym, asset);

  const exitChildren: Record<string, unknown>[] = [];
  const attachExits = input.advancedRoute !== "SINGLE";
  if (attachExits && tp != null) {
    exitChildren.push(
      singlePayload(asset, session, exitDuration, "LIMIT", { price: tp }, mkLeg(close, qty, sym, asset), routing),
    );
  }
  if (attachExits && sl != null && !input.isSpread) {
    const slType = input.stopLossOrderType ?? "STOP";
    if (slType === "STOP_LIMIT") {
      const off = input.stopLimitOffset ?? 0.05;
      const limitPx = stopLimitPriceFromStop(sl, input.primaryInstruction, off, bracketCtx(input));
      exitChildren.push(
        singlePayload(
          asset,
          session,
          exitDuration,
          "STOP_LIMIT",
          { stopPrice: sl, price: limitPx },
          mkLeg(close, qty, sym, asset),
          routing,
        ),
      );
    } else {
      exitChildren.push(
        singlePayload(
          asset,
          session,
          exitDuration,
          "STOP",
          { stopPrice: sl },
          mkLeg(close, qty, sym, asset),
          routing,
        ),
      );
    }
  }

  const route = resolvedRoute(input, exitChildren.length);
  if (route === "SINGLE" || exitChildren.length === 0) {
    return singlePayload(asset, session, entryDuration, entry.orderType, entry.fields, openLeg, routing);
  }
  if (route === "TRIGGER" && exitChildren.length > 1) {
    return {
      error: "1st triggers sends one exit. Turn off take profit or stop loss, or choose 1st triggers OCO.",
    };
  }
  if (route === "TRIGGER_OCO" && exitChildren.length < 2) {
    return { error: "1st triggers OCO needs a take profit and a stop loss." };
  }
  if (route === "OCO") {
    if (exitChildren.length < 2) return { error: "OCO needs a take profit and a stop loss." };
    return { orderStrategyType: "OCO", childOrderStrategies: exitChildren };
  }

  const childPayload =
    exitChildren.length === 1
      ? exitChildren[0]
      : { orderStrategyType: "OCO", childOrderStrategies: exitChildren };

  return withDestination(
    {
      orderStrategyType: "TRIGGER",
      session,
      duration: entryDuration,
      orderType: entry.orderType,
      ...entry.fields,
      orderLegCollection: [openLeg],
      childOrderStrategies: [childPayload],
    },
    routing,
  );
}

export interface AtSpreadOrderLeg {
  instruction: SchwabInstruction;
  quantity: number;
  symbol: string;
}

/**
 * Multi-leg Active Trader order.
 * Take profit is a triggered closing package (each leg flipped to its close).
 * Schwab rejects STOP on complex orders, so a stop loss is refused.
 */
export function buildAtSpreadSchwabOrder(
  input: AtOrderBuildInput & {
    spreadLegs: AtSpreadOrderLeg[];
    complexOrderStrategyType: string;
    isCredit: boolean;
  },
): Record<string, unknown> {
  if (input.spreadLegs.length < 2) return buildAtSchwabOrderJson(input);
  const entryKind = input.schwabEntryType;
  if (entryKind && entryKind !== "LIMIT" && entryKind !== "MARKET") {
    return {
      error: "Spreads use a net debit or net credit. Stop and trailing entries are single-contract orders.",
    };
  }
  const guarded = buildAtSchwabOrderJson({ ...input, isSpread: true, symbol: input.spreadLegs[0]?.symbol || input.symbol });
  if ("error" in guarded && guarded.error) return guarded;

  const session = input.session ?? "NORMAL";
  const entryDuration = input.entryDuration ?? input.duration ?? "DAY";
  const exitDuration = input.exitDuration ?? "GOOD_TILL_CANCEL";
  const entryLimit = canonicalAtEntryLimit(input);
  const { tp } = resolveBracketPrices(input, entryLimit);
  const route = input.advancedRoute && input.advancedRoute !== "AUTO" ? input.advancedRoute : "TRIGGER";
  if (route === "OCO") {
    return { error: "OCO without an entry is only available on a single contract." };
  }
  if (route === "SINGLE" || !input.takeProfit?.enabled) {
    return spreadSingle(input, session, entryDuration, entryLimit);
  }
  if (tp == null) {
    return {
      error:
        "Take profit price could not be computed. A standard-deviation target needs the contract's delta, IV, and days to expiration.",
    };
  }
  const parent = spreadSingle(input, session, entryDuration, entryLimit);
  const childType = input.isCredit ? "NET_DEBIT" : "NET_CREDIT";
  const child = spreadSingle(input, session, exitDuration, tp, childType, true);
  return {
    ...parent,
    orderStrategyType: "TRIGGER",
    childOrderStrategies: [child],
  };
}

function spreadSingle(
  input: AtOrderBuildInput & {
    spreadLegs: AtSpreadOrderLeg[];
    complexOrderStrategyType: string;
    isCredit: boolean;
  },
  session: string,
  duration: string,
  price: number,
  orderType?: string,
  closing = false,
): Record<string, unknown> {
  const entry = entryOrderFields(input, price);
  const useMarket = !orderType && entry.orderType === "MARKET";
  const netType = orderType ?? (useMarket ? "MARKET" : input.isCredit ? "NET_CREDIT" : "NET_DEBIT");
  const payload: Record<string, unknown> = {
    orderStrategyType: "SINGLE",
    session,
    duration,
    orderType: netType,
    complexOrderStrategyType: input.complexOrderStrategyType,
    orderLegCollection: input.spreadLegs.map((leg) => ({
      instruction: closing ? closingInstructionForOpen(leg.instruction) : leg.instruction,
      quantity: leg.quantity,
      instrument: { symbol: leg.symbol, assetType: "OPTION" },
    })),
  };
  if (netType !== "MARKET") payload.price = price;
  return withDestination(payload, input.routing);
}