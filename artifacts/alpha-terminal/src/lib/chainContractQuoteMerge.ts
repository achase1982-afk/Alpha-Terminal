import {
  mergeLegStreamQuotes,
  resolveChainQuotePresentation,
  resolvePairedBidAsk,
  sanitizeOptionGreek,
  type ChainQuoteUiState,
} from "@workspace/order-ticket-math";

type ChainStreamTick = {
  bid?: number | null;
  ask?: number | null;
  ts?: number;
  quoteTime?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  iv?: number | null;
};

export type ChainQuoteFields = {
  bid?: number;
  ask?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  contractTs?: number;
  quoteRxMs?: number;
  quoteTimeMs?: number;
  displayState?: ChainQuoteUiState;
  asOfLabel?: string | null;
  dimmed?: boolean;
  locked?: boolean;
};

export function mergeChainContractWithStream(
  contract: {
    streamKey?: string;
    bid?: number;
    ask?: number;
    quoteTimeMs?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    iv?: number;
  },
  tick: ChainStreamTick | null | undefined,
  chainFetchedAt: number,
): ChainQuoteFields {
  const key = contract.streamKey ?? "";
  const merged = mergeLegStreamQuotes(
    {
      schwabSymbol: key,
      bid: contract.bid,
      ask: contract.ask,
      contractTs: chainFetchedAt,
    },
    tick ?? undefined,
  );
  const greek = (kind: "delta" | "gamma" | "theta" | "vega" | "iv", tickVal?: number | null, contractVal?: number) =>
    sanitizeOptionGreek(kind, tickVal ?? contractVal ?? undefined) ?? undefined;
  const paired = resolvePairedBidAsk({
    streamBid: tick?.bid ?? undefined,
    streamAsk: tick?.ask ?? undefined,
    streamTs: tick?.ts,
    streamQuoteTime: tick?.quoteTime ?? undefined,
    contractBid: contract.bid ?? undefined,
    contractAsk: contract.ask ?? undefined,
    contractQuoteTime: contract.quoteTimeMs,
    contractTs: chainFetchedAt,
  });
  const quoteTimeMs =
    paired?.source === "stream"
      ? tick?.quoteTime ?? tick?.ts ?? null
      : contract.quoteTimeMs ?? chainFetchedAt;
  return {
    bid: merged.bid != null && merged.bid >= 0 ? merged.bid : undefined,
    ask: merged.ask != null && merged.ask > 0 ? merged.ask : undefined,
    delta: greek("delta", tick?.delta, contract.delta),
    gamma: greek("gamma", tick?.gamma, contract.gamma),
    theta: greek("theta", tick?.theta, contract.theta),
    vega: greek("vega", tick?.vega, contract.vega),
    iv: greek("iv", tick?.iv, contract.iv),
    contractTs: chainFetchedAt,
    quoteRxMs: quoteTimeMs ?? undefined,
    quoteTimeMs: quoteTimeMs ?? undefined,
  };
}

/** Single-source bid+ask for chain cells and taps; never field-mix stream + REST. */
export function resolveChainDisplayQuote(
  contract: {
    streamKey?: string;
    bid?: number;
    ask?: number;
    quoteTimeMs?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    iv?: number;
  } | null,
  tick: ChainStreamTick | null | undefined,
  chainFetchedAt: number,
  nowMs = Date.now(),
): ChainQuoteFields & { tapable: boolean } {
  if (!contract) {
    return { tapable: false, displayState: "incomplete" };
  }
  const paired = resolvePairedBidAsk({
    streamBid: tick?.bid ?? undefined,
    streamAsk: tick?.ask ?? undefined,
    streamTs: tick?.ts,
    streamQuoteTime: tick?.quoteTime ?? undefined,
    contractBid: contract.bid ?? undefined,
    contractAsk: contract.ask ?? undefined,
    contractQuoteTime: contract.quoteTimeMs,
    contractTs: chainFetchedAt,
  });
  const bookBid = paired?.bid ?? contract.bid;
  const bookAsk = paired?.ask ?? contract.ask;
  const quoteTimeMs =
    paired?.source === "stream"
      ? tick?.quoteTime ?? tick?.ts ?? null
      : contract.quoteTimeMs ?? chainFetchedAt;

  const presentation = resolveChainQuotePresentation({
    bid: bookBid,
    ask: bookAsk,
    quoteTimeMs,
    nowMs,
    liveFreshMs: 30 * 60_000,
  });

  const merged = mergeChainContractWithStream(contract, tick, chainFetchedAt);
  return {
    ...merged,
    displayState: presentation.displayState,
    asOfLabel: presentation.asOfLabel,
    dimmed: presentation.dimmed,
    locked: presentation.locked,
    tapable: presentation.tapable,
    bid: presentation.showBid,
    ask: presentation.showAsk,
    quoteTimeMs: quoteTimeMs ?? undefined,
  };
}