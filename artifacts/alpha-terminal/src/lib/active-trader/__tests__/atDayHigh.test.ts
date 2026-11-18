import { describe, expect, it } from "vitest";
import { resolveDayHighFromStreamQuote } from "../atDayHigh";

const baseQuote = {
  symbol: "$SPX",
  description: null,
  last: 7500,
  regularLast: 7500,
  extendedLast: null,
  bid: null,
  ask: null,
  bidSize: null,
  askSize: null,
  change: 10,
  changePct: 0.1,
  volume: 1,
  high: 7510,
  low: 7488,
  close: 7490,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  peRatio: null,
};

describe("resolveDayHighFromStreamQuote", () => {
  it("rejects overnight placeholder", () => {
    const q = { ...baseQuote, change: 0, high: 0, low: 0 };
    expect(resolveDayHighFromStreamQuote(q).kind).toBe("unavailable");
  });

  it("uses feed high in RTH", () => {
    const noonEt = new Date("2026-11-18T17:00:00.000Z");
    expect(resolveDayHighFromStreamQuote(baseQuote, noonEt).value).toBe(7510);
  });
});