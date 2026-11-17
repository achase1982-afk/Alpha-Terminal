import { describe, expect, it } from "vitest";
import { mergeOptionTickFromSchwab, type OptionTick } from "../schwabStreamer.js";

describe("mergeOptionTickFromSchwab", () => {
  it("preserves bid/ask when a partial update omits them", () => {
    const existing: OptionTick = {
      key: "K1",
      bid: 1.2,
      ask: 1.3,
      last: 1.25,
      bidSize: 10,
      askSize: 12,
      volume: 100,
      openInterest: null,
      iv: 0.2,
      delta: 0.5,
      gamma: 0.01,
      theta: -0.05,
      vega: 0.1,
      mark: 1.26,
      change: 0.1,
      lastSize: 1,
      underlyingPrice: 5000,
      quoteTime: 100,
      tradeTime: 200,
      ts: 1,
    };
    const merged = mergeOptionTickFromSchwab(existing, { "4": 1.28, "8": 105 }, "K1", 2);
    expect(merged.bid).toBe(1.2);
    expect(merged.ask).toBe(1.3);
    expect(merged.last).toBe(1.28);
    expect(merged.volume).toBe(105);
    expect(merged.ts).toBe(2);
  });
});