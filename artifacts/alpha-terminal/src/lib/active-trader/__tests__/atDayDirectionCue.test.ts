import { describe, expect, it } from "vitest";
import { DAY_FLAT_PCT_BAND, resolveDayDirectionCue } from "../atDayDirectionCue";
import type { QuoteData } from "@/hooks/useQuote";

function q(partial: Partial<QuoteData>): QuoteData {
  return {
    symbol: "SPX",
    description: null,
    last: null,
    regularLast: null,
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
    close: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    peRatio: null,
    ...partial,
  };
}

describe("resolveDayDirectionCue", () => {
  it("shows DAY DOWN vs prior close when spot is below", () => {
    const cue = resolveDayDirectionCue(q({ close: 7600, regularLast: 7540, last: 7541 }), 7541);
    expect(cue.label).toMatch(/^DAY DOWN/);
    expect(cue.direction).toBe("down");
    expect(cue.pct).not.toBeNull();
    expect(Math.abs(cue.pct!)).toBeGreaterThan(DAY_FLAT_PCT_BAND);
  });

  it("shows DAY FLAT inside band", () => {
    const close = 7600;
    const spot = close * (1 + 0.02 / 100);
    const cue = resolveDayDirectionCue(q({ close, regularLast: spot }), spot);
    expect(cue.direction).toBe("flat");
    expect(cue.label).toMatch(/^DAY FLAT/);
  });

  it("shows DAY — when prior close missing", () => {
    expect(resolveDayDirectionCue(q({ close: null, last: 7540 }), 7540).label).toBe("DAY —");
  });

  it("day down does not depend on tick spot direction", () => {
    const close = 7600;
    const risingTick = 7545;
    const cue = resolveDayDirectionCue(q({ close, regularLast: risingTick }), risingTick);
    expect(cue.direction).toBe("down");
  });
});