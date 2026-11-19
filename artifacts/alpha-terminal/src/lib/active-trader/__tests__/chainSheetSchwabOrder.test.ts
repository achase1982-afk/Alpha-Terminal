import { describe, expect, it } from "vitest";
import { buildChainSheetSchwabOrder } from "../chainSheetSchwabOrder";
import type { ActiveTraderTemplatePrefs } from "../activeTraderPrefs";

const prefs = (): ActiveTraderTemplatePrefs => ({
  template: "TRG w/ bracket",
  qty: 1,
  orderType: "LIMIT",
  limitAnchor: "Mid",
  takeProfit: { enabled: true, mode: "percent", offset: 25 },
  stopLoss: { enabled: false, mode: "percent", offset: -10 },
  autoSend: { enabled: false, armed: false },
  ladderMode: "single",
  verticalWidth: 5,
  exitDuration: "GOOD_TILL_CANCEL",
  stopLossOrderType: "STOP",
  stopLimitOffset: 0.05,
});

const verticalCreditLegs = [
  {
    direction: "SELL_TO_OPEN" as const,
    quantity: 1,
    schwabSymbol: "SPY   261219C00600000",
    expiration: "2026-12-19",
  },
  {
    direction: "BUY_TO_OPEN" as const,
    quantity: 1,
    schwabSymbol: "SPY   261219C00605000",
    expiration: "2026-12-19",
  },
];

describe("buildChainSheetSchwabOrder", () => {
  it("credit vertical with 25% TP: TRIGGER parent + NET_DEBIT child at $1.50 with both closes", () => {
    const order = buildChainSheetSchwabOrder({
      prefs: prefs(),
      primaryInstruction: "SELL_TO_OPEN",
      legs: verticalCreditLegs,
      quantityMultiplier: 1,
      limitPrice: 2,
      isCredit: true,
      complexOrderStrategyType: "VERTICAL",
      underlyingSymbol: "SPY",
      timeInForce: "DAY",
    });
    expect(order.error).toBeUndefined();
    expect(order.orderStrategyType).toBe("TRIGGER");
    expect(order.orderType).toBe("NET_CREDIT");
    expect(order.price).toBe(2);
    const entryLegs = order.orderLegCollection as { instruction: string }[];
    expect(entryLegs.map((l) => l.instruction)).toEqual(["SELL_TO_OPEN", "BUY_TO_OPEN"]);

    const children = order.childOrderStrategies as Record<string, unknown>[];
    expect(children).toHaveLength(1);
    const child = children[0]!;
    expect(child.orderType).toBe("NET_DEBIT");
    expect(child.price).toBe(1.5);
    const closeLegs = child.orderLegCollection as { instruction: string }[];
    expect(closeLegs.map((l) => l.instruction)).toEqual(["BUY_TO_CLOSE", "SELL_TO_CLOSE"]);
  });

  it("single-leg SL only: TRIGGER + STOP child at $1.80 (BTO @ $2, 10% SL)", () => {
    const slPrefs: ActiveTraderTemplatePrefs = {
      ...prefs(),
      takeProfit: { enabled: false, mode: "percent", offset: 25 },
      stopLoss: { enabled: true, mode: "percent", offset: -10 },
    };
    const order = buildChainSheetSchwabOrder({
      prefs: slPrefs,
      primaryInstruction: "BUY_TO_OPEN",
      legs: [
        {
          direction: "BUY_TO_OPEN",
          quantity: 1,
          schwabSymbol: "SPY   261219C00600000",
          expiration: "2026-12-19",
        },
      ],
      quantityMultiplier: 1,
      limitPrice: 2,
      isCredit: false,
      complexOrderStrategyType: "NONE",
      underlyingSymbol: "SPY",
      timeInForce: "DAY",
    });
    expect(order.error).toBeUndefined();
    expect(order.orderStrategyType).toBe("TRIGGER");
    expect(order.price).toBe(2);
    const child = (order.childOrderStrategies as Record<string, unknown>[])[0]!;
    expect(child.orderType).toBe("STOP");
    expect(child.stopPrice).toBe(1.8);
    const closeLegs = child.orderLegCollection as { instruction: string }[];
    expect(closeLegs.map((l) => l.instruction)).toEqual(["SELL_TO_CLOSE"]);
  });

  it("returns SINGLE when bracket inactive", () => {
    const order = buildChainSheetSchwabOrder({
      legs: verticalCreditLegs,
      quantityMultiplier: 1,
      limitPrice: 2,
      isCredit: true,
      complexOrderStrategyType: "VERTICAL",
      underlyingSymbol: "SPY",
      timeInForce: "DAY",
    });
    expect(order.orderStrategyType).toBe("SINGLE");
    expect(order.childOrderStrategies).toBeUndefined();
  });
});
