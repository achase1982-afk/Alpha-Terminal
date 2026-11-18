import { describe, expect, it, vi } from "vitest";
import {
  resolveQuarterlyFrontMonth,
  setFuturesActiveSymbolForRoot,
  thirdFridayEtYearMonth,
} from "../futuresFrontMonth.js";
import { schwabFuturesKey } from "../schwabStreamer.js";

describe("futuresFrontMonth", () => {
  it("computes third Friday of a month (ET calendar)", () => {
    expect(thirdFridayEtYearMonth(2026, 12)).toEqual({ year: 2026, month: 12, day: 18 });
  });

  it("prefers streamer field 34 active symbol over roll heuristic", () => {
    setFuturesActiveSymbolForRoot("/ES", "/ESM26");
    expect(schwabFuturesKey("/ES")).toBe("/ESM26");
  });

  it("rolls quarterly roots before the 3rd-Friday-minus-8 cutoff in America/New_York", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-10T15:00:00.000Z"));
    const front = resolveQuarterlyFrontMonth("ES", [2, 5, 8, 11], new Date());
    expect(front).toMatch(/^\/ES[FGHJKMNQUVXZ]\d{2}$/);
    vi.useRealTimers();
  });
});