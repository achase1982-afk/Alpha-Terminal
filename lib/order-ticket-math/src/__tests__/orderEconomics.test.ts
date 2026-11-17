import { describe, expect, it } from "vitest";
import { computeOrderEconomics } from "../orderEconomics.js";

const spx = { underlyingSymbol: "SPX", isOption: true as const };

describe("computeOrderEconomics", () => {
  it("uses tick-rounded limit for single-leg debit (3.78 → $378 max risk)", () => {
    const econ = computeOrderEconomics({
      ...spx,
      legs: [{ strike: 350, optionType: "CALL", instruction: "BUY_TO_OPEN" }],
      limitPrice: "3.78",
      fallbackNetPrice: 3.775,
      quantity: 1,
      isCredit: false,
    });
    expect(econ).not.toBeNull();
    expect(econ!.netPricePerShare).toBe(3.8);
    expect(econ!.grossNotional).toBe(380);
    expect(econ!.maxRisk).toBe(380);
  });

  it("matches gross and max risk after user edit to odd-cent limit", () => {
    const econ = computeOrderEconomics({
      ...spx,
      legs: [{ strike: 350, optionType: "CALL", instruction: "BUY_TO_OPEN" }],
      limitPrice: "3.80",
      quantity: 2,
      isCredit: false,
    });
    expect(econ!.grossNotional).toBe(760);
    expect(econ!.maxRisk).toBe(760);
    expect(econ!.commissionTotal).toBe(1.3);
    expect(econ!.totalCostInclFees).toBe(761.3);
  });

  it("net debit vertical uses width minus tick-rounded net", () => {
    const econ = computeOrderEconomics({
      ...spx,
      legs: [
        { strike: 350, optionType: "CALL", instruction: "BUY_TO_OPEN" },
        { strike: 355, optionType: "CALL", instruction: "SELL_TO_OPEN" },
      ],
      limitPrice: "1.23",
      quantity: 1,
      isCredit: false,
    });
    expect(econ!.netPricePerShare).toBe(1.25);
    expect(econ!.maxRisk).toBe(125);
    expect(econ!.maxProfit).toBe(375);
  });

  it("labels pre-fee vs post-fee totals for credits", () => {
    const econ = computeOrderEconomics({
      ...spx,
      legs: [
        { strike: 350, optionType: "CALL", instruction: "SELL_TO_OPEN" },
        { strike: 355, optionType: "CALL", instruction: "BUY_TO_OPEN" },
      ],
      limitPrice: "1.05",
      quantity: 1,
      isCredit: true,
      contractCount: 2,
    });
    expect(econ!.grossNotional).toBe(105);
    expect(econ!.totalCreditAfterFees).toBe(103.7);
  });

  it("charges no commission on stock tickets", () => {
    const econ = computeOrderEconomics({
      underlyingSymbol: "AAPL",
      isOption: false,
      limitPrice: "100",
      quantity: 10,
      isCredit: false,
    });
    expect(econ!.commissionTotal).toBe(0);
  });
});