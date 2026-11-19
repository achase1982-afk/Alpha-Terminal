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
 * Accept a side only from a Schwab quote that already paired price, size, and timestamp.
 * A trade-only frame keeps the previous pair. An unpaired price cannot reuse an old size.
 */
function sameSide(a: StockSideQuote | null, b: StockSideQuote | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.price === b.price && a.size === b.size && a.ts === b.ts && a.source === b.source;
}

export function reduceStockTop(prev: StockTopBook, quote: LiveQuote | null | undefined): StockTopBook {
  if (!quote) return prev;
  if (quote.quoteSource && quote.quoteSource !== "SCHWAB") return prev;
  const bid = pairedSide(quote.bid, quote.bidSize, quote.bidQuoteTs) ?? prev.bid;
  const ask = pairedSide(quote.ask, quote.askSize, quote.askQuoteTs) ?? prev.ask;
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

export function stockLadderAnchor(book: StockTopBook, last: number | null): number | null {
  if (book.bid && book.ask) return (book.bid.price + book.ask.price) / 2;
  return book.bid?.price ?? book.ask?.price ?? (last != null && last > 0 ? last : null);
}
