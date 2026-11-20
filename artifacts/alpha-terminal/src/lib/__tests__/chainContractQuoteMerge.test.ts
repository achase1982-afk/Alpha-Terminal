import { describe, expect, it } from "vitest";
import { mergeChainContractWithStream, resolveChainDisplayQuote } from "../chainContractQuoteMerge";
import { equityOptionsGthOpenMs, midpointFromBidAsk } from "@workspace/order-ticket-math";

const sessionNow = () => equityOptionsGthOpenMs(Date.now()) + 2 * 60 * 60_000;

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
    const now = sessionNow();
    const fixed = resolveChainDisplayQuote(
      { streamKey: "OPT", bid: 10, ask: restAsk, quoteTimeMs: now },
      { bid: streamBid, ts: now },
      now - 1_000,
      now,
    );
    expect(fixed.tapable).toBe(true);
    expect(fixed.bid).toBe(10);
    expect(fixed.ask).toBe(restAsk);
    expect(midpointFromBidAsk(fixed.bid, fixed.ask)).not.toBeNull();
  });

  it("falls back to REST pair when stream book is crossed", () => {
    const now = sessionNow();
    const fixed = resolveChainDisplayQuote(
      { streamKey: "OPT", bid: 10, ask: 11.2, quoteTimeMs: now },
      { bid: 22.8, ask: 11.2, ts: now },
      now - 5_000,
      now,
    );
    expect(fixed.tapable).toBe(true);
    expect(fixed.bid).toBe(10);
    expect(fixed.ask).toBe(11.2);
  });

  it("labels crossed REST book while keeping both priced sides tappable", () => {
    const now = sessionNow();
    const fixed = resolveChainDisplayQuote({ streamKey: "OPT", bid: 2, ask: 1, quoteTimeMs: now }, null, now, now);
    expect(fixed.displayState).toBe("crossed");
    expect(fixed.tapable).toBe(true);
    expect(fixed.bidTapable).toBe(true);
    expect(fixed.askTapable).toBe(true);
    expect(fixed.bid).toBe(2);
    expect(fixed.ask).toBe(1);
  });

  it("prefers REST when stream is crossed even with an old quote time", () => {
    const gth = Date.now();
    const prior = gth - 20 * 3_600_000;
    const fixed = resolveChainDisplayQuote(
      { streamKey: "AAPL", bid: 5.05, ask: 5.45, quoteTimeMs: prior },
      { bid: 22.8, ask: 11.2, ts: gth },
      gth,
      gth + 45 * 60_000,
    );
    expect(fixed.displayState).toBe("stale");
    expect(fixed.bid).toBeCloseTo(5.05, 5);
    expect(fixed.asOfLabel).toContain("as of");
    expect(fixed.dimmed).toBe(true);
    expect(fixed.tapable).toBe(true);
  });
});