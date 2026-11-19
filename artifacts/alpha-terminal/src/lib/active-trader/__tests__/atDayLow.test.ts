import { describe, expect, it } from "vitest";
import { resolveDayLowFromStreamQuote } from "../atDayLow";

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

describe("resolveDayLowFromStreamQuote", () => {
  it("rejects overnight 0/0/0 placeholder", () => {
    const q = { ...baseQuote, change: 0, high: 0, low: 0 };
    expect(resolveDayLowFromStreamQuote(q).kind).toBe("unavailable");
  });

  it("uses a timestamped stream low in RTH as the current session", () => {
    const noonEt = new Date("2026-11-18T17:00:00.000Z");
    const d = resolveDayLowFromStreamQuote({ ...baseQuote, lowTimeMs: noonEt.getTime() }, noonEt);
    expect(d.kind).toBe("current");
    expect(d.value).toBe(7488);
  });

  it("uses an unstamped feed low during RTH and rejects yesterday's low", () => {
    const noonEt = new Date("2026-11-18T17:00:00.000Z");
    expect(resolveDayLowFromStreamQuote(baseQuote, noonEt)).toEqual({ kind: "current", value: 7488 });
    const yesterday = new Date("2026-11-17T17:00:00.000Z").getTime();
    expect(resolveDayLowFromStreamQuote({ ...baseQuote, lowTimeMs: yesterday }, noonEt)).toEqual({
      kind: "unavailable",
      value: null,
    });
  });

  it("labels pre-open valid low as prior", () => {
    const pre = new Date("2026-11-18T13:00:00.000Z");
    const d = resolveDayLowFromStreamQuote(baseQuote, pre);
    expect(d.kind).toBe("prior");
    expect(d.value).toBe(7488);
  });
});