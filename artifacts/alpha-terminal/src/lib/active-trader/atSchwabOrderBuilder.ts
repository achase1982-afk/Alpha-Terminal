import type { AtOrderType, AtTemplateKind, BracketLegPrefs } from "./activeTraderPrefs";
import { computeBracketPrices } from "./atBracketMath";

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
}

export interface AtOrderBuildInput {
  template: AtTemplateKind;
  assetType: "OPTION" | "EQUITY";
  symbol: string;
  primaryInstruction: SchwabInstruction;
  quantity: number;
  limitPrice: number;
  takeProfit?: BracketLegPrefs;
  stopLoss?: BracketLegPrefs;
  targetPrice?: number;
  stopPrice?: number;
  entryOrderType?: AtOrderType;
  session?: string;
  duration?: string;
}

function primarySchwabOrderType(entryOrderType: AtOrderType | undefined): "LIMIT" | "MARKET" {
  return entryOrderType === "MKT" ? "MARKET" : "LIMIT";
}

function resolveBracketPrices(input: AtOrderBuildInput): { tp: number | null; sl: number | null } {
  const tp = input.takeProfit ?? { enabled: false, mode: "percent", offset: 10 };
  const sl = input.stopLoss ?? { enabled: false, mode: "percent", offset: -10 };
  const fromPrefs = computeBracketPrices({
    entryPrice: input.limitPrice,
    quantity: input.quantity,
    primaryInstruction: input.primaryInstruction,
    tp,
    sl,
  });
  return {
    tp: input.targetPrice ?? fromPrefs.takeProfit,
    sl: input.stopPrice ?? fromPrefs.stopLoss,
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

export function planAtOrderLegs(input: AtOrderBuildInput): {
  legs: AtPlannedLeg[];
  validationError: string | null;
} {
  const close = closingInstructionForOpen(input.primaryInstruction);
  const { tp, sl } = resolveBracketPrices(input);
  const bracket = usesBracketExit(input);

  const legs: AtPlannedLeg[] = [
    {
      role: "1st",
      instruction: input.primaryInstruction,
      label: humanInstruction(input.primaryInstruction),
      orderType: "LIMIT",
      price: input.limitPrice,
    },
  ];

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
  if (bracket && sl != null) {
    children.push(close);
    legs.push({
      role: children.length > 1 ? "3rd" : "2nd",
      instruction: close,
      label: humanInstruction(close),
      orderType: "STOP",
      price: sl,
    });
  }

  if (!bracket && input.template === "OCO" && tp == null) {
    const target = input.limitPrice * 1.25;
    children.push(close);
    legs.push({
      role: "2nd",
      instruction: close,
      label: humanInstruction(close),
      orderType: "LIMIT",
      price: target,
    });
  }

  const validationError =
    children.length > 0
      ? validateAtChildLegs("TRG w/ bracket", input.primaryInstruction, children)
      : null;
  return { legs, validationError };
}

function mkLeg(instr: SchwabInstruction, qty: number, symbol: string, assetType: "OPTION" | "EQUITY") {
  return {
    instruction: instr,
    quantity: qty,
    instrument: { symbol, assetType },
  };
}

/** Build Schwab order JSON for Active Trader templates (phase 1 — preview / tests only). */
export function buildAtSchwabOrderJson(input: AtOrderBuildInput): Record<string, unknown> {
  const { validationError } = planAtOrderLegs(input);
  if (validationError) {
    return { error: validationError };
  }

  const session = input.session ?? "NORMAL";
  const duration = input.duration ?? "DAY";
  const qty = input.quantity;
  const sym = input.symbol;
  const asset = input.assetType;
  const close = closingInstructionForOpen(input.primaryInstruction);

  const { tp, sl } = resolveBracketPrices(input);
  const bracket = usesBracketExit(input);
  const entryType = primarySchwabOrderType(input.entryOrderType);
  const entryPriceFields =
    entryType === "LIMIT" ? { price: input.limitPrice } : ({} as Record<string, unknown>);

  if (!bracket && input.template === "Single") {
    return {
      orderStrategyType: "SINGLE",
      session,
      duration,
      orderType: entryType,
      ...entryPriceFields,
      orderLegCollection: [mkLeg(input.primaryInstruction, qty, sym, asset)],
    };
  }

  if (!bracket) {
    return {
      orderStrategyType: "SINGLE",
      session,
      duration,
      orderType: entryType,
      ...entryPriceFields,
      orderLegCollection: [mkLeg(input.primaryInstruction, qty, sym, asset)],
    };
  }

  const exitChildren: Record<string, unknown>[] = [];
  if (tp != null) {
    exitChildren.push({
      orderStrategyType: "SINGLE",
      session,
      duration,
      orderType: "LIMIT",
      price: tp,
      orderLegCollection: [mkLeg(close, qty, sym, asset)],
    });
  }
  if (sl != null) {
    exitChildren.push({
      orderStrategyType: "SINGLE",
      session,
      duration,
      orderType: "STOP",
      stopPrice: sl,
      orderLegCollection: [mkLeg(close, qty, sym, asset)],
    });
  }

  const childPayload =
    exitChildren.length === 1
      ? exitChildren[0]
      : { orderStrategyType: "OCO", childOrderStrategies: exitChildren };

  return {
    orderStrategyType: "TRIGGER",
    session,
    duration,
    orderType: entryType,
    ...entryPriceFields,
    orderLegCollection: [mkLeg(input.primaryInstruction, qty, sym, asset)],
    childOrderStrategies: [childPayload],
  };
}