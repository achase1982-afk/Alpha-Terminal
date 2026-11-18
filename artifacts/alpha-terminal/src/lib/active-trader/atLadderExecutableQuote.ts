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
  dimmed: boolean;
  asOfLabel: string | null;
  locked: boolean;
};

export function atLadderDisplayQuote(
  contract: OptionsContract | null | undefined,
  tick: OptionTick | undefined,
  chainTs = 0,
  nowMs = Date.now(),
): AtLadderDisplayQuote {
  if (!contract) {
    return {
      bid: null,
      ask: null,
      displayState: "incomplete",
      reason: "No quote",
      tapable: false,
      dimmed: false,
      asOfLabel: null,
      locked: false,
    };
  }
  const view = resolveChainDisplayQuote(contract, tick, chainTs, nowMs);
  const state = view.displayState ?? "incomplete";
  const reason =
    state !== "ok" && state !== "prior_session" ? chainQuoteReasonLabel(state) : null;
  return {
    bid: view.bid ?? null,
    ask: view.ask ?? null,
    displayState: state,
    reason,
    tapable: view.tapable,
    dimmed: view.dimmed ?? false,
    asOfLabel: view.asOfLabel ?? null,
    locked: view.locked ?? false,
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