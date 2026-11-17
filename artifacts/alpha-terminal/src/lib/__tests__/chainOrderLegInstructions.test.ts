import { describe, expect, it } from "vitest";
import { resolveChainLegInstructions } from "../chainOrderLegInstructions";

const accounts = [
  {
    hashValue: "acct-1",
    positions: [
      { symbol: "SPY   261219C00600000", longQuantity: 2, shortQuantity: 0 },
    ],
  },
  {
    hashValue: "acct-2",
    positions: [{ symbol: "SPY   261219C00600000", longQuantity: 10, shortQuantity: 0 }],
  },
];

describe("resolveChainLegInstructions", () => {
  it("uses only the selected trading account", () => {
    const r = resolveChainLegInstructions(
      "SPY   261219C00600000",
      "bid",
      3,
      accounts,
      "acct-1",
    );
    expect(r.slices).toEqual([
      { instruction: "SELL_TO_CLOSE", quantity: 2 },
      { instruction: "SELL_TO_OPEN", quantity: 1 },
    ]);
  });

  it("closes short up to held size then opens", () => {
    const shortAcct = [
      {
        hashValue: "acct-1",
        positions: [{ symbol: "OPT", longQuantity: 0, shortQuantity: 1 }],
      },
    ];
    const r = resolveChainLegInstructions("OPT", "ask", 3, shortAcct, "acct-1");
    expect(r.slices).toEqual([
      { instruction: "BUY_TO_CLOSE", quantity: 1 },
      { instruction: "BUY_TO_OPEN", quantity: 2 },
    ]);
  });
});