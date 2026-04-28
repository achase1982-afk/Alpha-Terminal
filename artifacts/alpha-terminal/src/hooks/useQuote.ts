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
  regularLast:      number | null;
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

const INDEX_PREFIXES = new Set([
  "VIX","SPX","NDX","RUT","DJI","DJIA","COMP","DXY","TNX","TYX","VXN",
  "OEX","MNX","XSP","ADVN","DECN","TICK","ADD","TRIN","VVIX","VIX9D","VIX3M",
]);

export function useQuote(symbol: string, options?: { enabled?: boolean }) {
  const symUpper = symbol.toUpperCase();
  const restEnabled = options?.enabled !== false;

  const accessToken = useTerminalStore((s) => s.accessToken);
  const directQuote = useTerminalStore((s) => s.streamPrices[symUpper]) as LiveQuote | undefined;
  const bareName = symUpper.startsWith("$") ? symUpper.slice(1) : symUpper;
  const isIndex = symUpper.startsWith("$") || INDEX_PREFIXES.has(bareName);
  const altKey = isIndex
    ? (symUpper.startsWith("$") ? bareName : `$${symUpper}`)
    : null;
  const altQuote = useTerminalStore((s) =>
    !directQuote && altKey
      ? s.streamPrices[altKey] as LiveQuote | undefined
      : undefined
  );
  const streamQuote = directQuote ?? altQuote;

  const { data: restData } = useGetQuote(
    { symbol, accessToken: "" },
    {
      query: {
        enabled: !!accessToken && !!symbol && restEnabled,
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
    regularLast:      streamQuote?.regularLast  ?? null,
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
  const hasAnyData = hasAnyPrice || description !== null;

  return {
    data:      hasAnyData ? data : null,
    isLoading: !hasAnyData && !!accessToken,
    error:     null,
    source:    "stream" as const,
  };
}
