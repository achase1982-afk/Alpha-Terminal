import { describe, expect, it } from "vitest";
import { aggregateSpreadNBBO, midpointFromBidAsk, quoteSideState } from "../optionQuotes.js";

describe("optionQuotes", () => {
  it("rejects crossed SPX 0DTE books", () => {
    expect(quoteSideState(22.8, 11.2)).toBe("crossed");
    expect(midpointFromBidAsk(22.8, 11.2)).toBeNull();
  });

  it("computes midpoint only when bid <= ask", () => {
    expect(midpointFromBidAsk(9.5, 11.2)).toBeCloseTo(10.35, 5);
    expect(midpointFromBidAsk(null, 1)).toBeNull();
  });

  it("returns null mid when any leg quote is missing", () => {
    const agg = aggregateSpreadNBBO([
      { instruction: "BUY_TO_OPEN", bid: 3.7, ask: 3.8 },
      { instruction: "SELL_TO_OPEN", bid: null, ask: 1.25 },
    ]);
    expect(agg?.mid).toBeNull();
  });

  it("flags crossed aggregated spreads without swapping", () => {
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
});