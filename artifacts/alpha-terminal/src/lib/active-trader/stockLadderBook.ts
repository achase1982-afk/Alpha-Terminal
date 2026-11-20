import type { LiveQuote } from "@/lib/store";

export type StockSideQuote = {
  price: number;
  size: number;
  source: "schwab_l1";
  ts: number;
};

export type StockTopBook = {
  bid: StockSideQuote | null;
  ask: StockSideQuote | null;
};

export const EMPTY_STOCK_TOP: StockTopBook = { bid: null, ask: null };

function pairedSide(
  price: number | null | undefined,
  size: number | null | undefined,
  ts: number | null | undefined,
): StockSideQuote | null {
  if (price == null || size == null || ts == null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(ts)) return null;
  if (!(price > 0) || size < 0) return null;
  return { price, size, source: "schwab_l1", ts };
}

/**
 * Accept a side when price and size arrived together.
 * A missing timestamp uses the quote time. A frame with no size keeps the previous pair.
 */
function sameSide(a: StockSideQuote | null, b: StockSideQuote | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.price === b.price && a.size === b.size && a.ts === b.ts && a.source === b.source;
}

function sideTs(quote: LiveQuote, explicit: number | null | undefined): number | null {
  if (explicit != null && Number.isFinite(explicit)) return explicit;
  return Number.isFinite(quote.ts) ? quote.ts : null;
}

export function reduceStockTop(prev: StockTopBook, quote: LiveQuote | null | undefined): StockTopBook {
  if (!quote) return prev;
  const bid = pairedSide(quote.bid, quote.bidSize, sideTs(quote, quote.bidQuoteTs)) ?? prev.bid;
  const ask = pairedSide(quote.ask, quote.askSize, sideTs(quote, quote.askQuoteTs)) ?? prev.ask;
  if (sameSide(bid, prev.bid) && sameSide(ask, prev.ask)) return prev;
  return { bid, ask };
}

export const STOCK_LADDER_TICK = 0.01;
export const STOCK_LADDER_ROWS = 80;

export function stockPriceKey(price: number): string {
  return price.toFixed(2);
}

/** Descending share prices around the inside market. Unlisted prices are simply absent. */
/** Ladder row key for live spot — same tick snap as `stockLadderPrices`. */
export function stockLadderSpotKey(anchor: number | null | undefined): string | null {
  if (anchor == null || !(anchor > 0)) return null;
  const snapped = Math.round(anchor / STOCK_LADDER_TICK) * STOCK_LADDER_TICK;
  return stockPriceKey(snapped);
}

export function stockLadderPrices(anchor: number | null): number[] {
  const centerRaw = anchor != null && anchor > 0 ? anchor : null;
  if (centerRaw == null) return [];
  const center = Math.round(centerRaw / STOCK_LADDER_TICK) * STOCK_LADDER_TICK;
  const half = STOCK_LADDER_ROWS / 2;
  const out: number[] = [];
  for (let i = half; i >= -half; i -= 1) {
    const px = Math.round((center + i * STOCK_LADDER_TICK) * 100) / 100;
    if (px > 0) out.push(px);
  }
  return out;
}

export function stockLadderAnchor(
  book: StockTopBook,
  last: number | null,
  depthBid: number | null = null,
  depthAsk: number | null = null,
): number | null {
  const bid = book.bid?.price ?? (depthBid != null && depthBid > 0 ? depthBid : null);
  const ask = book.ask?.price ?? (depthAsk != null && depthAsk > 0 ? depthAsk : null);
  if (bid != null && ask != null) return (bid + ask) / 2;
  return bid ?? ask ?? (last != null && last > 0 ? last : null);
}

export type StockLevel = { price: number; size: number };

export function stockSizeByPrice(levels: readonly StockLevel[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const level of levels) {
    if (!(level.price > 0) || !(level.size > 0)) continue;
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size)) continue;
    const key = stockPriceKey(level.price);
    out.set(key, (out.get(key) ?? 0) + level.size);
  }
  return out;
}

const VOLUME_BLUE_LOW = [10, 25, 47] as const;
const VOLUME_BLUE_HIGH = [30, 100, 230] as const;

/** Blue volume heat: no volume stays transparent, the heaviest price level gets the strongest blue. */
export function stockVolumeHeatColor(intensity: number): string | undefined {
  if (!(intensity > 0) || !Number.isFinite(intensity)) return undefined;
  const t = Math.min(1, intensity);
  const r = Math.round(VOLUME_BLUE_LOW[0] + (VOLUME_BLUE_HIGH[0] - VOLUME_BLUE_LOW[0]) * t);
  const g = Math.round(VOLUME_BLUE_LOW[1] + (VOLUME_BLUE_HIGH[1] - VOLUME_BLUE_LOW[1]) * t);
  const b = Math.round(VOLUME_BLUE_LOW[2] + (VOLUME_BLUE_HIGH[2] - VOLUME_BLUE_LOW[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

const BID_HEAT_LOW = [17, 45, 31] as const;
const BID_HEAT_HIGH = [0, 209, 102] as const;
const ASK_HEAT_LOW = [55, 26, 31] as const;
const ASK_HEAT_HIGH = [242, 54, 69] as const;

export function stockBookSizeIntensity(size: number | null, visiblePeak: number): number {
  const denominator = Math.max(400, visiblePeak);
  return size != null && size > 0 ? Math.min(1, size / denominator) : 0;
}

/** Actual displayed-book size heat. A 400-share level is fully lit unless the visible book is heavier. */
export function stockBookSizeHeatColor(
  side: "bid" | "ask",
  size: number | null,
  visiblePeak: number,
): string {
  const low = side === "bid" ? BID_HEAT_LOW : ASK_HEAT_LOW;
  const high = side === "bid" ? BID_HEAT_HIGH : ASK_HEAT_HIGH;
  const t = stockBookSizeIntensity(size, visiblePeak);
  const channel = (index: 0 | 1 | 2) => Math.round(low[index] + (high[index] - low[index]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

export function stockBestPrice(levels: readonly StockLevel[], side: "bid" | "ask"): number | null {
  let best: number | null = null;
  for (const level of levels) {
    if (!(level.price > 0) || !(level.size > 0)) continue;
    if (best == null) best = level.price;
    else best = side === "bid" ? Math.max(best, level.price) : Math.min(best, level.price);
  }
  return best;
}
