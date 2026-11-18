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

  it("rejects stream 0/0 pre-market stub without a close anchor", () => {
    const sc = resolveAtHeaderSessionChange(
      {
        symbol: "$SPX",
        description: null,
        last: 7340.53,
        regularLast: 7340.53,
        extendedLast: null,
        bid: null,
        ask: null,
        bidSize: null,
        askSize: null,
        change: 0,
        changePct: 0,
        volume: null,
        high: 7350,
        low: 7330,
        close: 7340.53,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        peRatio: null,
      },
      null,
      7340.53,
    );
    expect(sc.change).toBeNull();
    expect(sc.changePct).toBeNull();
  });

  it("uses REST session change when stream is flat stub", () => {
    const sc = resolveAtHeaderSessionChange(
      {
        symbol: "$SPX",
        description: null,
        last: 7340.53,
        regularLast: 7340.53,
        extendedLast: null,
        bid: null,
        ask: null,
        bidSize: null,
        askSize: null,
        change: 0,
        changePct: 0,
        volume: null,
        high: 7350,
        low: 7330,
        close: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        peRatio: null,
      },
      { change: -12.4, changePct: -0.17, last: 7340.53 },
      7340.53,
    );
    expect(sc.change).toBe(-12.4);
    expect(sc.changePct).toBe(-0.17);
  });
});