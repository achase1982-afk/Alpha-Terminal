import type {
  AtExitDuration,
  AtOrderType,
  AtStopLossOrderType,
  AtTemplateKind,
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
    ...bracketCtx(input),
  };
}

/** Rounded entry limit — bracket math uses this, not the raw stream mid. */
export function canonicalAtEntryLimit(input: AtOrderBuildInput): number {
  return roundAtPremium(input.limitPrice, bracketRoundInput(input, input.limitPrice));
}

function resolveBracketPrices(
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

  const { tp, sl } = resolveBracketPrices(input, entryLimit);
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
  return { legs, validationError };
}

function mkLeg(instr: SchwabInstruction, qty: number, symbol: string, assetType: "OPTION" | "EQUITY") {
  return {
    instruction: instr,
    quantity: qty,
    instrument: { symbol, assetType },
  };
}

function singleOptionPayload(
  session: string,
  duration: string,
  orderType: "LIMIT" | "MARKET",
  priceFields: Record<string, unknown>,
  leg: ReturnType<typeof mkLeg>,
): Record<string, unknown> {
  return {
    orderStrategyType: "SINGLE",
    complexOrderStrategyType: "NONE",
    session,
    duration,
    orderType,
    ...priceFields,
    orderLegCollection: [leg],
  };
}

/** Build Schwab order JSON for Active Trader templates. */
export function buildAtSchwabOrderJson(input: AtOrderBuildInput): Record<string, unknown> {
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

  const entryLimit = canonicalAtEntryLimit(input);

  const { tp, sl } = resolveBracketPrices(input, entryLimit);
  const bracket = usesBracketExit(input);
  const entryType = primarySchwabOrderType(input.entryOrderType);
  const entryPriceFields =
    entryType === "LIMIT" ? { price: entryLimit } : ({} as Record<string, unknown>);

  if (!bracket) {
    const leg = mkLeg(input.primaryInstruction, qty, sym, asset);
    if (asset === "OPTION") {
      return singleOptionPayload(session, entryDuration, entryType, entryPriceFields, leg);
    }
    return {
      orderStrategyType: "SINGLE",
      session,
      duration: entryDuration,
      orderType: entryType,
      ...entryPriceFields,
      orderLegCollection: [leg],
    };
  }

  const exitChildren: Record<string, unknown>[] = [];
  if (tp != null) {
    exitChildren.push(
      singleOptionPayload(session, exitDuration, "LIMIT", { price: tp }, mkLeg(close, qty, sym, asset)),
    );
  }
  if (sl != null && !input.isSpread) {
    const slType = input.stopLossOrderType ?? "STOP";
    if (slType === "STOP_LIMIT") {
      const off = input.stopLimitOffset ?? 0.05;
      const limitPx = stopLimitPriceFromStop(sl, input.primaryInstruction, off, bracketCtx(input));
      exitChildren.push({
        orderStrategyType: "SINGLE",
        complexOrderStrategyType: "NONE",
        session,
        duration: exitDuration,
        orderType: "STOP_LIMIT",
        stopPrice: sl,
        price: limitPx,
        orderLegCollection: [mkLeg(close, qty, sym, asset)],
      });
    } else {
      exitChildren.push({
        orderStrategyType: "SINGLE",
        complexOrderStrategyType: "NONE",
        session,
        duration: exitDuration,
        orderType: "STOP",
        stopPrice: sl,
        orderLegCollection: [mkLeg(close, qty, sym, asset)],
      });
    }
  }

  const childPayload =
    exitChildren.length === 1
      ? exitChildren[0]
      : { orderStrategyType: "OCO", childOrderStrategies: exitChildren };

  return {
    orderStrategyType: "TRIGGER",
    session,
    duration: entryDuration,
    orderType: entryType,
    ...entryPriceFields,
    orderLegCollection: [mkLeg(input.primaryInstruction, qty, sym, asset)],
    childOrderStrategies: [childPayload],
  };
}