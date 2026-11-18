import { describe, expect, it } from "vitest";
import type { QuoteData } from "@/hooks/useQuote";
import {
  isOvernightQuotePlaceholder,
  resolveGlanceFromOpenChange,
  resolveSessionChangeDisplay,
} from "../atQuoteSessionChange";

const baseQuote = (over: Partial<QuoteData>): QuoteData => ({
  symbol: "$SPX",
  description: null,
  last: 7340,
  regularLast: 7340,
  extendedLast: null,
  bid: null,
  ask: null,
  bidSize: null,
  askSize: null,
  change: 0,
  changePct: 0,
  volume: null,
  high: 0,
  low: 0,
  close: 7340,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  peRatio: null,
  ...over,
});

describe("atQuoteSessionChange", () => {
  it("detects overnight placeholder zeros", () => {
    expect(isOvernightQuotePlaceholder({ change: 0, high: 0, low: 0 })).toBe(true);
    expect(isOvernightQuotePlaceholder({ change: 0, high: 7350, low: 7300 })).toBe(false);
  });

  it("returns em dash inputs instead of fake zero change", () => {
    const q = baseQuote({});
    expect(resolveSessionChangeDisplay(q, { change: 0, high: 0, low: 0 })).toEqual({
      change: null,
      changePct: null,
    });
    expect(resolveGlanceFromOpenChange(q, 7340, 7340, null)).toBeNull();
  });

  it("uses prior session net when stream has real change", () => {
    const q = baseQuote({ change: 12.5, changePct: 0.17, high: 7355, low: 7320 });
    expect(resolveSessionChangeDisplay(q, null)).toEqual({
      change: 12.5,
      changePct: 0.17,
    });
  });

  it("derives change from close vs regular last when placeholder", () => {
    const q = baseQuote({ close: 7320, regularLast: 7340, last: 7340 });
    const d = resolveSessionChangeDisplay(q, null);
    expect(d.change).toBe(20);
    expect(d.changePct).toBeCloseTo((20 / 7320) * 100, 5);
  });
});