import { midpointFromBidAsk, resolvePairedBidAsk, type PairedQuoteSource } from "./optionQuotes.js";

export interface StreamOptionTick {
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  ts?: number;
  delta?: number | null;
}

export interface ExecutableQuote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  crossed: boolean;
}

export interface UnderlyingStreamQuote {
  bid: number | null;
  ask: number | null;
  last: number | null;
}

export function pairedQuoteFromStreamTick(tick: StreamOptionTick | null | undefined): ExecutableQuote {
  const source: PairedQuoteSource = {
    streamBid: tick?.bid ?? undefined,
    streamAsk: tick?.ask ?? undefined,
    streamTs: tick?.ts,
  };
  const pair = resolvePairedBidAsk(source);
  if (!pair) {
    return {
      bid: null,
      ask: null,
      last: tick?.last ?? null,
      crossed: false,
    };
  }
  return {
    bid: pair.crossed ? null : pair.bid,
    ask: pair.crossed ? null : pair.ask,
    last: tick?.last ?? null,
    crossed: pair.crossed,
  };
}

export function mergeLegStreamQuotes<
  T extends { schwabSymbol: string; bid?: number | null; ask?: number | null; delta?: number | null },
>(leg: T, tick: StreamOptionTick | null | undefined): T {
  if (!tick || !leg.schwabSymbol) return leg;
  const q = pairedQuoteFromStreamTick(tick);
  return {
    ...leg,
    bid: q.bid ?? leg.bid ?? null,
    ask: q.ask ?? leg.ask ?? null,
    delta: tick.delta ?? leg.delta ?? null,
  };
}

export type TicketPriceMode = "stock" | "single_option" | "multi_option";

/** Executable prices for the ticket: option stream for options, equity stream for stock. */
export function selectTicketExecutablePrices(input: {
  mode: TicketPriceMode;
  underlyingQuote: UnderlyingStreamQuote;
  optionTick?: StreamOptionTick | null;
}): ExecutableQuote {
  if (input.mode === "single_option") {
    return pairedQuoteFromStreamTick(input.optionTick);
  }
  if (input.mode === "stock") {
    const bid = input.underlyingQuote.bid;
    const ask = input.underlyingQuote.ask;
    const crossed = bid != null && ask != null && bid > ask;
    return {
      bid: crossed ? null : bid,
      ask: crossed ? null : ask,
      last: input.underlyingQuote.last,
      crossed,
    };
  }
  return { bid: null, ask: null, last: null, crossed: false };
}

export function executableMid(quote: ExecutableQuote): number | null {
  return midpointFromBidAsk(quote.bid, quote.ask);
}