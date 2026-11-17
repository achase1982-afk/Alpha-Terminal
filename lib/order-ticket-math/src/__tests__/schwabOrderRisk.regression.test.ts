import { describe, expect, it } from "vitest";
import {
  evaluateServerPlaceOrderGate,
  DEFAULT_SERVER_PRE_TRADE,
} from "../serverPlaceOrderGate.js";
import { schwabOrderMaxRisk } from "../schwabOrderRisk.js";

const OPT = "AAPL  250117C00200000";

describe("GCD spread-count regressions", () => {
  it("scores stock BUY notional from full share quantity", () => {
    const order = {
      orderType: "LIMIT",
      price: 200,
      orderLegCollection: [
        { instruction: "BUY", quantity: 1000, instrument: { assetType: "EQUITY", symbol: "AAPL" } },
      ],
    };
    const risk = schwabOrderMaxRisk(order);
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(200_000);
    const gate = evaluateServerPlaceOrderGate({
      order,
      accountEquity: 30_000,
      settings: DEFAULT_SERVER_PRE_TRADE,
    });
    expect(gate.checks.find((c) => c.id === "size")?.level).toBe("RED");
  });

  it("scores 20 shares at 175 as $3,500", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 175,
      orderLegCollection: [
        { instruction: "BUY", quantity: 20, instrument: { assetType: "EQUITY", symbol: "AAPL" } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(3500);
  });

  it("scores long single-leg LIMIT debit without WARN", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 5,
      orderLegCollection: [
        { instruction: "BUY_TO_OPEN", quantity: 10, instrument: { assetType: "OPTION", symbol: OPT } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(5000);
  });

  it("keeps naked single-leg SELL_TO_OPEN as unknown", () => {
    expect(
      schwabOrderMaxRisk({
        orderType: "LIMIT",
        price: 5,
        orderLegCollection: [
          { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: OPT } },
        ],
      }).kind,
    ).toBe("unknown");
  });
});
