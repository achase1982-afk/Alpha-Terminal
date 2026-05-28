import { describe, expect, it } from "vitest";
import { displayLastForSession } from "../chatLiveQuote.js";
import type { LiveQuote } from "../schwabStreamer.js";

function q(partial: Partial<LiveQuote>): LiveQuote {
  return {
    symbol: "GS",
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
    ts: Date.now(),
    ...partial,
  };
}

describe("displayLastForSession", () => {
  it("uses regular last during OPEN session", () => {
    expect(displayLastForSession(q({ regularLast: 988, last: 990.5 }), "OPEN")).toBe(988);
  });

  it("uses extended print after regular close", () => {
    expect(displayLastForSession(q({ regularLast: 988, last: 991.2 }), "AFTERHOURS")).toBe(991.2);
  });

  it("uses extended print in premarket", () => {
    expect(displayLastForSession(q({ regularLast: 100, last: 101.5 }), "PREMARKET")).toBe(101.5);
  });
});
