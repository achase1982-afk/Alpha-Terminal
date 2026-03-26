/**
 * useQuote — unified quote data hook.
 *
 * Priority:
 *  1. Stream price from Zustand (sub-second latency, no extra fetch)
 *  2. REST GET /api/market/quote fallback (30-second poll cadence)
 *
 * Components use this instead of useGetQuote directly so they
 * transparently upgrade to streaming when the WS connection is live.
 */

import { useTerminalStore, type LiveQuote } from "@/lib/store";
import { useGetQuote }                      from "@workspace/api-client-react";

interface QuoteData {
  symbol:           string;
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

export function useQuote(symbol: string) {
  const { accessToken, streamPrices, streamConnected } = useTerminalStore();

  // REST fallback — poll every 30s; disabled when streaming is active
  const restEnabled = !!accessToken && !!symbol && !streamConnected;
  const { data: restData, isLoading, error } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    {
      query: {
        enabled:       restEnabled,
        refetchInterval: 30_000,
        staleTime:     20_000,
      },
    }
  );

  const streamQuote = streamPrices[symbol.toUpperCase()];

  // Stream data wins if available and recent (< 60s old)
  if (streamQuote && Date.now() - streamQuote.ts < 60_000) {
    return {
      data:      fromLive(streamQuote),
      isLoading: false,
      error:     null,
      source:    "stream" as const,
    };
  }

  // REST fallback
  const data: QuoteData | null = restData
    ? {
        symbol:           restData.symbol,
        last:             restData.last      ?? null,
        bid:              restData.bid       ?? null,
        ask:              restData.ask       ?? null,
        change:           restData.change    ?? null,
        changePct:        restData.changePct ?? null,
        volume:           restData.volume    ?? null,
        high:             restData.high      ?? null,
        low:              restData.low       ?? null,
        close:            null,
        fiftyTwoWeekHigh: restData.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow:  restData.fiftyTwoWeekLow  ?? null,
        peRatio:          restData.peRatio           ?? null,
        error:            restData.error,
      }
    : null;

  return { data, isLoading, error, source: "rest" as const };
}
