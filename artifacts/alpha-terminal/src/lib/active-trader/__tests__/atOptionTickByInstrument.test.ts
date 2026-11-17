import { describe, expect, it } from "vitest";
import { roundAtPremium } from "../atBracketMath";

function round(underlying: string, price: number): number {
  return roundAtPremium(price, {
    entryPrice: price,
    quantity: 1,
    primaryInstruction: "BUY_TO_OPEN",
    tp: { enabled: false, mode: "percent", offset: 0 },
    sl: { enabled: false, mode: "percent", offset: 0 },
    underlyingSymbol: underlying,
    assetType: "OPTION",
  });
}

describe("instrument tick rounding", () => {
  it("SPX: $0.05 under $3, $0.10 at or above", () => {
    expect(round("SPX", 2.47)).toBe(2.45);
    expect(round("SPX", 3.54)).toBe(3.5);
  });

  it("SPY: $0.01 at all premiums", () => {
    expect(round("SPY", 2.473)).toBe(2.47);
    expect(round("SPY", 8.126)).toBe(8.13);
  });

  it("AAPL penny pilot: $0.01 under $3, $0.05 above", () => {
    expect(round("AAPL", 1.234)).toBe(1.23);
    expect(round("AAPL", 4.78)).toBe(4.8);
  });

  it("stocks use cent ticks", () => {
    expect(
      roundAtPremium(100.126, {
        entryPrice: 100.126,
        quantity: 1,
        primaryInstruction: "BUY",
        tp: { enabled: false, mode: "percent", offset: 0 },
        sl: { enabled: false, mode: "percent", offset: 0 },
        underlyingSymbol: "AAPL",
        assetType: "EQUITY",
      }),
    ).toBe(100.13);
  });
});