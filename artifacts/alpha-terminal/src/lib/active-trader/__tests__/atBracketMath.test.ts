import { describe, expect, it } from "vitest";
import { computeBracketPrices, roundSpxOptionTick } from "../atBracketMath";

describe("roundSpxOptionTick", () => {
  it("uses 0.05 increment below $3", () => {
    expect(roundSpxOptionTick(2.47)).toBe(2.45);
    expect(roundSpxOptionTick(2.48)).toBe(2.5);
  });
  it("uses 0.10 increment at or above $3", () => {
    expect(roundSpxOptionTick(3.54)).toBe(3.5);
    expect(roundSpxOptionTick(3.56)).toBe(3.6);
  });
});

describe("computeBracketPrices — long", () => {
  const base = {
    entryPrice: 3.6,
    quantity: 1,
    primaryInstruction: "BUY_TO_OPEN" as const,
    tp: { enabled: true, mode: "percent" as const, offset: 10 },
    sl: { enabled: true, mode: "percent" as const, offset: -10 },
  };

  it("percent TP above, SL below entry", () => {
    const { takeProfit, stopLoss } = computeBracketPrices(base);
    expect(takeProfit).toBe(4);
    expect(stopLoss).toBe(3.2);
  });

  it("points offset", () => {
    const { takeProfit, stopLoss } = computeBracketPrices({
      ...base,
      tp: { enabled: true, mode: "points", offset: 0.5 },
      sl: { enabled: true, mode: "points", offset: -0.5 },
    });
    expect(takeProfit).toBe(4.1);
    expect(stopLoss).toBe(3.1);
  });

  it("dollars converts to per-contract price", () => {
    const { takeProfit } = computeBracketPrices({
      ...base,
      tp: { enabled: true, mode: "dollars", offset: 36 },
      sl: { enabled: false, mode: "percent", offset: -10 },
    });
    expect(takeProfit).toBe(roundSpxOptionTick(3.6 + 0.36));
  });
});

describe("computeBracketPrices — penny pilot bump", () => {
  it("bumps TP at least one tick when +10% rounds to entry", () => {
    const { takeProfit } = computeBracketPrices({
      entryPrice: 0.06,
      quantity: 1,
      primaryInstruction: "BUY_TO_OPEN",
      underlyingSymbol: "AAPL",
      assetType: "OPTION",
      tp: { enabled: true, mode: "percent", offset: 10 },
      sl: { enabled: false, mode: "percent", offset: -10 },
    });
    expect(takeProfit).toBeGreaterThan(0.06);
    expect(takeProfit).toBe(0.07);
  });
});

describe("computeBracketPrices — short", () => {
  it("mirrors TP/SL for sell to open", () => {
    const { takeProfit, stopLoss } = computeBracketPrices({
      entryPrice: 4,
      quantity: 2,
      primaryInstruction: "SELL_TO_OPEN",
      tp: { enabled: true, mode: "percent", offset: 10 },
      sl: { enabled: true, mode: "percent", offset: -10 },
    });
    expect(takeProfit).toBe(3.6);
    expect(stopLoss).toBe(4.4);
  });
});