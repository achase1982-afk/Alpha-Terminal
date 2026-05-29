/**
 * Map Schwab streamer / REST shapes into RawQuote for normalizeQuote().
 */
import type { MarketSessionLabel } from "./getMarketContext.js";
import { displayLastForSession } from "./chatLiveQuote.js";
import type { RawQuote } from "./quote-normalizer.js";
import type { LiveQuote } from "./schwabStreamer.js";
import type { SchwabRestQuote } from "./schwabRestQuote.js";

function pickFinite(obj: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export function rawQuoteFromLiveQuote(
  sym: string,
  q: LiveQuote,
  session: MarketSessionLabel,
): RawQuote | null {
  const priorClose = q.close;
  if (priorClose == null || !Number.isFinite(priorClose)) return null;

  const lastPrice = displayLastForSession(q, session);
  if (lastPrice == null || !Number.isFinite(lastPrice)) return null;

  const todayRegularClose =
    session === "OPEN" || session === "PREMARKET" ? null : q.regularLast ?? null;

  return {
    symbol: sym.trim().toUpperCase(),
    priorClose,
    todayRegularClose,
    lastPrice,
    lastTradeTime: new Date(q.ts || Date.now()).toISOString(),
  };
}

export function rawQuoteFromSchwabRest(
  rest: SchwabRestQuote,
  session: MarketSessionLabel,
): RawQuote | null {
  const priorClose = rest.prevClose;
  if (priorClose == null || !Number.isFinite(priorClose)) return null;

  const lastTrade = rest.last;
  if (lastTrade == null || !Number.isFinite(lastTrade)) return null;

  const regularMarketLast = rest.regularMarketLast;
  const todayRegularClose =
    session === "OPEN" || session === "PREMARKET" ? null : regularMarketLast ?? null;

  const lastPrice =
    session === "OPEN" ? (regularMarketLast ?? lastTrade) : lastTrade;

  const lastTradeTime =
    rest.tradeTimeMs != null && rest.tradeTimeMs > 1e12
      ? new Date(rest.tradeTimeMs).toISOString()
      : new Date().toISOString();

  return {
    symbol: rest.symbol,
    priorClose,
    todayRegularClose,
    lastPrice,
    lastTradeTime,
  };
}

export function rawQuoteFromSchwabQuoteRow(
  sym: string,
  quote: Record<string, unknown>,
  session: MarketSessionLabel,
): RawQuote | null {
  const priorClose = pickFinite(quote, [
    "closePrice",
    "close",
    "previousClose",
    "regularMarketPreviousClose",
  ]);
  if (priorClose == null) return null;

  const regularMarketLast = pickFinite(quote, ["regularMarketLastPrice"]);
  const lastTrade = pickFinite(quote, ["lastPrice", "last", "mark", "markPrice"]);
  if (lastTrade == null) return null;

  const todayRegularClose =
    session === "OPEN" || session === "PREMARKET" ? null : regularMarketLast ?? null;

  const lastPrice =
    session === "OPEN" ? (regularMarketLast ?? lastTrade) : lastTrade;

  const tradeRaw = quote["tradeTime"];
  const lastTradeTime =
    typeof tradeRaw === "number" && tradeRaw > 1e12
      ? new Date(tradeRaw).toISOString()
      : new Date().toISOString();

  return {
    symbol: sym.trim().toUpperCase(),
    priorClose,
    todayRegularClose,
    lastPrice,
    lastTradeTime,
  };
}
