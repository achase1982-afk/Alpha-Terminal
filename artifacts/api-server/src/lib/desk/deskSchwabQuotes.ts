import { getBestAccessToken } from "../tokenStore.js";
import { fetchSchwabRestQuote } from "../schwabRestQuote.js";
import {
  ensureLiveTapeSubscription,
  resolveLiveQuoteFromStreamer,
} from "../chatLiveQuote.js";
import { deskTouchFeed, deskMarkFeedError } from "./deskFeedFreshness.js";

export type DeskQuoteRow = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  bid_size: number | null;
  ask_size: number | null;
  volume: number | null;
  change: number | null;
  change_pct: number | null;
  ts: string | null;
};

export async function deskFetchSchwabQuotes(symbols: string[]): Promise<{
  quotes: DeskQuoteRow[];
  asOfMs: number;
}> {
  const token = getBestAccessToken();
  const quotes: DeskQuoteRow[] = [];
  let latest = 0;

  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym) continue;
    ensureLiveTapeSubscription(sym);
    const live = await resolveLiveQuoteFromStreamer(sym, token);
    if (live) {
      const tsMs = live.ts || Date.now();
      latest = Math.max(latest, tsMs);
      quotes.push({
        symbol: sym,
        last: live.last,
        bid: live.bid,
        ask: live.ask,
        bid_size: live.bidSize,
        ask_size: live.askSize,
        volume: live.volume,
        change: live.change,
        change_pct: live.changePct,
        ts: new Date(tsMs).toISOString(),
      });
      continue;
    }

    if (token) {
      const rest = await fetchSchwabRestQuote(sym, token);
      if (rest) {
        const tsMs = rest.tradeTimeMs ?? Date.now();
        latest = Math.max(latest, tsMs);
        quotes.push({
          symbol: sym,
          last: rest.last,
          bid: rest.bid,
          ask: rest.ask,
          bid_size: null,
          ask_size: null,
          volume: rest.volume,
          change: rest.change,
          change_pct: rest.changePct,
          ts: new Date(tsMs).toISOString(),
        });
        continue;
      }
    }

    quotes.push({
      symbol: sym,
      last: null,
      bid: null,
      ask: null,
      bid_size: null,
      ask_size: null,
      volume: null,
      change: null,
      change_pct: null,
      ts: null,
    });
  }

  if (!token && quotes.every((q) => q.last == null)) {
    deskMarkFeedError("schwab_quotes", "no_schwab_token");
  } else if (latest > 0) {
    deskTouchFeed("schwab_quotes");
  }

  return { quotes, asOfMs: latest || Date.now() };
}