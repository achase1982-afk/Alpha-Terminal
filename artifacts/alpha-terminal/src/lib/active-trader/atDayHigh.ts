/**
 * Active Trader "Day high" from Schwab L1 stream high (field 10) via useQuote.
 */

import type { QuoteData } from "@/hooks/useQuote";
import { isOvernightQuotePlaceholder } from "@/lib/atQuoteSessionChange";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
import { formatSessionFeedLevel } from "@/lib/active-trader/spxRefZone";

export type DayHighKind = "unavailable" | "current" | "prior";

export type DayHighDisplay = {
  kind: DayHighKind;
  value: number | null;
};

function validSessionHigh(high: number | null | undefined): high is number {
  return high != null && Number.isFinite(high) && high > 0;
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

export function resolveDayHighFromStreamQuote(
  quote: QuoteData | null,
  now: Date = new Date(),
): DayHighDisplay {
  if (!quote) return { kind: "unavailable", value: null };
  if (isOvernightQuotePlaceholder(quote)) return { kind: "unavailable", value: null };

  const high = quote.high;
  if (!validSessionHigh(high)) return { kind: "unavailable", value: null };

  const inRth = isUsEquitiesMarketHoursEt(now);
  if (inRth) return { kind: "current", value: high };
  if (isBeforeRegularSessionOpenEt(now)) return { kind: "prior", value: high };
  return { kind: "current", value: high };
}

export function dayHighLabelText(display: DayHighDisplay): string {
  if (display.kind === "unavailable" || display.value == null) return "Day high \u2014";
  const n = formatSessionFeedLevel(display.value);
  if (display.kind === "prior") return `Prev high ${n}`;
  return `Day high ${n}`;
}