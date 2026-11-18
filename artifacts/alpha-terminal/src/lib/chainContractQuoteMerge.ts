import {
  chainDisplayQuoteState,
  mergeLegStreamQuotes,
  sanitizeOptionGreek,
  type QuoteSideState,
} from "@workspace/order-ticket-math";

type ChainStreamTick = {
  bid?: number | null;
  ask?: number | null;
  ts?: number;
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
  displayState?: QuoteSideState | "stale";
};

export function mergeChainContractWithStream(
  contract: {
    streamKey?: string;
    bid?: number;
    ask?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    iv?: number;
  },
  tick: ChainStreamTick | null | undefined,
  chainTs: number,
): ChainQuoteFields {
  const key = contract.streamKey ?? "";
  const merged = mergeLegStreamQuotes(
    {
      schwabSymbol: key,
      bid: contract.bid,
      ask: contract.ask,
      contractTs: chainTs,
    },
    tick ?? undefined,
  );
  const greek = (kind: "delta" | "gamma" | "theta" | "vega" | "iv", tickVal?: number | null, contractVal?: number) =>
    sanitizeOptionGreek(kind, tickVal ?? contractVal ?? undefined) ?? undefined;
  const rxMs = tick?.ts && tick.ts > 0 ? tick.ts : chainTs > 0 ? chainTs : null;
  return {
    bid: merged.bid != null && merged.bid >= 0 ? merged.bid : undefined,
    ask: merged.ask != null && merged.ask > 0 ? merged.ask : undefined,
    delta: greek("delta", tick?.delta, contract.delta),
    gamma: greek("gamma", tick?.gamma, contract.gamma),
    theta: greek("theta", tick?.theta, contract.theta),
    vega: greek("vega", tick?.vega, contract.vega),
    iv: greek("iv", tick?.iv, contract.iv),
    contractTs: chainTs,
    quoteRxMs: rxMs ?? undefined,
  };
}

/** Single-source bid+ask for chain cells and taps; never field-mix stream + REST. */
export function resolveChainDisplayQuote(
  contract: {
    streamKey?: string;
    bid?: number;
    ask?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    iv?: number;
  } | null,
  tick: ChainStreamTick | null | undefined,
  chainTs: number,
  nowMs = Date.now(),
): ChainQuoteFields & { tapable: boolean } {
  if (!contract) {
    return { tapable: false, displayState: "incomplete" };
  }
  const merged = mergeChainContractWithStream(contract, tick, chainTs);
  const state = chainDisplayQuoteState(merged.bid, merged.ask, merged.quoteRxMs ?? null, nowMs);
  const tapable = state === "ok";
  return {
    ...merged,
    displayState: state,
    bid: tapable ? merged.bid : undefined,
    ask: tapable ? merged.ask : undefined,
    tapable,
  };
}