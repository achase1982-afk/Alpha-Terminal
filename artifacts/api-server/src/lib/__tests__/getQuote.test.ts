import { describe, expect, it } from "vitest";
import { formatSchwabQuote } from "../chatTools/getQuote.js";
import type { LiveQuote } from "../schwabStreamer.js";

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
  it("forwards refLast-aligned spot, change, and changePct that reconcile", () => {
    const prevClose = 207.25;
    const regularLast = 225;
    const change = regularLast - prevClose;
    const changePct = (change / prevClose) * 100;
    const q = baseQuote({
      last: 242.75,
      regularLast,
      close: prevClose,
      change,
      changePct,
    });

    const out = formatSchwabQuote("IBM", q);

    expect(out.last).toBe(regularLast);
    expect(out.regularSessionLast).toBe(regularLast);
    expect(out.change).toBe(change);
    expect(out.changePct).toBe(changePct);
    expect(out.prevClose).toBe(prevClose);

    const last = out.last as number;
    const prev = out.prevClose as number;
    const ch = out.change as number;
    const pct = out.changePct as number;
    expect(last - prev).toBeCloseTo(ch, 6);
    expect((ch / prev) * 100).toBeCloseTo(pct, 6);
  });

  it("falls back last to q.last when regularLast is null", () => {
    const q = baseQuote({ last: 198.5, regularLast: null });
    const out = formatSchwabQuote("IBM", q);
    expect(out.last).toBe(198.5);
    expect(out.regularSessionLast).toBeNull();
  });

  it("uses extended print for displayLast after hours", () => {
    const q = baseQuote({ regularLast: 988, last: 991.5 });
    const out = formatSchwabQuote("GS", q, "AFTERHOURS");
    expect(out.displayLast).toBe(991.5);
    expect(out.last).toBe(991.5);
  });

  it("returns change null without throwing when change is missing", () => {
    const q = baseQuote({ last: 100, change: null, changePct: 1.5, close: 98.5 });
    expect(() => formatSchwabQuote("IBM", q)).not.toThrow();
    const out = formatSchwabQuote("IBM", q);
    expect(out.change).toBeNull();
  });
});
