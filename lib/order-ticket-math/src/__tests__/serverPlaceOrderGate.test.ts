import { describe, expect, it } from "vitest";
import { evaluateServerPlaceOrderGate, orderHasClosingLeg } from "../serverPlaceOrderGate.js";

describe("serverPlaceOrderGate", () => {
  it("never rejects closing legs", () => {
    expect(
      orderHasClosingLeg({
        orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: 1 }],
      }),
    ).toBe(true);
    const r = evaluateServerPlaceOrderGate({
      order: {
        price: 5,
        orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: 2, instrument: { assetType: "OPTION" } }],
      },
      accountEquity: 10000,
      settings: { preTradeEnabled: true, blockOnRed: false, preTradeMaxPositionPct: 10 },
    });
    expect(r.reject).toBe(false);
  });

  it("rejects oversized opening option when equity known", () => {
    const r = evaluateServerPlaceOrderGate({
      order: {
        price: 10,
        orderLegCollection: [{ instruction: "BUY_TO_OPEN", quantity: 10, instrument: { assetType: "OPTION" } }],
      },
      accountEquity: 10000,
      settings: { preTradeEnabled: true, blockOnRed: false, preTradeMaxPositionPct: 10 },
    });
    expect(r.reject).toBe(true);
    expect(r.checks.find((c) => c.id === "size")?.level).toBe("RED");
  });

  it("warns but does not reject when equity unknown", () => {
    const r = evaluateServerPlaceOrderGate({
      order: {
        price: 10,
        orderLegCollection: [{ instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION" } }],
      },
      accountEquity: null,
      settings: { preTradeEnabled: true, blockOnRed: false, preTradeMaxPositionPct: 10 },
    });
    expect(r.reject).toBe(false);
    expect(r.checks.find((c) => c.id === "size")?.level).toBe("YELLOW");
  });
});