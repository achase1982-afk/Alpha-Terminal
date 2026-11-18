import { mergeLegStreamQuotes, sanitizeOptionGreek } from "@workspace/order-ticket-math";

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
  return {
    bid: merged.bid != null && merged.bid >= 0 ? merged.bid : undefined,
    ask: merged.ask != null && merged.ask > 0 ? merged.ask : undefined,
    delta: greek("delta", tick?.delta, contract.delta),
    gamma: greek("gamma", tick?.gamma, contract.gamma),
    theta: greek("theta", tick?.theta, contract.theta),
    vega: greek("vega", tick?.vega, contract.vega),
    iv: greek("iv", tick?.iv, contract.iv),
    contractTs: chainTs,
  };
}