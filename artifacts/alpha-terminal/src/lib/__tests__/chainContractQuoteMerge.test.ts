import { describe, expect, it } from "vitest";
import { mergeChainContractWithStream } from "../chainContractQuoteMerge";
import { midpointFromBidAsk } from "@workspace/order-ticket-math";

describe("mergeChainContractWithStream", () => {
  it("does not mix REST 10/11 with stream bid-only 12", () => {
    const merged = mergeChainContractWithStream(
      { streamKey: "OPT1", bid: 10, ask: 11 },
      { bid: 12, ts: Date.now() },
      1_700_000_000_000,
    );
    expect(merged.bid).toBe(10);
    expect(merged.ask).toBe(11);
    expect(midpointFromBidAsk(merged.bid, merged.ask)).toBeCloseTo(10.5, 5);
    expect(midpointFromBidAsk(12, merged.ask)).toBeNull();
  });
});