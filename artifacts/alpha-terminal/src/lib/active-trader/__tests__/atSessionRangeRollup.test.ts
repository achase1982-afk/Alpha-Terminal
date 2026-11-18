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

  it("lowers day low when last trades below stale feed low", () => {
    const now = new Date("2026-11-18T15:00:00-05:00");
    touchSessionRange("SPX", baseQuote({ last: 7290, low: 7340 }), now);
    const { dayLow } = resolveSessionLowHighFromQuote("SPX", baseQuote({ last: 7288, low: 7340 }), now);
    expect(dayLow.value).toBeLessThanOrEqual(7288);
  });
});