import { describe, expect, it } from "vitest";
import {
  buildAtSchwabOrderJson,
  closingInstructionForOpen,
  planAtOrderLegs,
  validateAtChildLegs,
} from "../atSchwabOrderBuilder";

describe("closingInstructionForOpen", () => {
  it("pairs option opens with closes", () => {
    expect(closingInstructionForOpen("BUY_TO_OPEN")).toBe("SELL_TO_CLOSE");
    expect(closingInstructionForOpen("SELL_TO_OPEN")).toBe("BUY_TO_CLOSE");
  });
  it("pairs stock opens with closes", () => {
    expect(closingInstructionForOpen("BUY")).toBe("SELL");
    expect(closingInstructionForOpen("SELL_SHORT")).toBe("BUY_TO_COVER");
  });
});

describe("validateAtChildLegs", () => {
  it("rejects a second opening leg on the same contract", () => {
    const err = validateAtChildLegs("OCO", "BUY_TO_OPEN", ["BUY_TO_OPEN"]);
    expect(err).toMatch(/opening instruction/i);
  });
});

describe("buildAtSchwabOrderJson", () => {
  const base = {
    assetType: "OPTION" as const,
    symbol: "SPX   261117C07545000",
    underlyingSymbol: "SPX",
    primaryInstruction: "BUY_TO_OPEN" as const,
    quantity: 1,
    limitPrice: 3.6,
    entryDuration: "DAY" as const,
    exitDuration: "GOOD_TILL_CANCEL" as const,
  };

  it("single leg uses SINGLE + complexOrderStrategyType NONE", () => {
    const o = buildAtSchwabOrderJson({ ...base, template: "Single" });
    expect(o.orderStrategyType).toBe("SINGLE");
    expect(o.complexOrderStrategyType).toBe("NONE");
    expect((o.orderLegCollection as { instruction: string }[])[0].instruction).toBe("BUY_TO_OPEN");
    expect(o.duration).toBe("DAY");
  });

  it("TP-enabled uses TRIGGER; child GTC while entry DAY", () => {
    const o = buildAtSchwabOrderJson({
      ...base,
      template: "TRG w/ bracket",
      takeProfit: { enabled: true, mode: "percent", offset: 25 },
    });
    expect(o.orderStrategyType).toBe("TRIGGER");
    expect(o.duration).toBe("DAY");
    const child = o.childOrderStrategies as Record<string, unknown>[];
    expect(child).toHaveLength(1);
    expect(child[0].duration).toBe("GOOD_TILL_CANCEL");
    expect(child[0].orderStrategyType).toBe("SINGLE");
    expect(child[0].complexOrderStrategyType).toBe("NONE");
    const legs = child[0].orderLegCollection as { instruction: string }[];
    expect(legs[0].instruction).toBe("SELL_TO_CLOSE");
    expect(child[0].orderType).toBe("LIMIT");
  });

  it("TP+SL uses TRIGGER with nested OCO children", () => {
    const o = buildAtSchwabOrderJson({
      ...base,
      template: "TRG w/ bracket",
      takeProfit: { enabled: true, mode: "percent", offset: 10 },
      stopLoss: { enabled: true, mode: "percent", offset: -10 },
    });
    expect(o.orderStrategyType).toBe("TRIGGER");
    const oco = (o.childOrderStrategies as Record<string, unknown>[])[0];
    expect(oco.orderStrategyType).toBe("OCO");
    const singles = oco.childOrderStrategies as Record<string, unknown>[];
    expect(singles).toHaveLength(2);
    expect(singles[0].orderType).toBe("LIMIT");
    expect(singles[1].orderType).toBe("STOP");
    expect(singles[0].duration).toBe("GOOD_TILL_CANCEL");
    expect(singles[1].duration).toBe("GOOD_TILL_CANCEL");
  });

  it("STOP_LIMIT child includes stopPrice and limit price", () => {
    const o = buildAtSchwabOrderJson({
      ...base,
      template: "TRG w/ bracket",
      takeProfit: { enabled: true, mode: "percent", offset: 10 },
      stopLoss: { enabled: true, mode: "percent", offset: -10 },
      stopLossOrderType: "STOP_LIMIT",
      stopLimitOffset: 0.1,
    });
    const oco = (o.childOrderStrategies as Record<string, unknown>[])[0];
    const singles = oco.childOrderStrategies as Record<string, unknown>[];
    const sl = singles.find((s) => s.orderType === "STOP_LIMIT");
    expect(sl).toBeTruthy();
    expect(sl!.stopPrice).toBe(3.2);
    expect(sl!.price).toBeLessThan(sl!.stopPrice as number);
  });

  it("bracket template without TP/SL flags is blocked", () => {
    const planned = planAtOrderLegs({
      ...base,
      template: "TRG w/ bracket",
      takeProfit: { enabled: false, mode: "percent", offset: 10 },
      stopLoss: { enabled: false, mode: "percent", offset: -10 },
    });
    expect(planned.validationError).toMatch(/at least one exit leg/i);
    const built = buildAtSchwabOrderJson({
      ...base,
      template: "TRG w/ bracket",
      takeProfit: { enabled: false, mode: "percent", offset: 10 },
      stopLoss: { enabled: false, mode: "percent", offset: -10 },
    });
    expect(built.error).toMatch(/at least one exit leg/i);
  });

  it("spread rejects STOP child", () => {
    const built = buildAtSchwabOrderJson({
      ...base,
      template: "TRG w/ bracket",
      isSpread: true,
      takeProfit: { enabled: true, mode: "percent", offset: 10 },
      stopLoss: { enabled: true, mode: "percent", offset: -10 },
    });
    expect(built.error).toMatch(/multi-leg spreads/i);
  });

  it("spread with TP only builds TRIGGER without STOP", () => {
    const o = buildAtSchwabOrderJson({
      ...base,
      template: "TRG w/ bracket",
      isSpread: true,
      takeProfit: { enabled: true, mode: "percent", offset: 10 },
      stopLoss: { enabled: false, mode: "percent", offset: -10 },
    });
    expect(o.orderStrategyType).toBe("TRIGGER");
    const child = (o.childOrderStrategies as Record<string, unknown>[])[0];
    expect(child.orderStrategyType).toBe("SINGLE");
    expect(child.orderType).toBe("LIMIT");
  });

  it("plan lists human leg roles for TP-only and full bracket", () => {
    const tpOnly = planAtOrderLegs({
      ...base,
      template: "TRG w/ bracket",
      takeProfit: { enabled: true, mode: "percent", offset: 10 },
      stopLoss: { enabled: false, mode: "percent", offset: -10 },
    });
    expect(tpOnly.legs.map((l) => l.role)).toEqual(["1st", "2nd"]);
    expect(tpOnly.legs[1].price).toBe(4);

    const both = planAtOrderLegs({
      ...base,
      template: "TRG w/ bracket",
      takeProfit: { enabled: true, mode: "percent", offset: 10 },
      stopLoss: { enabled: true, mode: "percent", offset: -10 },
    });
    expect(both.legs.map((l) => l.role)).toEqual(["1st", "2nd", "3rd"]);
    expect(both.legs[0].label).toBe("Buy to open");
    expect(both.legs[1].label).toBe("Sell to close");
  });

  it("short STO bracket uses BTC on child legs", () => {
    const o = buildAtSchwabOrderJson({
      ...base,
      primaryInstruction: "SELL_TO_OPEN",
      template: "TRG w/ bracket",
      takeProfit: { enabled: true, mode: "points", offset: 0.5 },
      stopLoss: { enabled: true, mode: "points", offset: -0.5 },
    });
    const oco = (o.childOrderStrategies as Record<string, unknown>[])[0];
    expect(oco.orderStrategyType).toBe("OCO");
    const singles = oco.childOrderStrategies as Record<string, unknown>[];
    const legA = (singles[0].orderLegCollection as { instruction: string }[])[0];
    const legB = (singles[1].orderLegCollection as { instruction: string }[])[0];
    expect(legA.instruction).toBe("BUY_TO_CLOSE");
    expect(legB.instruction).toBe("BUY_TO_CLOSE");
  });
});