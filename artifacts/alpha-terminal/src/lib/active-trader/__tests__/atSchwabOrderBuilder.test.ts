import { describe, expect, it } from "vitest";
import { buildAtSettingsSummary } from "../atSummaryFormat";
import type { ActiveTraderTemplatePrefs } from "../activeTraderPrefs";
import {
  atBracketLegPreviewPrice,
  atBracketPreviewPrices,
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

  it("preview legs match builder JSON when raw mid rounds to 16 (TP 17.60)", () => {
    const input = {
      ...base,
      template: "TRG w/ bracket" as const,
      limitPrice: 15.96,
      takeProfit: { enabled: true, mode: "percent" as const, offset: 10 },
      stopLoss: { enabled: false, mode: "percent" as const, offset: -10 },
    };
    const { legs } = planAtOrderLegs(input);
    expect(legs[0].price).toBe(16);
    expect(legs[1].price).toBe(17.6);
    const json = buildAtSchwabOrderJson(input);
    const child = (json.childOrderStrategies as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(child.price).toBe(legs[1].price);
  });

  it("SPX mid 15.95: bracket @ preview, summary, leg plan, and JSON agree (16.00 / 17.60)", () => {
    const limitMid = 15.95;
    const input = {
      ...base,
      template: "TRG w/ bracket" as const,
      limitPrice: limitMid,
      takeProfit: { enabled: true, mode: "percent" as const, offset: 10 },
      stopLoss: { enabled: false, mode: "percent" as const, offset: -10 },
    };
    const { legs } = planAtOrderLegs(input);
    const built = buildAtSchwabOrderJson(input);
    const child = built.childOrderStrategies as Record<string, unknown>[];
    const tpJson = (child[0] as Record<string, unknown>).price as number;

    const tpBracket = atBracketLegPreviewPrice(input, "takeProfit");
    const preview = atBracketPreviewPrices(input);

    const prefs: ActiveTraderTemplatePrefs = {
      template: "TRG w/ bracket",
      qty: 1,
      orderType: "LIMIT",
      limitAnchor: "Mid",
      takeProfit: input.takeProfit,
      stopLoss: input.stopLoss,
      autoSend: { enabled: false, armed: false },
      ladderMode: "single",
      verticalWidth: 5,
      exitDuration: "GOOD_TILL_CANCEL",
      stopLossOrderType: "STOP",
      stopLimitOffset: 0.05,
    };
    const summary = buildAtSettingsSummary(prefs, limitMid, "BUY_TO_OPEN", undefined, "SPX");

    expect(legs[0].price).toBe(16);
    expect(legs[1].price).toBe(17.6);
    expect(tpJson).toBe(17.6);
    expect(tpBracket).toBe(17.6);
    expect(preview.entryLimit).toBe(16);
    expect(preview.takeProfit).toBe(17.6);
    expect(summary).toContain("TP 17.60");
    expect(summary).not.toMatch(/TP 17\.5[^0]/);
  });

  it("confirm-style preview prices match built JSON child limits", () => {
    const input = {
      ...base,
      template: "TRG w/ bracket" as const,
      limitPrice: 15.95,
      takeProfit: { enabled: true, mode: "percent" as const, offset: 10 },
      stopLoss: { enabled: true, mode: "percent" as const, offset: -10 },
    };
    const preview = atBracketPreviewPrices(input);
    const built = buildAtSchwabOrderJson(input);
    const oco = (built.childOrderStrategies as Record<string, unknown>[])[0];
    const singles = oco.childOrderStrategies as Record<string, unknown>[];
    const tpChild = singles.find((s) => s.orderType === "LIMIT")!;
    const slChild = singles.find((s) => s.orderType === "STOP" || s.orderType === "STOP_LIMIT")!;
    expect(preview.takeProfit).toBe(tpChild.price);
    expect(preview.stopLoss).toBe(slChild.stopPrice ?? slChild.price);
    expect(preview.entryLimit).toBe((built as { price: number }).price);
  });

  it("SPY penny tick: preview and JSON keep 0.01 increments", () => {
    const input = {
      assetType: "OPTION" as const,
      symbol: "SPY   261117C00450000",
      underlyingSymbol: "SPY",
      primaryInstruction: "BUY_TO_OPEN" as const,
      quantity: 1,
      limitPrice: 1.054,
      template: "TRG w/ bracket" as const,
      takeProfit: { enabled: true, mode: "percent" as const, offset: 10 },
      stopLoss: { enabled: false, mode: "percent" as const, offset: -10 },
    };
    const { legs } = planAtOrderLegs(input);
    const tpBracket = atBracketLegPreviewPrice(input, "takeProfit");
    const built = buildAtSchwabOrderJson(input);
    const child = (built.childOrderStrategies as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(legs[0].price).toBe(1.05);
    expect(legs[1].price).toBe(1.16);
    expect(tpBracket).toBe(legs[1].price);
    expect(child.price).toBe(legs[1].price);
  });

  it("canonical entry 16.00 with TP +10% yields 17.60 in plan and JSON", () => {
    const input = {
      ...base,
      template: "TRG w/ bracket" as const,
      limitPrice: 16,
      takeProfit: { enabled: true, mode: "percent" as const, offset: 10 },
      stopLoss: { enabled: false, mode: "percent" as const, offset: -10 },
    };
    const planned = planAtOrderLegs(input);
    expect(planned.legs[1].price).toBe(17.6);
    const built = buildAtSchwabOrderJson(input);
    const child = (built.childOrderStrategies as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(child.price).toBe(17.6);
    expect(child.price).toBe(planned.legs[1].price);
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