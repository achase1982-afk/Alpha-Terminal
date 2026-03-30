/**
 * useQuote — unified quote data hook.
 *
 * ALL price data (last, bid, ask, change, volume, high, low, close)
 * comes 100% from the WebSocket stream via snapshot polling. Never from REST.
 *
 * REST GET /api/market/quote is ONLY used for static metadata:
 * description, 52-week range, PE ratio. It polls infrequently (2 min)
 * and never touches price fields.
 */

import { useTerminalStore, type LiveQuote } from "@/lib/store";
import { useGetQuote }                      from "@workspace/api-client-react";

export interface QuoteData {
  symbol:           string;
  description:      string | null;
  last:             number | null;
  extendedLast:     number | null;
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

export function useQuote(symbol: string) {
  const symUpper = symbol.toUpperCase();

  const accessToken = useTerminalStore((s) => s.accessToken);
  const streamQuote = useTerminalStore((s) => s.streamPrices[symUpper]) as LiveQuote | undefined;

  const { data: restData } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    {
      query: {
        enabled: !!accessToken && !!symbol,
        refetchInterval: 120_000,
        refetchIntervalInBackground: false,
        staleTime: 120_000,
      },
    }
  );

  const restMatchesSymbol = restData && restData.symbol?.toUpperCase() === symUpper;

  const description      = (restMatchesSymbol ? restData.description      : null) ?? null;
  const fiftyTwoWeekHigh = (restMatchesSymbol ? restData.fiftyTwoWeekHigh : null) ?? null;
  const fiftyTwoWeekLow  = (restMatchesSymbol ? restData.fiftyTwoWeekLow  : null) ?? null;
  const peRatio          = (restMatchesSymbol ? restData.peRatio          : null) ?? null;

  const data: QuoteData = {
    symbol:           symUpper,
    description,
    last:             streamQuote?.last         ?? null,
    extendedLast:     streamQuote?.extendedLast ?? null,
    bid:              streamQuote?.bid          ?? null,
    ask:              streamQuote?.ask          ?? null,
    bidSize:          streamQuote?.bidSize      ?? null,
    askSize:          streamQuote?.askSize      ?? null,
    change:           streamQuote?.change       ?? null,
    changePct:        streamQuote?.changePct    ?? null,
    volume:           streamQuote?.volume       ?? null,
    high:             streamQuote?.high         ?? null,
    low:              streamQuote?.low          ?? null,
    close:            streamQuote?.close        ?? null,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    peRatio,
  };

  const hasAnyPrice = data.last !== null || data.bid !== null;

  return {
    data:      hasAnyPrice ? data : null,
    isLoading: !hasAnyPrice && !!accessToken,
    error:     null,
    source:    "stream" as const,
  };
}
