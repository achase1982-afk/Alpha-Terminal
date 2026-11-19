import { addCalendarDaysNy, nyCalendarYmd } from "./usEquityMarketCalendar.js";

/**
 * Schwab `/marketdata/v1/chains` `strikeCount` is the total number of strikes
 * returned around at-the-money (e.g. `strikeCount=40` returns 20 below + 20
 * above ATM). SPX/NDX/RUT cannot be requested with `range=ALL` across all
 * expirations — Schwab returns HTTP 502 "Body buffer overflow".
 */
export const INDEX_CHAIN_MAX_PER_SIDE = 80;
export const INDEX_CHAIN_MAX_STRIKES = INDEX_CHAIN_MAX_PER_SIDE * 2;
/** Multi-expiry browse cap when no single expiration is pinned. */
export const INDEX_CHAIN_MULTI_EXPIRY_MAX_STRIKES = 80;

export type IndexChainRange = "NTM" | "SAK" | "SBK";
/** Near book when the client does not name an expiration (chain browse, not the ladder). */
export const INDEX_CHAIN_DEFAULT_SPAN_DAYS = 21;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type IndexChainWindow = {
  fromDate: string;
  toDate: string;
  /** Passed to Schwab as `strikeCount` (total centered strikes around ATM). */
  strikeCountPerSide: number;
  range: IndexChainRange;
  /** OCC root, when the client asked for one settlement series (SPX vs SPXW). */
  series?: string;
};

const OCC_SUFFIX = /^\d{6}[CP]\d{8}$/;

/** OCC root from a Schwab option symbol. Unknown shapes return null. */
export function occRootFromOptionSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  let raw = symbol.trim();
  if (raw.startsWith(".")) raw = raw.slice(1);
  if (raw.length < 15) return null;
  const suffix = raw.slice(-15);
  if (!OCC_SUFFIX.test(suffix)) return null;
  const root = raw.slice(0, -15).trim().toUpperCase();
  return root || null;
}

/** Series query from the client. Letters and digits only, so it cannot change the date window. */
export function readChainSeries(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const root = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(root)) return undefined;
  return root;
}

export function readQueryDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ymd = value.slice(0, 10);
  return ISO_DATE.test(ymd) ? ymd : undefined;
}

/** Total centered strikes passed to Schwab `/chains` `strikeCount`, hard-capped. */
export function schwabStrikeCountPerSide(
  totalStrikes: number | undefined,
  singleExpiry = true,
): number {
  const n = totalStrikes != null && Number.isFinite(totalStrikes) && totalStrikes > 0
    ? totalStrikes
    : 10;
  const cap = singleExpiry ? INDEX_CHAIN_MAX_STRIKES : INDEX_CHAIN_MULTI_EXPIRY_MAX_STRIKES;
  return Math.min(cap, Math.max(2, Math.round(n)));
}

export function readChainRange(value: unknown): IndexChainRange {
  const r = typeof value === "string" ? value.toUpperCase() : "";
  if (r === "SAK" || r === "SBK" || r === "NTM") return r;
  return "NTM";
}

/** Schwab `/chains` centers `strikeCount` around ATM; single-expiry windows allow up to 80 per side (160 total). */
export function schwabStrikeCountForRange(
  range: IndexChainRange,
  strikeCount: number | undefined,
  singleExpiry = true,
): number {
  if (range === "SAK" || range === "SBK") {
    const n = strikeCount != null && Number.isFinite(strikeCount) && strikeCount > 0 ? strikeCount : 40;
    const cap = singleExpiry ? INDEX_CHAIN_MAX_STRIKES : INDEX_CHAIN_MULTI_EXPIRY_MAX_STRIKES;
    return Math.min(cap, Math.max(2, Math.floor(n)));
  }
  return schwabStrikeCountPerSide(strikeCount, singleExpiry);
}

export function resolveIndexChainWindow(input: {
  fromDate?: unknown;
  toDate?: unknown;
  strikeCount?: number;
  range?: unknown;
  series?: unknown;
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
  let from = fromDate ?? nyCalendarYmd(now);
  let to = toDate ?? addCalendarDaysNy(from, span);
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const range = readChainRange(input.range);
  const singleExpiry = from === to;
  const series = readChainSeries(input.series);
  return {
    fromDate: from,
    toDate: to,
    range,
    strikeCountPerSide: schwabStrikeCountForRange(range, input.strikeCount, singleExpiry),
    ...(series ? { series } : {}),
  };
}

export function expirationInWindow(expiration: string, window: IndexChainWindow): boolean {
  const ymd = expiration.slice(0, 10);
  if (!ISO_DATE.test(ymd)) return false;
  return ymd >= window.fromDate && ymd <= window.toDate;
}

export function indexChainCacheKey(symbol: string, window: IndexChainWindow): string {
  const series = window.series ?? "";
  return `${symbol.toUpperCase()}|${window.fromDate}|${window.toDate}|${window.range}|${window.strikeCountPerSide}|${series}`;
}
