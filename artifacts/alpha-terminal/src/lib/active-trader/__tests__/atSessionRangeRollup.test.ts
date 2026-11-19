import { describe, expect, it } from "vitest";
import { resolveSessionLowHighFromQuote } from "../atSessionRangeRollup";
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
  it("keeps the feed low when a local print trades below it", () => {
    const now = new Date("2026-11-18T15:00:00-05:00");
    const tradeTimeMs = now.getTime();
    const { dayLow } = resolveSessionLowHighFromQuote("SPX", baseQuote({ last: 7288, low: 7340, tradeTimeMs }), now);
    expect(dayLow).toEqual({ kind: "current", value: 7340 });
  });

  it("does not label a local print as the day range", () => {
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
      "AAPL",
      baseQuote({
        symbol: "AAPL",
        last: 349.59,
        high: 355.28,
        low: 347.5,
        tradeTimeMs: now.getTime(),
      }),
      now,
    );
    expect(traded.dayLow).toEqual({ kind: "current", value: 347.5 });
    expect(traded.dayHigh).toEqual({ kind: "current", value: 355.28 });
  });
});