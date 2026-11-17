import { mergeLegStreamQuotes } from "@workspace/order-ticket-math";

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
  return {
    bid: merged.bid ?? undefined,
    ask: merged.ask ?? undefined,
    delta: tick?.delta != null ? tick.delta : contract.delta,
    gamma: tick?.gamma != null ? tick.gamma : contract.gamma,
    theta: tick?.theta != null ? tick.theta : contract.theta,
    vega: tick?.vega != null ? tick.vega : contract.vega,
    iv: tick?.iv != null ? tick.iv : contract.iv,
    contractTs: chainTs,
  };
}