import { describe, expect, it } from "vitest";
import { formatSchwabQuote } from "../chatTools/getQuote.js";
import type { LiveQuote } from "../schwabStreamer.js";

/** Friday 2026-05-22 17:00 ET */
const AFTER_HOURS_ET = new Date("2026-05-22T21:00:00.000Z");

function baseQuote(overrides: Partial<LiveQuote> = {}): LiveQuote {
  return {
    symbol: "IBM",
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
    ...overrides,
  };
}

describe("formatSchwabQuote", () => {
  it("returns normalizedQuote with session-consistent summary after hours", () => {
    const q = baseQuote({
      last: 45.6,
      regularLast: 41.3,
      close: 38.19,
      ts: AFTER_HOURS_ET.getTime(),
    });

    const out = formatSchwabQuote("QBTS", q, "AFTERHOURS", AFTER_HOURS_ET);
    const n = out.normalizedQuote as {
      totalChange: number;
      summary: string;
    };

    expect(out.change).toBeUndefined();
    expect(out.changePct).toBeUndefined();
    expect(out.displayLast).toBe(45.6);
    expect(n.totalChange).toBe(7.41);
    expect(n.summary).toContain("After-hours $45.60");
    expect(n.summary).toContain("+$7.41 (+19.40%)");
  });

  it("uses regular print for displayLast during OPEN session", () => {
    const prevClose = 207.25;
    const regularLast = 225;
    const q = baseQuote({
      last: 242.75,
      regularLast,
      close: prevClose,
      change: regularLast - prevClose,
      changePct: ((regularLast - prevClose) / prevClose) * 100,
    });

    const out = formatSchwabQuote("IBM", q, "OPEN");

    expect(out.displayLast).toBe(regularLast);
    expect(out.regularSessionLast).toBeNull();
    const n = out.normalizedQuote as { totalChange: number };
    expect(n.totalChange).toBeCloseTo(regularLast - prevClose, 2);
  });

  it("falls back last to q.last when regularLast is null", () => {
    const q = baseQuote({ last: 198.5, regularLast: null, close: 190 });
    const out = formatSchwabQuote("IBM", q);
    expect(out.displayLast).toBe(198.5);
  });

  it("uses extended print for displayLast after hours", () => {
    const q = baseQuote({ regularLast: 988, last: 991.5, close: 980 });
    const out = formatSchwabQuote("GS", q, "AFTERHOURS", AFTER_HOURS_ET);
    expect(out.displayLast).toBe(991.5);
  });
});
