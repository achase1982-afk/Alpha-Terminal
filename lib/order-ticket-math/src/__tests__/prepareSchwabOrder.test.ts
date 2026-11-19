import { describe, expect, it } from "vitest";
import { prepareSchwabOrderForSend } from "../prepareSchwabOrder.js";

describe("prepareSchwabOrderForSend", () => {
  it("strips prices Schwab rejects on stop children and keeps limit children", () => {
    const prepared = prepareSchwabOrderForSend({
      orderStrategyType: "TRIGGER",
      orderType: "LIMIT",
      price: 3.6,
      childOrderStrategies: [
        {
          orderStrategyType: "OCO",
          price: 1,
          orderType: "LIMIT",
          childOrderStrategies: [
            { orderStrategyType: "SINGLE", orderType: "LIMIT", price: 4.5 },
            { orderStrategyType: "SINGLE", orderType: "STOP", price: 3, stopPrice: 3.2 },
            { orderStrategyType: "SINGLE", orderType: "TRAILING_STOP", price: 2, stopPriceOffset: 0.1 },
            { orderStrategyType: "SINGLE", orderType: "LIMIT", price: 0 },
          ],
        },
      ],
    });
    expect(prepared.price).toBe(3.6);
    const oco = (prepared.childOrderStrategies as Record<string, unknown>[])[0];
    expect(oco.orderStrategyType).toBe("OCO");
    expect(oco.price).toBeUndefined();
    expect(oco.orderType).toBeUndefined();
    const children = oco.childOrderStrategies as Record<string, unknown>[];
    expect(children[0].price).toBe(4.5);
    expect(children[1].price).toBeUndefined();
    expect(children[1].stopPrice).toBe(3.2);
    expect(children[2].price).toBeUndefined();
    expect(children[2].stopPriceOffset).toBe(0.1);
    expect(children[3].price).toBeUndefined();
  });
});
