import { describe, expect, it } from "vitest";
import {
  evaluateServerPlaceOrderGate,
  DEFAULT_SERVER_PRE_TRADE,
  isClosingSchwabOrder,
} from "../serverPlaceOrderGate.js";

const EQUITY = 30_000;

describe("isClosingSchwabOrder", () => {
  it("treats stock SELL as closing", () => {
    expect(
      isClosingSchwabOrder({
        orderLegCollection: [{ instruction: "SELL", quantity: 100, instrument: { assetType: "EQUITY", symbol: "AAPL" } }],
      }),
    ).toBe(true);
  });

  it("treats BUY_TO_COVER as closing", () => {
    expect(
      isClosingSchwabOrder({
        orderLegCollection: [{ instruction: "BUY_TO_COVER", quantity: 50, instrument: { assetType: "EQUITY", symbol: "AAPL" } }],
      }),
    ).toBe(true);
  });

  it("treats option TO_CLOSE as closing", () => {
    expect(
      isClosingSchwabOrder({
        orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: 1, instrument: { assetType: "OPTION", symbol: "AAPL  250117C00200000" } }],
      }),
    ).toBe(true);
  });
});

describe("evaluateServerPlaceOrderGate", () => {
  it("never rejects closing stock SELL even when notional exceeds size cap", () => {
    const r = evaluateServerPlaceOrderGate({
      order: {
        price: 100,
        orderLegCollection: [{ instruction: "SELL", quantity: 100, instrument: { assetType: "EQUITY", symbol: "AAPL" } }],
      },
      accountEquity: EQUITY,
      settings: DEFAULT_SERVER_PRE_TRADE,
    });
    expect(r.reject).toBe(false);
  });

  it("never rejects BUY_TO_COVER", () => {
    const r = evaluateServerPlaceOrderGate({
      order: {
        price: 50,
        orderLegCollection: [{ instruction: "BUY_TO_COVER", quantity: 200, instrument: { assetType: "EQUITY", symbol: "GME" } }],
      },
      accountEquity: EQUITY,
      settings: DEFAULT_SERVER_PRE_TRADE,
    });
    expect(r.reject).toBe(false);
  });

  it("rejects 10-lot 50-wide credit spread at 1.00 vs 30k @ 3% threshold", () => {
    const r = evaluateServerPlaceOrderGate({
      order: {
        orderType: "NET_CREDIT",
        price: 1,
        orderLegCollection: [
          {
            instruction: "SELL_TO_OPEN",
            quantity: 10,
            instrument: { assetType: "OPTION", symbol: "SPXW  261118C05900000" },
          },
          {
            instruction: "BUY_TO_OPEN",
            quantity: 10,
            instrument: { assetType: "OPTION", symbol: "SPXW  261118C05950000" },
          },
        ],
      },
      accountEquity: EQUITY,
      settings: DEFAULT_SERVER_PRE_TRADE,
    });
    expect(r.reject).toBe(true);
    expect(r.checks.find((c) => c.id === "size")?.level).toBe("RED");
  });

  it("warns when equity unknown", () => {
    const r = evaluateServerPlaceOrderGate({
      order: {
        price: 2,
        orderLegCollection: [{ instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: "AAPL  250117C00200000" } }],
      },
      accountEquity: null,
      settings: DEFAULT_SERVER_PRE_TRADE,
    });
    expect(r.reject).toBe(false);
    expect(r.checks.find((c) => c.id === "size")?.level).toBe("YELLOW");
  });
});
