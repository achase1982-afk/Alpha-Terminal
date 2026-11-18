import { isOvernightQuotePlaceholder } from "@/lib/atQuoteSessionChange";

function fmtPrice(n: number, digits = 2): string {
  return n.toFixed(digits);
}

/** Day range for header — never $0–$0; missing session values → em dash. */
export function formatDayRangeLabel(
  high: number | null | undefined,
  low: number | null | undefined,
  change: number | null | undefined = null,
): string {
  const placeholder = isOvernightQuotePlaceholder({ high: high ?? null, low: low ?? null, change });
  if (placeholder) return "\u2014";
  if (
    high == null ||
    low == null ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    high <= 0 ||
    low <= 0 ||
    high < low ||
    high === low
  ) {
    return "\u2014";
  }
  return `$${fmtPrice(low)}\u2014$${fmtPrice(high)}`;
}