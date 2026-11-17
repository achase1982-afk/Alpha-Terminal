export type LimitTickContext = {
  /** Underlying equity/index symbol (not OCC option symbol). */
  underlyingSymbol: string;
  isOption: boolean;
};

function normalizeUnderlying(symbol: string): string {
  return symbol.replace(/^\$/, "").trim().toUpperCase();
}

/** ETF/equity names that use $0.01 option increments (penny pilot). */
const PENNY_PILOT_UNDERLYINGS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "GLD",
  "SLV",
  "HYG",
  "LQD",
  "EEM",
  "XLF",
  "XLE",
  "XLK",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "GOOG",
  "META",
  "NVDA",
  "TSLA",
  "AMD",
  "INTC",
  "BAC",
  "F",
  "T",
]);

/** Index options that use nickel/dime ticks (not penny pilot). */
const INDEX_OPTION_UNDERLYINGS = new Set([
  "SPX",
  "SPXW",
  "XSP",
  "RUT",
  "RUTW",
  "NDX",
  "NDXP",
  "VIX",
  "VIXW",
  "DJX",
  "OEX",
  "XEO",
]);

export type OptionTickMode = "none" | "penny" | "index" | "unknown";

export function classifyOptionTickMode(underlyingSymbol: string): OptionTickMode {
  const u = normalizeUnderlying(underlyingSymbol);
  if (PENNY_PILOT_UNDERLYINGS.has(u)) return "penny";
  if (INDEX_OPTION_UNDERLYINGS.has(u)) return "index";
  if (/^(\/ES|\/NQ|\/RTY|\/YM|\$VIX)/.test(u)) return "index";
  return "unknown";
}

export function optionPremiumTickForSymbol(underlyingSymbol: string, price: number): number | null {
  const mode = classifyOptionTickMode(underlyingSymbol);
  if (mode === "penny") return 0.01;
  if (mode === "index") return Math.abs(price) < 3 ? 0.05 : 0.1;
  return null;
}

/** @deprecated Use optionPremiumTickForSymbol — generic index-style tick for unknown contexts. */
export function optionPremiumTick(price: number): number {
  if (!Number.isFinite(price)) return 0.01;
  return Math.abs(price) < 3 ? 0.05 : 0.1;
}

function clampToMinTick(rounded: number, tick: number): number {
  if (rounded <= 0 && tick > 0) return tick;
  return rounded;
}

export function roundToTick(
  price: number,
  tick: number | null,
  mode: "nearest" | "down" | "up" = "nearest",
): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (tick == null || tick <= 0) return price;
  const units = price / tick;
  let rounded: number;
  if (mode === "down") rounded = Math.floor(units + 1e-9) * tick;
  else if (mode === "up") rounded = Math.ceil(units - 1e-9) * tick;
  else rounded = Math.round(units) * tick;
  const decimals = tick >= 0.1 ? 2 : tick >= 0.05 ? 2 : 2;
  return clampToMinTick(Number(rounded.toFixed(decimals)), tick);
}

export function roundOptionPriceToTick(
  price: number,
  ctx?: LimitTickContext,
  mode: "nearest" | "down" | "up" = "nearest",
): number {
  if (!Number.isFinite(price)) return 0;
  if (ctx && !ctx.isOption) return price;
  const sym = ctx?.underlyingSymbol ?? "";
  const tick = ctx?.isOption ? optionPremiumTickForSymbol(sym, price) : null;
  if (tick == null) return price;
  return roundToTick(price, tick, mode);
}

export function formatLimitPriceDisplay(price: number | null | undefined, ctx: LimitTickContext): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return "";
  if (!ctx.isOption) {
    const s = price.toFixed(4).replace(/\.?0+$/, "");
    return s.includes(".") ? s : `${s}.00`;
  }
  const tick = optionPremiumTickForSymbol(ctx.underlyingSymbol, price);
  const decimals = tick === 0.01 ? 2 : 2;
  return price.toFixed(decimals);
}

export function parseCanonicalLimit(
  input: string | number | null | undefined,
  ctx: LimitTickContext,
  fallback?: number | null,
): number | null {
  let raw: number | null = null;
  if (typeof input === "number" && Number.isFinite(input) && input > 0) raw = input;
  else if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed) {
      const n = parseFloat(trimmed);
      if (Number.isFinite(n) && n > 0) raw = n;
    }
  }
  if (raw == null && fallback != null && Number.isFinite(fallback) && fallback > 0) raw = fallback;
  if (raw == null) return null;
  if (!ctx.isOption) return raw;
  const tick = optionPremiumTickForSymbol(ctx.underlyingSymbol, raw);
  if (tick == null) return raw;
  const rounded = roundToTick(raw, tick);
  return rounded > 0 ? rounded : tick;
}

/** @deprecated Use parseCanonicalLimit with context. */
export function roundOptionPriceToTickLegacy(price: number, mode: "nearest" | "down" | "up" = "nearest"): number {
  return roundOptionPriceToTick(price, { underlyingSymbol: "SPX", isOption: true }, mode);
}

export function parseTickRoundedLimit(
  input: string | number | null | undefined,
  fallback?: number | null,
  ctx?: LimitTickContext,
): number | null {
  if (ctx) return parseCanonicalLimit(input, ctx, fallback ?? null);
  const legacyCtx: LimitTickContext = { underlyingSymbol: "SPX", isOption: true };
  return parseCanonicalLimit(input, legacyCtx, fallback ?? null);
}