import { describe, expect, it } from "vitest";
import { buildChainSheetBracketEconomics } from "../chainSheetBracketEconomics";
import type { ActiveTraderTemplatePrefs } from "../activeTraderPrefs";

const basePrefs = (): ActiveTraderTemplatePrefs => ({
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

describe("buildChainSheetBracketEconomics", () => {
  it("credit vertical locked $2.00 with 25% TP: $150 target, ~$50 gross less fees", () => {
    const econ = buildChainSheetBracketEconomics({
      prefs: basePrefs(),
      primaryInstruction: "SELL_TO_OPEN",
      lockedLimit: 2,
      legCount: 2,
      optionSymbol: "SPX   261118C06000000",
      underlyingSymbol: "SPX",
      spreadQuantity: 1,
      totalContracts: 2,
      entryGrossDollars: 200,
      isCredit: true,
    });
    expect(econ.takeProfitLimit).toBe(1.5);
    expect(econ.targetExitDollars).toBe(150);
    expect(econ.bracketConfirm.mode).toBe("trigger");
    expect(econ.estNetUnavailable).toBe(false);
    expect(econ.estNetProfit).not.toBeNull();
    const gross = 200 - 150;
    expect(gross).toBe(50);
    expect(econ.estNetProfit!).toBeLessThan(50);
    expect(econ.estNetProfit!).toBeGreaterThan(45);
  });

  it("fails closed when TP enabled but bracket cannot be built", () => {
    const econ = buildChainSheetBracketEconomics({
      prefs: {
        ...basePrefs(),
        stopLoss: { enabled: true, mode: "percent", offset: -10 },
      },
      primaryInstruction: "SELL_TO_OPEN",
      lockedLimit: 2,
      legCount: 2,
      optionSymbol: "SPX   261118C06000000",
      underlyingSymbol: "SPX",
      spreadQuantity: 1,
      totalContracts: 2,
      entryGrossDollars: 200,
      isCredit: true,
    });
    expect(econ.bracketConfirm.mode).toBe("unsupported");
    expect(econ.estNetUnavailable).toBe(true);
    expect(econ.estNetProfit).toBeNull();
  });

  it("does not treat missing entry gross as profit", () => {
    const econ = buildChainSheetBracketEconomics({
      prefs: basePrefs(),
      primaryInstruction: "SELL_TO_OPEN",
      lockedLimit: 2,
      legCount: 1,
      optionSymbol: "SPX   261118C06000000",
      underlyingSymbol: "SPX",
      spreadQuantity: 1,
      totalContracts: 1,
      entryGrossDollars: null,
      isCredit: true,
    });
    expect(econ.estNetUnavailable).toBe(true);
    expect(econ.estNetProfit).toBeNull();
    expect(econ.targetExitDollars).toBe(150);
  });
});