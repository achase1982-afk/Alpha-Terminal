import { addCalendarDaysNy, nyCalendarYmd } from "./usEquityMarketCalendar.js";

/**
 * Schwab `strikeCount` is the number of strikes above AND below the at-the-money
 * price (per side). Our `/market/options` `strikeCount` is the total number of
 * strikes to keep centered on spot. SPX/NDX/RUT cannot be requested with
 * `range=ALL` — Schwab returns HTTP 502 "Body buffer overflow".
 */
export const INDEX_CHAIN_MAX_PER_SIDE = 80;

export type IndexChainRange = "NTM" | "SAK" | "SBK";
/** Near book when the client does not name an expiration (chain browse, not the ladder). */
export const INDEX_CHAIN_DEFAULT_SPAN_DAYS = 21;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type IndexChainWindow = {
  fromDate: string;
  toDate: string;
  /** Passed to Schwab as `strikeCount`. NTM: per side. SAK/SBK: that direction only. */
  strikeCountPerSide: number;
  range: IndexChainRange;
};

export function readQueryDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ymd = value.slice(0, 10);
  return ISO_DATE.test(ymd) ? ymd : undefined;
}

/** Total centered strikes → Schwab's per-side count, hard-capped. */
export function schwabStrikeCountPerSide(totalStrikes: number | undefined): number {
  const n = totalStrikes != null && Number.isFinite(totalStrikes) && totalStrikes > 0
    ? totalStrikes
    : 10;
  return Math.min(INDEX_CHAIN_MAX_PER_SIDE, Math.max(1, Math.ceil(n / 2)));
}

export function readChainRange(value: unknown): IndexChainRange {
  const r = typeof value === "string" ? value.toUpperCase() : "";
  if (r === "SAK" || r === "SBK" || r === "NTM") return r;
  return "NTM";
}

/** SAK/SBK `strikeCount` is already the directional count. NTM is a total centered on spot. */
export function schwabStrikeCountForRange(range: IndexChainRange, strikeCount: number | undefined): number {
  if (range === "SAK" || range === "SBK") {
    const n = strikeCount != null && Number.isFinite(strikeCount) && strikeCount > 0 ? strikeCount : 20;
    return Math.min(INDEX_CHAIN_MAX_PER_SIDE, Math.max(1, Math.floor(n)));
  }
  return schwabStrikeCountPerSide(strikeCount);
}

export function resolveIndexChainWindow(input: {
  fromDate?: unknown;
  toDate?: unknown;
  strikeCount?: number;
  range?: unknown;
  now?: Date;
  defaultSpanDays?: number;
}): IndexChainWindow {
  const now = input.now ?? new Date();
  const span = input.defaultSpanDays ?? INDEX_CHAIN_DEFAULT_SPAN_DAYS;
  let fromDate = readQueryDate(input.fromDate);
  let toDate = readQueryDate(input.toDate);
  if (!fromDate && !toDate) {
    fromDate = nyCalendarYmd(now);
    toDate = addCalendarDaysNy(fromDate, span);
  } else if (!fromDate) {
    fromDate = toDate!;
  } else if (!toDate) {
    toDate = fromDate;
  }
  if (fromDate > toDate) {
    const swap = fromDate;
    fromDate = toDate;
    toDate = swap;
  }
  const range = readChainRange(input.range);
  return {
    fromDate,
    toDate,
    range,
    strikeCountPerSide: schwabStrikeCountForRange(range, input.strikeCount),
  };
}

export function expirationInWindow(expiration: string, window: IndexChainWindow): boolean {
  const ymd = expiration.slice(0, 10);
  if (!ISO_DATE.test(ymd)) return false;
  return ymd >= window.fromDate && ymd <= window.toDate;
}

export function indexChainCacheKey(symbol: string, window: IndexChainWindow): string {
  return `${symbol.toUpperCase()}|${window.fromDate}|${window.toDate}|${window.range}|${window.strikeCountPerSide}`;
}
