import {
  optionPremiumTickForSymbol,
  roundOptionPriceToTick,
  type LimitTickContext,
} from "@workspace/order-ticket-math";
import type { SchwabInstruction } from "./atSchwabOrderBuilder";

export type BracketOffsetMode = "percent" | "points" | "dollars" | "stdev";

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
  underlyingSymbol?: string;
  assetType?: "OPTION" | "EQUITY";
  /** One standard deviation of the option premium, in premium dollars. */
  premiumStdev?: number | null;
}

export function isLongEntry(instruction: SchwabInstruction): boolean {
  return instruction === "BUY_TO_OPEN" || instruction === "BUY";
}

function tickCtx(input: BracketPriceInput): LimitTickContext {
  return {
    underlyingSymbol: input.underlyingSymbol ?? "SPX",
    isOption: input.assetType !== "EQUITY",
  };
}

export function roundAtPremium(price: number, input: BracketPriceInput): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const ctx = tickCtx(input);
  if (!ctx.isOption) return Math.round(price * 100) / 100;
  return roundOptionPriceToTick(price, ctx);
}

/** @deprecated Use roundAtPremium with SPX context. */
export function roundSpxOptionTick(price: number): number {
  return roundAtPremium(price, { underlyingSymbol: "SPX", assetType: "OPTION" } as BracketPriceInput);
}

function modeToPriceDelta(
  mode: BracketOffsetMode,
  signedOffset: number,
  entryPrice: number,
  quantity: number,
  premiumStdev: number | null | undefined,
): number | null {
  switch (mode) {
    case "percent":
      return entryPrice * (signedOffset / 100);
    case "points":
      return signedOffset;
    case "dollars": {
      const contracts = Math.max(1, quantity);
      return signedOffset / (contracts * 100);
    }
    case "stdev": {
      if (premiumStdev == null || !(premiumStdev > 0)) return null;
      return signedOffset * premiumStdev;
    }
    default:
      return 0;
  }
}

/** Option premium move for one standard deviation: |delta| × spot × IV × √(DTE/365). */
export function optionPremiumStdev(input: {
  delta?: number | null;
  iv?: number | null;
  dte?: number | null;
  underlyingPrice?: number | null;
}): number | null {
  const { delta, iv: ivRaw, dte, underlyingPrice } = input;
  if (delta == null || ivRaw == null || dte == null || underlyingPrice == null) return null;
  if (!Number.isFinite(delta) || !Number.isFinite(ivRaw) || !Number.isFinite(dte) || !Number.isFinite(underlyingPrice)) {
    return null;
  }
  if (!(underlyingPrice > 0) || !(dte >= 0)) return null;
  const iv = ivRaw > 3 ? ivRaw / 100 : ivRaw;
  if (!(iv > 0)) return null;
  const move = Math.abs(delta) * underlyingPrice * iv * Math.sqrt(dte / 365);
  return move > 0 ? move : null;
}

export function computeBracketPrices(input: BracketPriceInput): {
  takeProfit: number | null;
  stopLoss: number | null;
} {
  const long = isLongEntry(input.primaryInstruction);
  const entry = input.entryPrice;

  let takeProfit: number | null = null;
  if (input.tp.enabled && entry > 0) {
    const delta = modeToPriceDelta(input.tp.mode, input.tp.offset, entry, input.quantity, input.premiumStdev);
    if (delta != null) {
      const raw = long ? entry + Math.abs(delta) : entry - Math.abs(delta);
      takeProfit = roundAtPremium(raw, input);
      if (takeProfit != null) {
        const sym = input.underlyingSymbol ?? "SPX";
        const tick = optionPremiumTickForSymbol(sym, entry) ?? 0.01;
        if (long && takeProfit <= entry) {
          takeProfit = roundAtPremium(entry + tick, input);
        } else if (!long && takeProfit >= entry) {
          takeProfit = roundAtPremium(Math.max(tick, entry - tick), input);
        }
      }
    }
  }

  let stopLoss: number | null = null;
  if (input.sl.enabled && entry > 0) {
    const delta = modeToPriceDelta(input.sl.mode, input.sl.offset, entry, input.quantity, input.premiumStdev);
    if (delta != null) {
      const magnitude = Math.abs(delta);
      const raw = long ? entry - magnitude : entry + magnitude;
      stopLoss = roundAtPremium(raw, input);
    }
  }

  return { takeProfit, stopLoss };
}

export function formatSignedOffset(offset: number, mode: BracketOffsetMode = "percent"): string {
  const sign = offset > 0 ? `+${offset}` : String(offset);
  if (mode === "percent") return `${sign}%`;
  if (mode === "dollars") return `${sign} $ P/L`;
  if (mode === "stdev") return `${sign} σ`;
  return `${sign} pts`;
}

/** STOP_LIMIT limit relative to rounded stop (closing leg). */
export function stopLimitPriceFromStop(
  stopPrice: number,
  primaryInstruction: SchwabInstruction,
  offset: number,
  input: Pick<BracketPriceInput, "underlyingSymbol" | "assetType">,
): number {
  const long = isLongEntry(primaryInstruction);
  const raw = long ? stopPrice - Math.abs(offset) : stopPrice + Math.abs(offset);
  return roundAtPremium(Math.max(raw, 0.01), {
    entryPrice: raw,
    quantity: 1,
    primaryInstruction,
    tp: { enabled: false, mode: "percent", offset: 0 },
    sl: { enabled: false, mode: "percent", offset: 0 },
    ...input,
  });
}