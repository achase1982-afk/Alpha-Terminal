/**
 * useQuote — unified quote data hook.
 *
 * Price data sources (strictly separated):
 *  - ALL price fields (last, bid, ask, change, volume, high, low, close)
 *    come EXCLUSIVELY from the WebSocket stream when live.
 *  - REST is NEVER used for price data when the stream is active.
 *  - REST only provides static/slow metadata: description, 52-week range, PE ratio.
 *  - REST is used as the sole source only before the stream connects.
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
        enabled: !!accessToken && !!symbol,
        refetchInterval: (query) => {
          const err = query.state.data?.error;
          if (err === "rate_limited") return 3_000;
          if (
            err === "no_data" ||
            err === "internal_error" ||
            err?.startsWith("api_error_4") ||
            err?.startsWith("api_error_5")
          ) return false;
          if (hasLiveData) return 120_000;
          return 2_000;
        },
        refetchIntervalInBackground: false,
        staleTime: hasLiveData ? 120_000 : 500,
      },
    }
  );

  const restMatchesSymbol = restData && restData.symbol?.toUpperCase() === symUpper;

  if (hasLiveData) {
    const live: QuoteData = {
      symbol:           streamQuote.symbol,
      last:             streamQuote.last,
      bid:              streamQuote.bid,
      ask:              streamQuote.ask,
      bidSize:          streamQuote.bidSize,
      askSize:          streamQuote.askSize,
      change:           streamQuote.change,
      changePct:        streamQuote.changePct,
      volume:           streamQuote.volume,
      high:             streamQuote.high,
      low:              streamQuote.low,
      close:            streamQuote.close,
      description:      null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow:  null,
      peRatio:          null,
    };

    if (restData && restMatchesSymbol) {
      live.description      = restData.description      ?? null;
      live.fiftyTwoWeekHigh = restData.fiftyTwoWeekHigh  ?? null;
      live.fiftyTwoWeekLow  = restData.fiftyTwoWeekLow   ?? null;
      live.peRatio          = restData.peRatio           ?? null;
    }

    return {
      data:      live,
      isLoading: false,
      error:     null,
      source:    "stream" as const,
    };
  }

  const restQuote: QuoteData | null = restData && restMatchesSymbol
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

  return { data: restQuote, isLoading: isLoading || (!restMatchesSymbol && !!accessToken), error, source: "rest" as const };
}
