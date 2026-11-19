import { describe, expect, it } from "vitest";
import type { StrategyLeg } from "@/components/StrategyBuilder";
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

const verticalCreditLegs: StrategyLeg[] = [
  {
    id: "a",
    optionType: "CALL",
    direction: "SELL_TO_OPEN",
    strike: 600,
    expiration: "2026-12-19",
    quantity: 1,
    bid: 2.85,
    ask: 2.92,
    schwabSymbol: "SPY   261219C00600000",
  },
  {
    id: "b",
    optionType: "CALL",
    direction: "BUY_TO_OPEN",
    strike: 605,
    expiration: "2026-12-19",
    quantity: 1,
    bid: 1.1,
    ask: 1.15,
    schwabSymbol: "SPY   261219C00605000",
  },
];

describe("buildChainSheetSchwabOrder", () => {
  it("credit vertical with 25% TP: TRIGGER parent + NET_DEBIT child at $1.50 with both closes", () => {
    const order = buildChainSheetSchwabOrder(
      {
        symbol: "SPY",
        legs: verticalCreditLegs,
        spreadQuantity: 1,
        limitPrice: "2.00",
        limitTickCtx: { underlyingSymbol: "SPY", isOption: true },
        timeInForce: "DAY",
        isCredit: true,
        entryGrossDollars: 200,
        distinctLegCount: 2,
        atBracketDraft: {
          prefs: prefs(),
          primaryInstruction: "SELL_TO_OPEN",
        },
      },
      2,
    );
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
    const longLeg: StrategyLeg = {
      id: "a",
      optionType: "CALL",
      direction: "BUY_TO_OPEN",
      strike: 600,
      expiration: "2026-12-19",
      quantity: 1,
      bid: 1.95,
      ask: 2.05,
      schwabSymbol: "SPY   261219C00600000",
    };
    const order = buildChainSheetSchwabOrder(
      {
        symbol: "SPY",
        legs: [longLeg],
        spreadQuantity: 1,
        limitPrice: "2.00",
        limitTickCtx: { underlyingSymbol: "SPY", isOption: true },
        timeInForce: "DAY",
        isCredit: false,
        entryGrossDollars: -200,
        distinctLegCount: 1,
        atBracketDraft: {
          prefs: slPrefs,
          primaryInstruction: "BUY_TO_OPEN",
        },
      },
      2,
    );
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
    const order = buildChainSheetSchwabOrder(
      {
        symbol: "SPY",
        legs: verticalCreditLegs,
        spreadQuantity: 1,
        limitPrice: "2.00",
        limitTickCtx: { underlyingSymbol: "SPY", isOption: true },
        timeInForce: "DAY",
        isCredit: true,
        entryGrossDollars: 200,
        distinctLegCount: 2,
        atBracketDraft: null,
      },
      2,
    );
    expect(order.orderStrategyType).toBe("SINGLE");
    expect(order.childOrderStrategies).toBeUndefined();
  });
});