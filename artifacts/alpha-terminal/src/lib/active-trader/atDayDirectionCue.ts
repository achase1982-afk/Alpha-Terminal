import type { QuoteData } from "@/hooks/useQuote";
import { isOvernightQuotePlaceholder } from "@/lib/atQuoteSessionChange";
import { DOWN_TEXT, UP } from "@/components/options/optionsTheme";
import { AT_SECONDARY } from "./atChromeContrast";

/** |changePct| below this vs prior regular close → `DAY FLAT` (documented contract). */
export const DAY_FLAT_PCT_BAND = 0.05;

export type DayDirection = "up" | "down" | "flat" | "unknown";

export type DayDirectionCue = {
  direction: DayDirection;
  label: string;
  pct: number | null;
  tint: string;
};

function fmtDayPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/**
 * Day direction vs **prior regular-session close** (`quote.close`), not overnight futures.
 * Uses regular-session last when available; never fabricates when anchor or live is missing.
 */
export function resolveDayDirectionCue(
  quote: QuoteData | null,
  spot: number | null,
): DayDirectionCue {
  const unknown: DayDirectionCue = { direction: "unknown", label: "DAY —", pct: null, tint: AT_SECONDARY };

  if (!quote) return unknown;

  const priorClose = quote.close;
  if (priorClose == null || !Number.isFinite(priorClose) || priorClose <= 0) return unknown;

  if (isOvernightQuotePlaceholder(quote)) return unknown;

  const live =
    spot != null && Number.isFinite(spot)
      ? spot
      : quote.regularLast != null && Number.isFinite(quote.regularLast)
        ? quote.regularLast
        : null;

  if (live == null) return unknown;

  const pct = ((live - priorClose) / priorClose) * 100;
  if (!Number.isFinite(pct)) return unknown;

  if (Math.abs(pct) < DAY_FLAT_PCT_BAND) {
    return {
      direction: "flat",
      label: `DAY FLAT · ${fmtDayPct(pct)}`,
      pct,
      tint: AT_SECONDARY,
    };
  }

  if (pct > 0) {
    return {
      direction: "up",
      label: `DAY UP · ${fmtDayPct(pct)}`,
      pct,
      tint: UP,
    };
  }

  return {
    direction: "down",
    label: `DAY DOWN · ${fmtDayPct(pct)}`,
    pct,
    tint: DOWN_TEXT,
  };
}
