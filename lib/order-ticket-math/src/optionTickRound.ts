/** Schwab-style option premium tick (pennies below $3, nickels at/above). */
export function optionPremiumTick(price: number): number {
  if (!Number.isFinite(price)) return 0.01;
  return Math.abs(price) < 3 ? 0.05 : 0.1;
}

export function roundOptionPriceToTick(price: number, mode: "nearest" | "down" | "up" = "nearest"): number {
  if (!Number.isFinite(price)) return 0;
  const tick = optionPremiumTick(price);
  const units = price / tick;
  let rounded: number;
  if (mode === "down") rounded = Math.floor(units + 1e-9) * tick;
  else if (mode === "up") rounded = Math.ceil(units - 1e-9) * tick;
  else rounded = Math.round(units) * tick;
  const decimals = tick >= 0.1 ? 2 : 2;
  return Number(rounded.toFixed(decimals));
}

export function parseTickRoundedLimit(input: string | number | null | undefined, fallback?: number | null): number | null {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return roundOptionPriceToTick(input);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      if (fallback != null && fallback > 0) return roundOptionPriceToTick(fallback);
      return null;
    }
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n) || n <= 0) return null;
    return roundOptionPriceToTick(n);
  }
  if (fallback != null && fallback > 0) return roundOptionPriceToTick(fallback);
  return null;
}