import { describe, expect, it } from "vitest";
import {
  evaluateServerPlaceOrderGate,
  DEFAULT_SERVER_PRE_TRADE,
} from "../serverPlaceOrderGate.js";
import {
  inferNetCreditFromLegStructure,
  schwabOrderHasUncoveredShortRisk,
  schwabOrderMaxRisk,
  schwabOrderToEconomicsInput,
} from "../schwabOrderRisk.js";

const C5950 = "SPXW  261118C05950000";
const C5945 = "SPXW  261118C05945000";
const C6000 = "SPXW  261118C06000000";
const C5950B = "SPXW  261118C05950000";
const C5900 = "SPXW  261118C05900000";
const P5900 = "SPXW  261118P05900000";
const P5895 = "SPXW  261118P05895000";
const C5950S = "SPXW  261118C05950000";
const C5955 = "SPXW  261118C05955000";

describe("inferNetCreditFromLegStructure", () => {
  it("marks bull call debit and bear call credit", () => {
    expect(
      inferNetCreditFromLegStructure([
        { strike: 200, optionType: "CALL", instruction: "BUY_TO_OPEN" },
        { strike: 210, optionType: "CALL", instruction: "SELL_TO_OPEN" },
      ]),
    ).toBe(false);
    expect(
      inferNetCreditFromLegStructure([
        { strike: 200, optionType: "CALL", instruction: "SELL_TO_OPEN" },
        { strike: 210, optionType: "CALL", instruction: "BUY_TO_OPEN" },
      ]),
    ).toBe(true);
  });
});

describe("schwabOrderMaxRisk", () => {
  it("scores 1-lot 5-wide credit at 1.00 as $400 max loss", () => {
    const r = schwabOrderMaxRisk({
      orderType: "NET_CREDIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5950 } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5945 } },
      ],
    });
    expect(r.kind).toBe("known");
    if (r.kind === "known") expect(r.maxRisk).toBe(400);
  });

  it("scores 10-lot 50-wide credit at 1.00 as $49,000 max loss", () => {
    const r = schwabOrderMaxRisk({
      orderType: "NET_CREDIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 10, instrument: { assetType: "OPTION", symbol: C5950B } },
        { instruction: "BUY_TO_OPEN", quantity: 10, instrument: { assetType: "OPTION", symbol: C5900 } },
      ],
    });
    expect(r.kind).toBe("known");
    if (r.kind === "known") expect(r.maxRisk).toBe(49_000);
  });

  it("scores iron condor max loss from widest wing", () => {
    const r = schwabOrderMaxRisk({
      orderType: "NET_CREDIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: P5900 } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: P5895 } },
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5950S } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5955 } },
      ],
    });
    expect(r.kind).toBe("known");
    if (r.kind === "known") expect(r.maxRisk).toBe(400);
  });

  it("treats short strangle as unknown (warn) risk", () => {
    expect(
      schwabOrderHasUncoveredShortRisk({
        orderLegCollection: [
          { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5950 } },
          { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: P5900 } },
        ],
      }),
    ).toBe(true);
    expect(schwabOrderMaxRisk({
      orderType: "NET_CREDIT",
      price: 2,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5950 } },
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: P5900 } },
      ],
    }).kind).toBe("unknown");
  });

  it("FAILs 1-lot 5-wide vs $10k @ 3% on ticket; server catastrophe uses 10% floor", () => {
    const order = {
      orderType: "NET_CREDIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5950 } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: C5945 } },
      ],
    };
    const risk = schwabOrderMaxRisk(order);
    expect(schwabOrderToEconomicsInput(order)).not.toBeNull();
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") {
      const ticketMax = 10_000 * 0.03;
      expect(risk.maxRisk).toBe(400);
      expect(risk.maxRisk).toBeGreaterThan(ticketMax);
    }
    const serverGate = evaluateServerPlaceOrderGate({
      order,
      accountEquity: 10_000,
      settings: DEFAULT_SERVER_PRE_TRADE,
    });
    expect(serverGate.reject).toBe(false);
    expect(serverGate.checks.find((c) => c.id === "size")?.level).toBe("GREEN");
  });
});
