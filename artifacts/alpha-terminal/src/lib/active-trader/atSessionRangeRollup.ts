import type { QuoteData } from "@/hooks/useQuote";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
import { isRthTradeOnSameEtDay } from "./atSessionTradeTime";
import type { DayHighDisplay } from "./atDayHigh";
import { resolveDayHighFromStreamQuote } from "./atDayHigh";
import type { DayLowDisplay } from "./atDayLow";
import { resolveDayLowFromStreamQuote } from "./atDayLow";

type Rollup = {
  sessionKey: string;
  minPx: number | null;
  maxPx: number | null;
};

const rollups = new Map<string, Rollup>();

function etSessionKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

type TimedQuote = QuoteData & { tradeTimeMs?: number | null };

function tradedPrint(quote: TimedQuote, now: Date): number | null {
  if (!isRthTradeOnSameEtDay(quote.tradeTimeMs, now)) return null;
  const px = quote.last ?? quote.regularLast;
  if (px == null || !Number.isFinite(px) || px <= 0) return null;
  return px;
}

export function touchSessionRange(symbol: string, quote: QuoteData | null, now = new Date()): void {
  if (!quote) return;
  const sym = symbol.replace(/^\$/, "").toUpperCase();
  const key = etSessionKey(now);
  let row = rollups.get(sym);
  if (!row || row.sessionKey !== key) {
    row = { sessionKey: key, minPx: null, maxPx: null };
    rollups.set(sym, row);
  }
  if (!isUsEquitiesMarketHoursEt(now)) return;
  const px = tradedPrint(quote, now);
  if (px == null) return;
  row.minPx = row.minPx == null ? px : Math.min(row.minPx, px);
  row.maxPx = row.maxPx == null ? px : Math.max(row.maxPx, px);
}

function combineLow(feed: DayLowDisplay, rollupMin: number | null): DayLowDisplay {
  if (rollupMin == null) return feed;
  if (feed.value == null) return { kind: feed.kind === "prior" ? "prior" : "current", value: rollupMin };
  if (rollupMin < feed.value) return { ...feed, value: rollupMin };
  return feed;
}

function combineHigh(feed: DayHighDisplay, rollupMax: number | null): DayHighDisplay {
  if (rollupMax == null) return feed;
  if (feed.value == null) return { kind: feed.kind === "prior" ? "prior" : "current", value: rollupMax };
  if (rollupMax > feed.value) return { ...feed, value: rollupMax };
  return feed;
}

export function resolveSessionLowHighFromQuote(
  symbol: string,
  quote: QuoteData | null,
  now = new Date(),
): { dayLow: DayLowDisplay; dayHigh: DayHighDisplay } {
  if (quote) touchSessionRange(symbol, quote, now);
  const sym = symbol.replace(/^\$/, "").toUpperCase();
  const rollup = rollups.get(sym);
  const rollupMin = rollup?.sessionKey === etSessionKey(now) ? rollup.minPx : null;
  const rollupMax = rollup?.sessionKey === etSessionKey(now) ? rollup.maxPx : null;
  const dayLow = combineLow(resolveDayLowFromStreamQuote(quote, now), rollupMin);
  const dayHigh = combineHigh(resolveDayHighFromStreamQuote(quote, now), rollupMax);
  return { dayLow, dayHigh };
}

export function resetSessionRangeRollupsForTests(): void {
  rollups.clear();
}