import { describe, expect, it } from "vitest";
import { resolveDayHighFromStreamQuote } from "../atDayHigh";

const baseQuote = {
  symbol: "$SPX",
  description: null,
  last: 7340,
  regularLast: 7340,
  extendedLast: null,
  bid: null,
  ask: null,
  bidSize: null,
  askSize: null,
  change: 1,
  changePct: 0.1,
  volume: 1,
  high: 7368.44,
  low: 7288,
  close: 7300,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  peRatio: null,
};

describe("resolveDayHighFromStreamQuote", () => {
  it("returns a timestamped high in RTH", () => {
    const noonEt = new Date("2026-11-18T17:00:00.000Z");
    const d = resolveDayHighFromStreamQuote({ ...baseQuote, highTimeMs: noonEt.getTime() }, noonEt);
    expect(d.kind).toBe("current");
    expect(d.value).toBe(7368.44);
  });

  it("uses an unstamped feed high during RTH", () => {
    const noonEt = new Date("2026-11-18T17:00:00.000Z");
    expect(resolveDayHighFromStreamQuote(baseQuote, noonEt)).toEqual({ kind: "current", value: 7368.44 });
  });

  it("does not treat yesterday's high as today's range", () => {
    const noonEt = new Date("2026-11-18T17:00:00.000Z");
    const yesterday = new Date("2026-11-17T17:00:00.000Z").getTime();
    expect(resolveDayHighFromStreamQuote({ ...baseQuote, highTimeMs: yesterday }, noonEt)).toEqual({
      kind: "unavailable",
      value: null,
    });
  });
});