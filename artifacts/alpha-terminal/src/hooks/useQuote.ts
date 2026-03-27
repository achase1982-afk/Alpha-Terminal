/**
 * useQuote — unified quote data hook.
 *
 * Priority (per symbol, independently):
 *  1. Stream price from Zustand when THAT SYMBOL has fresh data (< 60s old)
 *  2. REST GET /api/market/quote fallback — always runs until stream data arrives
 *
 * Critical design: REST is gated on per-symbol stream freshness, NOT on the
 * global streamConnected flag.  streamConnected only going true when actual
 * Schwab ticks land — but REST must stay alive until the first real tick
 * for each symbol arrives so there are never unexplained dashes.
 */

import { useTerminalStore, type LiveQuote } from "@/lib/store";
import { useGetQuote }                      from "@workspace/api-client-react";

export interface QuoteData {
  symbol:           string;
  description:      string | null;   // company name, e.g. "Apple Inc"
  last:             number | null;
  bid:              number | null;
  ask:              number | null;
  change:           number | null;
  changePct:        number | null;
  volume:           number | null;
  high:             number | null;
  low:              number | null;
  close:            number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow:  number | null;
  peRatio:          number | null;
  error?:           string;
}

function fromLive(q: LiveQuote): QuoteData {
  return {
    symbol:           q.symbol,
    description:      null,   // streamer doesn't carry reference data
    last:             q.last,
    bid:              q.bid,
    ask:              q.ask,
    change:           q.change,
    changePct:        q.changePct,
    volume:           q.volume,
    high:             q.high,
    low:              q.low,
    close:            q.close,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow:  null,
    peRatio:          null,
  };
}

// How old stream data can be before we fall back to REST (60 seconds)
const STREAM_STALE_MS = 60_000;

export function useQuote(symbol: string) {
  const { accessToken, streamPrices } = useTerminalStore();

  const symUpper    = symbol.toUpperCase();
  const streamQuote = streamPrices[symUpper];

  // This symbol has fresh live data if and only if a tick arrived recently
  const hasLiveData = !!streamQuote && (Date.now() - streamQuote.ts) < STREAM_STALE_MS;

  // REST runs when:
  //  - There is a valid access token
  //  - We don't already have fresh stream data for this specific symbol
  //  - Polls every 1 second (backs off to 3s on Schwab 429 rate limit)
  const restEnabled = !!accessToken && !!symbol && !hasLiveData;

  const { data: restData, isLoading, error } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    {
      query: {
        enabled:         restEnabled,
        refetchInterval: (query) => {
          const err = query.state.data?.error;
          if (err === "rate_limited") return 3_000;
          if (
            err === "no_data" ||
            err === "internal_error" ||
            err?.startsWith("api_error_4") ||
            err?.startsWith("api_error_5")
          ) return false;
          return 1_000;
        },
        refetchIntervalInBackground: false,
        staleTime:       500,
      },
    }
  );

  // ── Stream wins when fresh ──────────────────────────────────────────────────
  if (hasLiveData) {
    return {
      data:      fromLive(streamQuote),
      isLoading: false,
      error:     null,
      source:    "stream" as const,
    };
  }

  // ── REST fallback ───────────────────────────────────────────────────────────
  const data: QuoteData | null = restData
    ? {
        symbol:           restData.symbol,
        description:      restData.description      ?? null,
        last:             restData.last              ?? null,
        bid:              restData.bid               ?? null,
        ask:              restData.ask               ?? null,
        change:           restData.change            ?? null,
        changePct:        restData.changePct         ?? null,
        volume:           restData.volume            ?? null,
        high:             restData.high              ?? null,
        low:              restData.low               ?? null,
        close:            null,
        fiftyTwoWeekHigh: restData.fiftyTwoWeekHigh  ?? null,
        fiftyTwoWeekLow:  restData.fiftyTwoWeekLow   ?? null,
        peRatio:          restData.peRatio           ?? null,
        error:            restData.error,
      }
    : null;

  return { data, isLoading, error, source: "rest" as const };
}
