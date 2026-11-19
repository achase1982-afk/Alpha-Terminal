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

export function stockBestPrice(levels: readonly StockLevel[], side: "bid" | "ask"): number | null {
  let best: number | null = null;
  for (const level of levels) {
    if (!(level.price > 0) || !(level.size > 0)) continue;
    if (best == null) best = level.price;
    else best = side === "bid" ? Math.max(best, level.price) : Math.min(best, level.price);
  }
  return best;
}
