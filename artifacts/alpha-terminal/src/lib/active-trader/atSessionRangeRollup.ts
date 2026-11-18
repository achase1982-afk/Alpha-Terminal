import type { QuoteData } from "@/hooks/useQuote";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
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

function pxCandidates(quote: QuoteData): number[] {
  const out: number[] = [];
  for (const v of [quote.last, quote.regularLast, quote.bid, quote.ask, quote.low, quote.high]) {
    if (v != null && Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
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
  for (const px of pxCandidates(quote)) {
    row.minPx = row.minPx == null ? px : Math.min(row.minPx, px);
    row.maxPx = row.maxPx == null ? px : Math.max(row.maxPx, px);
  }
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