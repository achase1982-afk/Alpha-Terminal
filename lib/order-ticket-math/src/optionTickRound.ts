export type LimitTickContext = {
  /** Underlying equity/index symbol (not OCC option symbol). */
  underlyingSymbol: string;
  isOption: boolean;
};

function normalizeUnderlying(symbol: string): string {
  return symbol.replace(/^\$/, "").trim().toUpperCase();
}

/** Index/ETF names with $0.01 option tick at every premium level. */
const ALL_PENNY_OPTION_UNDERLYINGS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "XSP",
  "DIA",
  "GLD",
  "SLV",
  "HYG",
  "LQD",
  "EEM",
  "XLF",
  "XLE",
  "XLK",
]);

/** Penny pilot single stocks: $0.01 below $3, $0.05 at $3 and above. */
const PENNY_PILOT_STOCKS = new Set([
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

const PENNY_PILOT_UNDERLYINGS = new Set([...ALL_PENNY_OPTION_UNDERLYINGS, ...PENNY_PILOT_STOCKS]);

/** Index options that use nickel/dime ticks (not penny pilot). */
const INDEX_OPTION_UNDERLYINGS = new Set([
  "SPX",
  "SPXW",
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
  const u = normalizeUnderlying(underlyingSymbol);
  const mode = classifyOptionTickMode(underlyingSymbol);
  if (mode === "penny") {
    if (ALL_PENNY_OPTION_UNDERLYINGS.has(u)) return 0.01;
    if (PENNY_PILOT_STOCKS.has(u)) return Math.abs(price) < 3 ? 0.01 : 0.05;
    return 0.01;
  }
  if (mode === "index") return Math.abs(price) < 3 ? 0.05 : 0.1;
  /** Non–penny-pilot / unknown names: $0.01 under $3, $0.05 at/above (Schwab penny program). */
  return Math.abs(price) < 3 ? 0.01 : 0.05;
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
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(4).replace(/\.?0+$/, "");
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
  if (!ctx.isOption) {
    const cents = Math.round(raw * 100) / 100;
    return cents > 0 ? cents : null;
  }
  const tick = optionPremiumTickForSymbol(ctx.underlyingSymbol, raw);
  if (tick == null) return raw;
  const rounded = roundToTick(raw, tick);
  return rounded > 0 ? rounded : tick;
}

/** @deprecated Use parseCanonicalLimit with context. */
function roundOptionPriceToTickLegacy(price: number, mode: "nearest" | "down" | "up" = "nearest"): number {
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
