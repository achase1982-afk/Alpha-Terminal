import { describe, expect, it } from "vitest";
import { resolveAtHeaderSessionChange } from "../atHeaderSessionChange";

describe("resolveAtHeaderSessionChange", () => {
  it("derives pct from close and spot when stream change missing", () => {
    const sc = resolveAtHeaderSessionChange(
      {
        symbol: "$SPX",
        description: null,
        last: 7340,
        regularLast: 7340,
        extendedLast: null,
        bid: null,
        ask: null,
        bidSize: null,
        askSize: null,
        change: null,
        changePct: null,
        volume: null,
        high: null,
        low: null,
        close: 7399.2,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        peRatio: null,
      },
      null,
      7340,
    );
    expect(sc.change).not.toBeNull();
    expect(sc.changePct).not.toBeNull();
    expect(sc.changePct! < 0).toBe(true);
  });
});