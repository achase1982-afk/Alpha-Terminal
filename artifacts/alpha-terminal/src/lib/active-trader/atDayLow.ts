/**
 * Active Trader "Day low" from the same Schwab L1 stream as the glance header (useQuote → streamPrices).
 *
 * Server: `schwabStreamer.processEquityTick` maps Schwab LEVELONE_EQUITIES field 11 → `low`,
 * field 10 → `high` (session day range on the equity/index L1 row), broadcast via SSE `quote` events.
 * Client: `useStreamingQuotes` → `setStreamQuote`; `useQuote` reads `streamPrices[sym].low`.
 *
 * Session gate: US regular hours 9:30–16:00 ET (`isUsEquitiesMarketHoursEt`). Overnight Schwab
 * reset (change/high/low all 0) is treated as no level (`isOvernightQuotePlaceholder`).
 */

import type { QuoteData } from "@/hooks/useQuote";
import { isOvernightQuotePlaceholder } from "@/lib/atQuoteSessionChange";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";

export type DayLowKind = "unavailable" | "current" | "prior";

export type DayLowDisplay = {
  kind: DayLowKind;
  value: number | null;
};

function validSessionLow(low: number | null | undefined): low is number {
  return low != null && Number.isFinite(low) && low > 0;
}

function isBeforeRegularSessionOpenEt(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return h * 60 + m < 9 * 60 + 30;
}

export function resolveDayLowFromStreamQuote(
  quote: QuoteData | null,
  now: Date = new Date(),
): DayLowDisplay {
  if (!quote) return { kind: "unavailable", value: null };
  if (isOvernightQuotePlaceholder(quote)) return { kind: "unavailable", value: null };

  const low = quote.low;
  if (!validSessionLow(low)) return { kind: "unavailable", value: null };

  const inRth = isUsEquitiesMarketHoursEt(now);
  if (inRth) return { kind: "current", value: low };
  if (isBeforeRegularSessionOpenEt(now)) return { kind: "prior", value: low };
  return { kind: "current", value: low };
}

export function formatDayLowLevel(n: number): string {
  const frac = Math.abs(n * 2) % 2 === 1;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: frac ? 1 : 0,
    maximumFractionDigits: frac ? 1 : 0,
  });
}

export function dayLowLabelText(display: DayLowDisplay): string {
  if (display.kind === "unavailable" || display.value == null) return "Day low —";
  const n = formatDayLowLevel(display.value);
  if (display.kind === "prior") return `Prev low ${n}`;
  return `Day low ${n}`;
}