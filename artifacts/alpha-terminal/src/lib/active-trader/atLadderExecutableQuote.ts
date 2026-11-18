import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionTick } from "@/lib/options-stream-store";
import { resolvePairedBidAsk } from "@workspace/order-ticket-math";

export function atLadderExecutableQuote(
  contract: OptionsContract | null | undefined,
  tick: OptionTick | undefined,
  chainTs = 0,
): { bid: number | null; ask: number | null } {
  if (!contract) return { bid: null, ask: null };
  const pair = resolvePairedBidAsk({
    streamBid: tick?.bid ?? undefined,
    streamAsk: tick?.ask ?? undefined,
    streamTs: tick?.ts,
    contractBid: contract.bid ?? undefined,
    contractAsk: contract.ask ?? undefined,
    contractTs: chainTs,
  });
  if (!pair || pair.crossed) return { bid: null, ask: null };
  const bid = pair.bid >= 0 ? pair.bid : null;
  const ask = pair.ask > 0 ? pair.ask : null;
  return { bid, ask };
}