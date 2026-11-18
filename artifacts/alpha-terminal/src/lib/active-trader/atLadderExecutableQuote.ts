import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionTick } from "@/lib/options-stream-store";
import { resolveChainDisplayQuote } from "@/lib/chainContractQuoteMerge";
import { chainQuoteReasonLabel } from "@workspace/order-ticket-math";

export type AtLadderDisplayQuote = {
  bid: number | null;
  ask: number | null;
  displayState: ReturnType<typeof resolveChainDisplayQuote>["displayState"];
  reason: string | null;
  tapable: boolean;
};

export function atLadderDisplayQuote(
  contract: OptionsContract | null | undefined,
  tick: OptionTick | undefined,
  chainTs = 0,
  nowMs = Date.now(),
): AtLadderDisplayQuote {
  if (!contract) {
    return { bid: null, ask: null, displayState: "incomplete", reason: "No quote", tapable: false };
  }
  const view = resolveChainDisplayQuote(contract, tick, chainTs, nowMs);
  const reason = view.displayState !== "ok" ? chainQuoteReasonLabel(view.displayState ?? "incomplete") : null;
  return {
    bid: view.tapable ? view.bid ?? null : null,
    ask: view.tapable ? view.ask ?? null : null,
    displayState: view.displayState,
    reason,
    tapable: view.tapable,
  };
}

/** @deprecated use atLadderDisplayQuote */
export function atLadderExecutableQuote(
  contract: OptionsContract | null | undefined,
  tick: OptionTick | undefined,
  chainTs = 0,
): { bid: number | null; ask: number | null } {
  const q = atLadderDisplayQuote(contract, tick, chainTs);
  return { bid: q.bid, ask: q.ask };
}