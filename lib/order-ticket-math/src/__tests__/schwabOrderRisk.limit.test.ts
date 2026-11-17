import { describe, expect, it } from "vitest";
import { evaluateServerPlaceOrderGate } from "../serverPlaceOrderGate.js";
import { schwabOrderMaxRisk } from "../schwabOrderRisk.js";

describe("LIMIT multi-leg credit inference", () => {
  const C5950 = "SPXW  261118C05950000";
  const C5900 = "SPXW  261118C05900000";

  it("scores bear call credit sent as LIMIT", () => {
    const order = {
      orderType: "LIMIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5900 } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5950 } },
      ],
    };
    const risk = schwabOrderMaxRisk(order);
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(4900);
    const gate = evaluateServerPlaceOrderGate({
      order,
      accountEquity: 30_000,
    });
    expect(gate.checks.find((c) => c.id === "size")?.level).toBe("RED");
  });

  it("scores iron condor max loss when sent as LIMIT", () => {
    const P5900 = "SPXW  261118P05900000";
    const P5895 = "SPXW  261118P05895000";
    const C5950S = "SPXW  261118C05950000";
    const C5955 = "SPXW  261118C05955000";
    const order = {
      orderType: "LIMIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: P5900 } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: P5895 } },
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5950S } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5955 } },
      ],
    };
    const risk = schwabOrderMaxRisk(order);
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(400);
  });
});