import { describe, expect, it } from "vitest";
import { mergeChainContractWithStream, resolveChainDisplayQuote } from "../chainContractQuoteMerge";
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

  it("reproduces mixed-source cross when fields are merged field-by-field (regression guard)", () => {
    const streamBid = 22.8;
    const restAsk = 11.2;
    expect(midpointFromBidAsk(streamBid, restAsk)).toBeNull();
    const fixed = resolveChainDisplayQuote(
      { streamKey: "OPT", bid: 10, ask: restAsk },
      { bid: streamBid, ts: Date.now() },
      Date.now() - 1_000,
    );
    expect(fixed.tapable).toBe(true);
    expect(fixed.bid).toBe(10);
    expect(fixed.ask).toBe(restAsk);
    expect(midpointFromBidAsk(fixed.bid, fixed.ask)).not.toBeNull();
  });

  it("falls back to REST pair when stream book is crossed", () => {
    const now = Date.now();
    const fixed = resolveChainDisplayQuote(
      { streamKey: "OPT", bid: 10, ask: 11.2 },
      { bid: 22.8, ask: 11.2, ts: now },
      now - 5_000,
    );
    expect(fixed.tapable).toBe(true);
    expect(fixed.bid).toBe(10);
    expect(fixed.ask).toBe(11.2);
  });

  it("labels crossed REST book without showing invalid prices", () => {
    const now = Date.now();
    const fixed = resolveChainDisplayQuote({ streamKey: "OPT", bid: 2, ask: 1 }, null, now, now);
    expect(fixed.displayState).toBe("crossed");
    expect(fixed.tapable).toBe(false);
    expect(fixed.bid).toBeUndefined();
    expect(fixed.ask).toBeUndefined();
  });
});