import { describe, expect, it, beforeEach } from "vitest";
import {
  resetSessionRangeRollupsForTests,
  resolveSessionLowHighFromQuote,
  touchSessionRange,
} from "../atSessionRangeRollup";
import type { QuoteData } from "@/hooks/useQuote";

const baseQuote = (over: Partial<QuoteData>): QuoteData => ({
  symbol: "SPX",
  description: null,
  last: 7300,
  regularLast: 7300,
  extendedLast: null,
  bid: 7299,
  ask: 7301,
  bidSize: null,
  askSize: null,
  change: -10,
  changePct: -0.1,
  volume: 1,
  high: 7350,
  low: 7340,
  close: 7310,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  peRatio: null,
  ...over,
});

describe("atSessionRangeRollup", () => {
  beforeEach(() => {
    resetSessionRangeRollupsForTests();
  });

  it("lowers day low when a timestamped last trades below the feed low", () => {
    const now = new Date("2026-11-18T15:00:00-05:00");
    const tradeTimeMs = now.getTime();
    touchSessionRange("SPX", baseQuote({ last: 7290, low: 7340, tradeTimeMs }), now);
    const { dayLow } = resolveSessionLowHighFromQuote("SPX", baseQuote({ last: 7288, low: 7340, tradeTimeMs }), now);
    expect(dayLow.value).toBeLessThanOrEqual(7288);
  });

  it("ignores yesterday's extreme and an outlying bid, then takes a new traded print", () => {
    const now = new Date("2026-11-18T15:00:00-05:00");
    const yesterday = new Date("2026-11-17T15:00:00-05:00").getTime();
    const stale = baseQuote({
      high: 8000,
      low: 1000,
      bid: 1,
      ask: 9000,
      last: 7300,
      tradeTimeMs: yesterday,
      highTimeMs: yesterday,
      lowTimeMs: yesterday,
    });
    const untouched = resolveSessionLowHighFromQuote("SPX", stale, now);
    expect(untouched.dayLow).toEqual({ kind: "unavailable", value: null });
    expect(untouched.dayHigh).toEqual({ kind: "unavailable", value: null });

    const traded = resolveSessionLowHighFromQuote(
      "SPX",
      baseQuote({ last: 7312.5, high: 8000, low: 1000, bid: 1, ask: 9000, tradeTimeMs: now.getTime() }),
      now,
    );
    expect(traded.dayLow).toEqual({ kind: "current", value: 7312.5 });
    expect(traded.dayHigh).toEqual({ kind: "current", value: 7312.5 });
    expect(traded.dayLow.value).not.toBe(0);
    expect(traded.dayHigh.value).not.toBe(0);
  });
});