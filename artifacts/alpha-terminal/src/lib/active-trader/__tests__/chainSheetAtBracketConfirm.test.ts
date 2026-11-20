import { describe, expect, it } from "vitest";
import type { ActiveTraderTemplatePrefs } from "../activeTraderPrefs";
import { buildChainSheetAtBracketConfirm, spreadConfirmContractLine } from "../chainSheetAtBracketConfirm";

const basePrefs: ActiveTraderTemplatePrefs = {
  template: "TRG w/ bracket",
  qty: 2,
  orderType: "LIMIT",
  limitAnchor: "Mid",
  takeProfit: { enabled: true, mode: "percent", offset: 10 },
  stopLoss: { enabled: false, mode: "percent", offset: -10 },
  autoSend: { enabled: false, armed: false },
  ladderMode: "single",
  verticalWidth: 5,
  exitDuration: "GOOD_TILL_CANCEL",
  stopLossOrderType: "STOP",
  stopLimitOffset: 0.05,
};

const SYM = "SPX   261117C07545000";

describe("buildChainSheetAtBracketConfirm", () => {
  it("Sequence: one parent OPEN and one closing LIMIT child for qty 2 STO", () => {
    const result = buildChainSheetAtBracketConfirm({
      prefs: basePrefs,
      legCount: 1,
      primaryInstruction: "SELL_TO_OPEN",
      limitPrice: 3.6,
      optionSymbol: SYM,
      underlyingSymbol: "SPX",
    });
    expect(result.mode).toBe("trigger");
    if (result.mode !== "trigger") return;
    expect(result.summary.orders).toHaveLength(2);
    expect(result.summary.orders[0].positionEffect).toBe("[TO OPEN]");
    expect(result.summary.orders[0].instructionLine).toMatch(/SELL/);
    expect(result.summary.orders[0].instructionLine).toMatch(/2/);
    expect(result.summary.orders[1].positionEffect).toBe("[TO CLOSE]");
    expect(result.summary.orders[1].instructionLine).toMatch(/BUY/);
    expect(result.summary.orders[1].orderKind).toBe("LIMIT");
  });

  it("OCO: parent OPEN plus LIMIT and STOP closes", () => {
    const ocoPrefs: ActiveTraderTemplatePrefs = {
      ...basePrefs,
      template: "OCO",
      stopLoss: { enabled: true, mode: "percent", offset: -10 },
    };
    const result = buildChainSheetAtBracketConfirm({
      prefs: ocoPrefs,
      legCount: 1,
      primaryInstruction: "BUY_TO_OPEN",
      limitPrice: 4,
      optionSymbol: SYM,
      underlyingSymbol: "SPX",
    });
    expect(result.mode).toBe("trigger");
    if (result.mode !== "trigger") return;
    expect(result.summary.orders).toHaveLength(3);
    const children = result.summary.orders.filter((o) => o.orderNumber > 1);
    expect(children.filter((c) => c.positionEffect === "[TO CLOSE]")).toHaveLength(2);
    expect(children.some((c) => c.orderKind === "LIMIT")).toBe(true);
    expect(children.some((c) => c.orderKind === "STOP")).toBe(true);
  });

  it("multi-leg spread with TP only builds trigger preview", () => {
    const result = buildChainSheetAtBracketConfirm({
      prefs: basePrefs,
      legCount: 2,
      primaryInstruction: "SELL_TO_OPEN",
      limitPrice: 2,
      optionSymbol: SYM,
      underlyingSymbol: "SPX",
    });
    expect(result.mode).toBe("trigger");
    if (result.mode !== "trigger") return;
    const close = result.summary.orders.find((o) => o.positionEffect === "[TO CLOSE]");
    expect(close?.instructionLine).toMatch(/BUY/);
  });

  it("iron butterfly confirm names every strike and the ticket quantity", () => {
    const result = buildChainSheetAtBracketConfirm({
      prefs: { ...basePrefs, qty: 1 },
      legCount: 4,
      primaryInstruction: "SELL_TO_OPEN",
      limitPrice: 4.9,
      optionSymbol: "SPXW  251120C07000000",
      underlyingSymbol: "SPX",
      quantityOverride: 2,
      contractLine: spreadConfirmContractLine(
        [
          { strike: 7000, optionType: "CALL", schwabSymbol: "SPXW  251120C07000000" },
          { strike: 7005, optionType: "CALL", schwabSymbol: "SPXW  251120C07005000" },
          { strike: 7000, optionType: "PUT", schwabSymbol: "SPXW  251120P07000000" },
          { strike: 6995, optionType: "PUT", schwabSymbol: "SPXW  251120P06995000" },
        ],
        "SPX",
      ),
      contractCountForFees: 8,
    });
    expect(result.mode).toBe("trigger");
    if (result.mode !== "trigger") return;
    expect(result.quantity).toBe(2);
    expect(result.summary.orders[0].instructionLine).toContain("SPXW 7000C/7005C/7000P/6995P");
    expect(result.summary.orders[0].instructionLine).toMatch(/−2|2/);
    expect(result.summary.orders[1].instructionLine).toContain("SPXW 7000C/7005C/7000P/6995P");
  });

  it("multi-leg spread with stop loss is unsupported", () => {
    const result = buildChainSheetAtBracketConfirm({
      prefs: {
        ...basePrefs,
        stopLoss: { enabled: true, mode: "percent", offset: -10 },
      },
      legCount: 2,
      primaryInstruction: "SELL_TO_OPEN",
      limitPrice: 2,
      optionSymbol: SYM,
      underlyingSymbol: "SPX",
    });
    expect(result.mode).toBe("unsupported");
    if (result.mode === "unsupported") {
      expect(result.message).toMatch(/Stop loss/i);
    }
  });
});