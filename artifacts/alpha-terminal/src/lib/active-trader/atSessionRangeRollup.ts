import type { QuoteData } from "@/hooks/useQuote";
import type { DayHighDisplay } from "./atDayHigh";
import { resolveDayHighFromStreamQuote } from "./atDayHigh";
import type { DayLowDisplay } from "./atDayLow";
import { resolveDayLowFromStreamQuote } from "./atDayLow";

/**
 * Day high, day low, and their zones use the feed's session extrema.
 * Local prints from this tab are not the day's range.
 */
export function resolveSessionLowHighFromQuote(
  _symbol: string,
  quote: QuoteData | null,
  now = new Date(),
): { dayLow: DayLowDisplay; dayHigh: DayHighDisplay } {
  return {
    dayLow: resolveDayLowFromStreamQuote(quote, now),
    dayHigh: resolveDayHighFromStreamQuote(quote, now),
  };
}
