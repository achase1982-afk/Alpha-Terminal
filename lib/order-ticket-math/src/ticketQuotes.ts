import { midpointFromBidAsk, resolvePairedBidAsk, type PairedQuoteSource } from "./optionQuotes.js";
import { sanitizeOptionGreek } from "./optionGreeks.js";

export interface StreamOptionTick {
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  ts?: number;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  iv?: number | null;
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
  T extends {
    schwabSymbol: string;
    bid?: number | null;
    ask?: number | null;
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    iv?: number | null;
    contractTs?: number;
  },
>(leg: T, tick: StreamOptionTick | null | undefined): T {
  if (!leg.schwabSymbol) return leg;
  const pair = resolvePairedBidAsk({
    streamBid: tick?.bid ?? undefined,
    streamAsk: tick?.ask ?? undefined,
    streamTs: tick?.ts,
    contractBid: leg.bid ?? undefined,
    contractAsk: leg.ask ?? undefined,
    contractTs: leg.contractTs,
  });
  const greek = (kind: "delta" | "gamma" | "theta" | "vega" | "iv", raw: number | null | undefined) =>
    sanitizeOptionGreek(kind, raw ?? undefined);

  if (!pair) {
    return {
      ...leg,
      bid: leg.bid != null && leg.bid >= 0 ? leg.bid : null,
      ask: leg.ask != null && leg.ask > 0 ? leg.ask : null,
      delta: greek("delta", tick?.delta ?? leg.delta) ?? null,
      gamma: greek("gamma", tick?.gamma ?? leg.gamma) ?? null,
      theta: greek("theta", tick?.theta ?? leg.theta) ?? null,
      vega: greek("vega", tick?.vega ?? leg.vega) ?? null,
      iv: greek("iv", tick?.iv ?? leg.iv) ?? null,
    };
  }
  const bid = pair.crossed ? null : pair.bid >= 0 ? pair.bid : null;
  const ask = pair.crossed ? null : pair.ask > 0 ? pair.ask : null;
  return {
    ...leg,
    bid,
    ask,
    quoteCrossed: pair.crossed,
    delta: greek("delta", tick?.delta ?? leg.delta) ?? null,
    gamma: greek("gamma", tick?.gamma ?? leg.gamma) ?? null,
    theta: greek("theta", tick?.theta ?? leg.theta) ?? null,
    vega: greek("vega", tick?.vega ?? leg.vega) ?? null,
    iv: greek("iv", tick?.iv ?? leg.iv) ?? null,
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
