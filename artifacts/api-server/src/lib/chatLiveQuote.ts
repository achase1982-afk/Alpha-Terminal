/**
 * Live quote resolution for chat — same Schwab streamer + REST path as the terminal UI.
 */
import type { MarketSessionLabel } from "./getMarketContext.js";
import { fetchSchwabRestQuote } from "./schwabRestQuote.js";
import {
  addFuturesSymbols,
  addSymbols,
  getQuoteBySymbol,
  getSchwabStreamEquityQuoteFresh,
  normalizeEquityKey,
  type LiveQuote,
} from "./schwabStreamer.js";

const STREAM_WAIT_MS = 2800;
const STREAM_POLL_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Price to treat as "right now" — extended print outside regular session. */
export function displayLastForSession(q: LiveQuote, session: MarketSessionLabel): number | null {
  if (session === "OPEN") return q.regularLast ?? q.last ?? q.extendedLast;
  return q.last ?? q.extendedLast ?? q.regularLast;
}

export function cacheKeyForSymbol(symbol: string): string {
  const sym = symbol.trim().toUpperCase();
  if (sym.startsWith("/")) return sym;
  return normalizeEquityKey(sym);
}

export function ensureLiveTapeSubscription(symbol: string): string {
  const sym = symbol.trim().toUpperCase();
  const key = cacheKeyForSymbol(sym);
  if (sym.startsWith("/")) {
    addFuturesSymbols([sym]);
  } else {
    addSymbols([sym]);
  }
  return key;
}

export async function awaitStreamerQuote(cacheKey: string, maxWaitMs = STREAM_WAIT_MS): Promise<LiveQuote | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const fresh = getSchwabStreamEquityQuoteFresh(cacheKey, 25_000);
    if (fresh && (fresh.last != null || fresh.bid != null)) return fresh;
    const cached = getQuoteBySymbol(cacheKey);
    if (cached && (cached.last != null || cached.bid != null) && Date.now() - cached.ts < 90_000) {
      return cached;
    }
    await sleep(STREAM_POLL_MS);
  }
  return getQuoteBySymbol(cacheKey) ?? null;
}

export async function resolveLiveQuoteFromStreamer(
  symbol: string,
  marketAccessToken?: string | null,
): Promise<LiveQuote | null> {
  const sym = symbol.trim().toUpperCase();
  const key = cacheKeyForSymbol(sym);
  let q: LiveQuote | null = getQuoteBySymbol(key) ?? null;
  const freshEnough =
    q && (q.last != null || q.bid != null) && Date.now() - q.ts < 45_000;
  if (freshEnough) return q;

  ensureLiveTapeSubscription(sym);
  q = await awaitStreamerQuote(key);
  if (q && (q.last != null || q.bid != null)) return q;

  const token = marketAccessToken?.trim();
  if (!token) return q;

  const rest = await fetchSchwabRestQuote(sym, token);
  if (!rest || rest.last == null) return q;

  const synthetic: LiveQuote = {
    symbol: key,
    last: rest.last,
    regularLast: rest.last,
    extendedLast: rest.last,
    bid: rest.bid,
    ask: rest.ask,
    bidSize: null,
    askSize: null,
    change: rest.change,
    changePct: rest.changePct,
    volume: rest.volume,
    high: rest.high,
    low: rest.low,
    close: rest.prevClose,
    ts: Date.now(),
    quoteSource: "SCHWAB",
  };
  return synthetic;
}
