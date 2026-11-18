import { describe, expect, it } from "vitest";
import { interpretBracketPlaceOrderResult } from "../bracketPlaceOrderResult";

describe("interpretBracketPlaceOrderResult", () => {
  it("detects entry accepted with rejected exits", () => {
    const r = interpretBracketPlaceOrderResult({
      orderId: "99",
      entryAccepted: true,
      exitsAccepted: false,
      exitsRejected: ["take_profit"],
    });
    expect(r?.userMessage).toMatch(/no exit protection/i);
    expect(r?.entryAccepted).toBe(true);
    expect(r?.exitsAccepted).toBe(false);
  });

  it("returns null for plain success", () => {
    expect(interpretBracketPlaceOrderResult({ orderId: "1" })).toBeNull();
  });
});