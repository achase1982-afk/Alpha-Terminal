import { describe, expect, it } from "vitest";
import { sanitizeOptionGreek, formatNetGreekDisplay } from "../optionGreeks.js";
import { resolvePairedBidAsk } from "../optionQuotes.js";

describe("sanitizeOptionGreek", () => {
  it("rejects Schwab-style junk delta", () => {
    expect(sanitizeOptionGreek("delta", 999.4)).toBeNull();
    expect(sanitizeOptionGreek("delta", 0.42)).toBe(0.42);
  });

  it("rejects sentinel iv", () => {
    expect(sanitizeOptionGreek("iv", -999)).toBeNull();
  });
});

describe("formatNetGreekDisplay", () => {
  it("hides absurd net sums", () => {
    expect(formatNetGreekDisplay(99_940.8, 1)).toBeNull();
    expect(formatNetGreekDisplay(42.5, 1)).toBe("42.5");
  });
});

describe("resolvePairedBidAsk partial sides", () => {
  it("falls back to chain ask when stream is zero", () => {
    const pair = resolvePairedBidAsk({
      streamBid: 0,
      streamAsk: 0,
      streamTs: Date.now(),
      contractBid: 0,
      contractAsk: 0.2,
      contractTs: 1,
    });
    expect(pair).not.toBeNull();
    expect(pair!.ask).toBe(0.2);
  });
});