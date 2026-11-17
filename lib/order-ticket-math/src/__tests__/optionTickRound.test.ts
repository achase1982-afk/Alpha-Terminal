import { describe, expect, it } from "vitest";
import {
  classifyOptionTickMode,
  parseCanonicalLimit,
  roundToTick,
} from "../optionTickRound.js";

describe("optionTickRound symbol-aware", () => {
  it("formats stock limits to cents at $1 and up", () => {
    const n = parseCanonicalLimit("187.4567", { underlyingSymbol: "AAPL", isOption: false });
    expect(n).toBeCloseTo(187.46, 5);
  });

  it("uses penny pilot nickel at $3+ for AAPL options", () => {
    const n = parseCanonicalLimit(3.04, { underlyingSymbol: "AAPL", isOption: true });
    expect(n).toBeCloseTo(3.05, 5);
  });

  it("uses penny pilot penny below $3 for AAPL options", () => {
    const n = parseCanonicalLimit(2.034, { underlyingSymbol: "AAPL", isOption: true });
    expect(n).toBeCloseTo(2.03, 5);
  });

  it("uses penny tick for SPY", () => {
    const n = parseCanonicalLimit(2.034, { underlyingSymbol: "SPY", isOption: true });
    expect(n).toBeCloseTo(2.03, 5);
  });

  it("uses nickel below $3 for SPX", () => {
    const n = parseCanonicalLimit(2.03, { underlyingSymbol: "SPX", isOption: true });
    expect(n).toBeCloseTo(2.05, 5);
  });

  it("uses dime at or above $3 for SPXW", () => {
    const n = parseCanonicalLimit(3.04, { underlyingSymbol: "SPXW", isOption: true });
    expect(n).toBeCloseTo(3.0, 5);
  });

  it("does not round unknown option underlyings", () => {
    const n = parseCanonicalLimit(1.234567, { underlyingSymbol: "ZZZZ", isOption: true });
    expect(n).toBeCloseTo(1.234567, 6);
  });

  it("never rounds positive price to zero", () => {
    const tick = 0.05;
    expect(roundToTick(0.02, tick)).toBe(tick);
  });

  it("accepts partial decimal forms", () => {
    const ctx = { underlyingSymbol: "SPX", isOption: true as const };
    expect(parseCanonicalLimit(".55", ctx)).toBeCloseTo(0.55, 5);
    expect(parseCanonicalLimit("2.", ctx)).toBeCloseTo(2, 5);
    expect(parseCanonicalLimit("0.55", ctx)).toBeCloseTo(0.55, 5);
  });

  it("rejects junk, scientific, signed, and grouped forms", () => {
    const ctx = { underlyingSymbol: "SPX", isOption: true as const };
    expect(parseCanonicalLimit("2.55abc", ctx)).toBeNull();
    expect(parseCanonicalLimit("1e2", ctx)).toBeNull();
    expect(parseCanonicalLimit("-1", ctx)).toBeNull();
    expect(parseCanonicalLimit("1,000", ctx)).toBeNull();
  });

  it("classifies penny pilot vs index", () => {
    expect(classifyOptionTickMode("QQQ")).toBe("penny");
    expect(classifyOptionTickMode("SPX")).toBe("index");
  });
});
