/** Schwab / stream sentinels and junk placeholders must not enter ticket or zone math. */

export type OptionGreekKind = "delta" | "gamma" | "theta" | "vega" | "iv";

export function sanitizeOptionGreek(
  kind: OptionGreekKind,
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (kind === "iv" && value <= -999) return null;
  if (kind === "delta") {
    if (Math.abs(value) > 1.25) return null;
    return value;
  }
  if (kind === "gamma") {
    if (Math.abs(value) > 2) return null;
    return value;
  }
  if (Math.abs(value) >= 50) return null;
  return value;
}

/** Net ticket greeks are contract ×100; hide obvious sentinel sums. */
export function formatNetGreekDisplay(value: number | null | undefined, decimals = 2): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) >= 5_000) return null;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}