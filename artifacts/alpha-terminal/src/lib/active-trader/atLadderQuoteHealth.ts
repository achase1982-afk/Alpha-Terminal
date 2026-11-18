import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionTick } from "@/lib/options-stream-store";
import { resolveChainDisplayQuote } from "@/lib/chainContractQuoteMerge";
import { chainQuoteReasonLabel, type QuoteSideState } from "@workspace/order-ticket-math";

export type LadderQuoteLegAudit = {
  strike: number;
  leg: "call" | "put";
  state: QuoteSideState | "stale";
  reason: string;
};

export type LadderQuoteHealthAudit = {
  nearAtmHasInvalid: boolean;
  counts: { crossed: number; incomplete: number; stale: number; ok: number };
  nearAtm: LadderQuoteLegAudit[];
};

function isNearStrike(strike: number, underlying: number | null, maxDistance = 12.5): boolean {
  if (underlying == null || !Number.isFinite(underlying)) return true;
  return Math.abs(strike - underlying) <= maxDistance * 4;
}

export function auditNearAtmLadderQuotes(input: {
  rows: { strike: number; call?: OptionsContract | null; put?: OptionsContract | null }[];
  underlyingPrice: number | null;
  ticks: Record<string, OptionTick | undefined>;
  chainQuoteTs: number;
  nowMs?: number;
}): LadderQuoteHealthAudit {
  const counts = { crossed: 0, incomplete: 0, stale: 0, ok: 0 };
  const nearAtm: LadderQuoteLegAudit[] = [];

  for (const row of input.rows) {
    if (!isNearStrike(row.strike, input.underlyingPrice)) continue;
    for (const leg of ["call", "put"] as const) {
      const contract = leg === "call" ? row.call : row.put;
      if (!contract) continue;
      const tick = contract.streamKey ? input.ticks[contract.streamKey] : undefined;
      const view = resolveChainDisplayQuote(contract, tick ?? null, input.chainQuoteTs, input.nowMs ?? Date.now());
      const state = view.displayState ?? "incomplete";
      if (state === "ok") counts.ok += 1;
      else if (state === "crossed") counts.crossed += 1;
      else if (state === "stale") counts.stale += 1;
      else counts.incomplete += 1;
      if (state !== "ok") {
        nearAtm.push({
          strike: row.strike,
          leg,
          state,
          reason: chainQuoteReasonLabel(state),
        });
      }
    }
  }

  const nearAtmHasInvalid = nearAtm.length > 0;
  return { nearAtmHasInvalid, counts, nearAtm };
}