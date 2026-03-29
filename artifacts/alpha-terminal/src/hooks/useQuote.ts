/**
 * useQuote — unified quote data hook.
 *
 * Priority (per symbol, independently):
 *  1. Stream price from Zustand when THAT SYMBOL has fresh data (< 60s old)
 *  2. REST GET /api/market/quote fallback — always runs until stream data arrives
 *
 * Performance: uses per-symbol Zustand selector with shallow equality so each
 * consumer only re-renders when its own symbol's stream data changes.
 */

import { useTerminalStore, type LiveQuote } from "@/lib/store";
import { useGetQuote }                      from "@workspace/api-client-react";

export interface QuoteData {
  symbol:           string;
  description:      string | null;
  last:             number | null;
  bid:              number | null;
  ask:              number | null;
  bidSize:          number | null;
  askSize:          number | null;
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
    description:      null,
    last:             q.last,
    bid:              q.bid,
    ask:              q.ask,
    bidSize:          q.bidSize,
    askSize:          q.askSize,
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

const STREAM_STALE_MS = 60_000;

export function useQuote(symbol: string) {
  const symUpper = symbol.toUpperCase();

  const accessToken = useTerminalStore((s) => s.accessToken);
  const streamQuote = useTerminalStore((s) => s.streamPrices[symUpper]) as LiveQuote | undefined;

  const hasLiveData = !!streamQuote && (Date.now() - streamQuote.ts) < STREAM_STALE_MS;

  const { data: restData, isLoading, error } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    {
      query: {
        enabled:         !!accessToken && !!symbol,
        refetchInterval: (query) => {
          if (hasLiveData && query.state.data && !query.state.data.error) return false;
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
        staleTime:       hasLiveData ? 30_000 : 500,
      },
    }
  );

  const restQuote: QuoteData | null = restData
    ? {
        symbol:           restData.symbol,
        description:      restData.description      ?? null,
        last:             restData.last              ?? null,
        bid:              restData.bid               ?? null,
        ask:              restData.ask               ?? null,
        bidSize:          (restData as any).bidSize   ?? null,
        askSize:          (restData as any).askSize   ?? null,
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

  if (hasLiveData) {
    const live = fromLive(streamQuote);

    if (live.last === null && restQuote?.last != null)       live.last = restQuote.last;
    if (live.bid === null && restQuote?.bid != null)         live.bid = restQuote.bid;
    if (live.ask === null && restQuote?.ask != null)         live.ask = restQuote.ask;
    if (live.bidSize === null && restQuote?.bidSize != null) live.bidSize = restQuote.bidSize;
    if (live.askSize === null && restQuote?.askSize != null) live.askSize = restQuote.askSize;
    if (live.change === null && restQuote?.change != null) {
      live.change    = restQuote.change;
      live.changePct = restQuote.changePct;
    }
    if (live.volume === null && restQuote?.volume != null)   live.volume = restQuote.volume;
    if (live.high === null && restQuote?.high != null)       live.high = restQuote.high;
    if (live.low === null && restQuote?.low != null)         live.low = restQuote.low;
    if (live.close === null && restQuote?.close != null)     live.close = restQuote.close;

    live.description      = restQuote?.description      ?? live.description;
    live.fiftyTwoWeekHigh = restQuote?.fiftyTwoWeekHigh ?? live.fiftyTwoWeekHigh;
    live.fiftyTwoWeekLow  = restQuote?.fiftyTwoWeekLow  ?? live.fiftyTwoWeekLow;
    live.peRatio          = restQuote?.peRatio           ?? live.peRatio;

    return {
      data:      live,
      isLoading: false,
      error:     null,
      source:    "stream" as const,
    };
  }

  return { data: restQuote, isLoading, error, source: "rest" as const };
}
