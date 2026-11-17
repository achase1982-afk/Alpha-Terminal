import type { SchwabInstruction } from "./atSchwabOrderBuilder";

export type BracketOffsetMode = "percent" | "points" | "dollars";

export interface BracketLegConfig {
  enabled: boolean;
  mode: BracketOffsetMode;
  /** Signed offset: TP positive (e.g. +10 for 10%), SL negative (e.g. -10). */
  offset: number;
}

export interface BracketPriceInput {
  entryPrice: number;
  quantity: number;
  primaryInstruction: SchwabInstruction;
  tp: BracketLegConfig;
  sl: BracketLegConfig;
}

export function isLongEntry(instruction: SchwabInstruction): boolean {
  return instruction === "BUY_TO_OPEN" || instruction === "BUY";
}

/** SPX-style option tick: $0.05 below $3, $0.10 at/above $3. */
export function roundSpxOptionTick(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const inc = price < 3 ? 0.05 : 0.1;
  const rounded = Math.round(price / inc) * inc;
  return Math.round(rounded * 100) / 100;
}

function modeToPriceDelta(
  mode: BracketOffsetMode,
  signedOffset: number,
  entryPrice: number,
  quantity: number,
): number {
  switch (mode) {
    case "percent":
      return entryPrice * (signedOffset / 100);
    case "points":
      return signedOffset;
    case "dollars": {
      const contracts = Math.max(1, quantity);
      return signedOffset / (contracts * 100);
    }
    default:
      return 0;
  }
}

export function computeBracketPrices(input: BracketPriceInput): {
  takeProfit: number | null;
  stopLoss: number | null;
} {
  const long = isLongEntry(input.primaryInstruction);
  const entry = input.entryPrice;

  let takeProfit: number | null = null;
  if (input.tp.enabled && entry > 0) {
    const delta = modeToPriceDelta(input.tp.mode, input.tp.offset, entry, input.quantity);
    const raw = long ? entry + Math.abs(delta) : entry - Math.abs(delta);
    takeProfit = roundSpxOptionTick(raw);
  }

  let stopLoss: number | null = null;
  if (input.sl.enabled && entry > 0) {
    const delta = modeToPriceDelta(input.sl.mode, input.sl.offset, entry, input.quantity);
    const magnitude = Math.abs(delta);
    const raw = long ? entry - magnitude : entry + magnitude;
    stopLoss = roundSpxOptionTick(raw);
  }

  return { takeProfit, stopLoss };
}

export function formatSignedOffset(offset: number, mode: BracketOffsetMode = "percent"): string {
  const sign = offset > 0 ? `+${offset}` : String(offset);
  if (mode === "percent") return `${sign}%`;
  if (mode === "dollars") return `${sign} $ P/L`;
  return `${sign} pts`;
}