import { describe, expect, it } from "vitest";
import {
  aggregateSpreadNBBO,
  chainDisplayQuoteState,
  chainQuoteReasonLabel,
  midpointFromBidAsk,
  quoteSideState,
  resolvePairedBidAsk,
  resolveChainQuotePresentation,
} from "../optionQuotes.js";

describe("optionQuotes", () => {
  it("rejects crossed SPX 0DTE books", () => {
    expect(quoteSideState(22.8, 11.2)).toBe("crossed");
    expect(midpointFromBidAsk(22.8, 11.2)).toBeNull();
  });

  it("computes midpoint only when bid <= ask", () => {
    expect(midpointFromBidAsk(9.5, 11.2)).toBeCloseTo(10.35, 5);
    expect(midpointFromBidAsk(null, 1)).toBeNull();
  });

  it("chain display requires bid>0 and ask>0", () => {
    expect(chainDisplayQuoteState(0, 0.2, Date.now())).toBe("incomplete");
    expect(chainDisplayQuoteState(1.1, 1.2, Date.now())).toBe("ok");
    expect(chainDisplayQuoteState(1.2, 1.1, Date.now())).toBe("crossed");
    expect(chainDisplayQuoteState(1.1, 1.2, Date.now() - 20_000)).toBe("ok");
  });

  it("maps display states to short UI reasons", () => {
    expect(chainQuoteReasonLabel("crossed")).toBe("Crossed");
    expect(chainQuoteReasonLabel("incomplete")).toBe("No quote");
    expect(chainQuoteReasonLabel("stale")).toBe("Stale");
    expect(chainQuoteReasonLabel("ok")).toBe("");
  });

  it("treats zero bid with positive ask as a usable two-sided quote", () => {
    expect(quoteSideState(0, 0.2)).toBe("ok");
    expect(midpointFromBidAsk(0, 0.2)).toBeCloseTo(0.1, 5);
    expect(quoteSideState(null, 0.2)).toBe("incomplete");
    expect(quoteSideState(0, 0)).toBe("incomplete");
  });

  it("returns null mid when any leg quote is missing", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 3.7, ask: 3.8 },
      { instruction: "SELL_TO_OPEN", bid: null, ask: 1.25 },
    ]);
    expect(agg).toBeNull();
  });

  it("does not synthesize bid=0 from ask-only stream", () => {
    expect(resolvePairedBidAsk({ streamAsk: 0.2 })).toBeNull();
    expect(resolvePairedBidAsk({ streamBid: 1.1, contractAsk: 1.2 })).toBeNull();
  });

  it("uses full contract pair when stream is one-sided", () => {
    const pair = resolvePairedBidAsk({
      streamBid: 2.4,
      contractBid: 1.1,
      contractAsk: 1.2,
    });
    expect(pair).toEqual({ bid: 1.1, ask: 1.2, source: "contract", crossed: false });
  });

  it("prefers REST when stream pair is crossed but contract is valid", () => {
    const pair = resolvePairedBidAsk({
      streamBid: 22.8,
      streamAsk: 11.2,
      streamTs: 9_000,
      contractBid: 5.05,
      contractAsk: 5.45,
      contractQuoteTime: 8_000,
    });
    expect(pair).toEqual({ bid: 5.05, ask: 5.45, source: "contract", crossed: false });
  });

  it("prefers stream only when newer quote time than stored contract pair", () => {
    const fresh = resolvePairedBidAsk({
      streamBid: 1.1,
      streamAsk: 1.2,
      streamTs: 2000,
      streamQuoteTime: 2000,
      contractBid: 1.0,
      contractAsk: 1.05,
      contractQuoteTime: 1000,
    });
    expect(fresh?.source).toBe("stream");
    const stale = resolvePairedBidAsk({
      streamBid: 1.1,
      streamAsk: 1.2,
      streamTs: 500,
      streamQuoteTime: 500,
      contractBid: 1.0,
      contractAsk: 1.05,
      contractQuoteTime: 1000,
    });
    expect(stale?.source).toBe("contract");
  });

  it("keeps available sides tappable for crossed and one-sided books", () => {
    const nowMs = Date.parse("2026-11-18T15:00:00.000Z");
    const crossed = resolveChainQuotePresentation({ bid: 2, ask: 1, quoteTimeMs: nowMs, nowMs });
    expect(crossed.displayState).toBe("crossed");
    expect(crossed.bidTapable).toBe(true);
    expect(crossed.askTapable).toBe(true);
    const oneSided = resolveChainQuotePresentation({ bid: undefined, ask: 1.2, quoteTimeMs: nowMs, nowMs });
    expect(oneSided.displayState).toBe("incomplete");
    expect(oneSided.bidTapable).toBe(false);
    expect(oneSided.askTapable).toBe(true);
    expect(oneSided.showAsk).toBe(1.2);
  });

  it("shows ok for two-sided books regardless of quote age", () => {
    const liveNow = Date.parse("2026-11-18T15:00:00.000Z");
    const aged = resolveChainQuotePresentation({
      bid: 1,
      ask: 1.1,
      quoteTimeMs: liveNow - 20_000,
      nowMs: liveNow,
    });
    expect(aged.displayState).toBe("ok");
    expect(aged.tapable).toBe(true);
    expect(aged.dimmed).toBe(false);
  });

  it("debit vertical uses positive natural-direction NBBO", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 3.7, ask: 3.8 },
      { instruction: "SELL_TO_OPEN", bid: 1.2, ask: 1.25 },
    ]);
    expect(agg).not.toBeNull();
    expect(agg!.crossed).toBe(false);
    expect(agg!.bid).toBeCloseTo(2.45, 5);
    expect(agg!.ask).toBeCloseTo(2.6, 5);
    expect(agg!.mid).toBeCloseTo(2.525, 5);
  });

  it("credit vertical uses positive natural-direction NBBO", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "SELL_TO_OPEN", bid: 3.7, ask: 3.8 },
      { instruction: "BUY_TO_OPEN", bid: 1.2, ask: 1.25 },
    ]);
    expect(agg).not.toBeNull();
    expect(agg!.crossed).toBe(false);
    expect(agg!.bid).toBeCloseTo(2.45, 5);
    expect(agg!.ask).toBeCloseTo(2.6, 5);
    expect(agg!.mid).toBeCloseTo(2.525, 5);
  });

  it("collar / risk reversal nets are not treated as crossed", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 1.0, ask: 1.05 },
      { instruction: "SELL_TO_OPEN", bid: 1.0, ask: 1.1 },
    ]);
    expect(agg).not.toBeNull();
    expect(agg!.crossed).toBe(false);
    expect(agg!.bid).toBeCloseTo(-0.05, 5);
    expect(agg!.ask).toBeCloseTo(0.1, 5);
    expect(agg!.mid).toBeCloseTo(0.025, 5);
  });

  it("flags any leg-level cross without flipping net signs", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 1.0, ask: 1.05 },
      { instruction: "SELL_TO_OPEN", bid: 1.2, ask: 1.0 },
    ]);
    expect(agg).not.toBeNull();
    expect(agg!.crossed).toBe(true);
    expect(agg!.mid).toBeNull();
  });

  it("call fly 5900/5905x2/5910 weights quantity for mid 0.60", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 5.0, ask: 5.0, quantity: 1 },
      { instruction: "SELL_TO_OPEN", bid: 2.7, ask: 2.7, quantity: 2 },
      { instruction: "BUY_TO_OPEN", bid: 1.0, ask: 1.0, quantity: 1 },
    ]);
    expect(agg).not.toBeNull();
    expect(agg!.mid).toBeCloseTo(0.6, 5);
  });

  it("call BWB 500/505x2/515 NBBO uses middle qty 2", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 8.0, ask: 8.1, quantity: 1 },
      { instruction: "SELL_TO_OPEN", bid: 5.0, ask: 5.1, quantity: 2 },
      { instruction: "BUY_TO_OPEN", bid: 2.2, ask: 2.3, quantity: 1 },
    ]);
    expect(agg).not.toBeNull();
    const unweighted = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 8.0, ask: 8.1, quantity: 1 },
      { instruction: "SELL_TO_OPEN", bid: 5.0, ask: 5.1, quantity: 1 },
      { instruction: "BUY_TO_OPEN", bid: 2.2, ask: 2.3, quantity: 1 },
    ]);
    expect(unweighted!.mid).toBeCloseTo(5.25, 5);
    expect(agg!.mid).toBeCloseTo(-0.2, 5);
    expect(Math.abs(agg!.mid!)).toBeLessThan(Math.abs(unweighted!.mid!));
  });

  it("2-lot vertical GCD-normalizes leg quantities", () => {
    const one = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 3.7, ask: 3.8, quantity: 1 },
      { instruction: "SELL_TO_OPEN", bid: 1.2, ask: 1.25, quantity: 1 },
    ]);
    const two = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 3.7, ask: 3.8, quantity: 2 },
      { instruction: "SELL_TO_OPEN", bid: 1.2, ask: 1.25, quantity: 2 },
    ]);
    expect(one!.mid).toBeCloseTo(two!.mid!, 8);
    expect(one!.bid).toBeCloseTo(two!.bid!, 8);
  });
});
