import { describe, expect, it } from "vitest";
import { computeOrderEconomics } from "../orderEconomics.js";
import { cashSecuredPutCollateral, resolveBuyingPowerEffect } from "../buyingPowerEffect.js";

const spx = { underlyingSymbol: "SPX", isOption: true as const };

describe("buyingPowerEffect", () => {
  it("naked short call credit: BP not estimated", () => {
    const e = computeOrderEconomics({
      ...spx,
      legs: [{ strike: 6000, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1 }],
      limitPrice: 2,
      quantity: 1,
      isCredit: true,
    });
    expect(e?.buyingPowerEffect).toBeNull();
    expect(e?.buyingPowerEffectKind).toBe("not_estimated");
  });

  it("cash-secured short put uses collateral label path", () => {
    const legs = [{ strike: 400, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1 }];
    const r = resolveBuyingPowerEffect({
      legs,
      isCredit: true,
      isOption: true,
      maxRisk: null,
      grossNotional: 200,
      commissionTotal: 0.65,
      netPerShare: 2,
      spreadUnits: 1,
    });
    expect(r.buyingPowerEffectKind).toBe("cash_secured");
    expect(r.buyingPowerEffect).toBe(-cashSecuredPutCollateral(legs[0], 1, 2));
  });

  it("closing sell: no BP row", () => {
    const e = computeOrderEconomics({
      ...spx,
      legs: [{ strike: 600, optionType: "CALL", instruction: "SELL_TO_CLOSE", quantity: 1 }],
      limitPrice: 3,
      quantity: 1,
      isCredit: true,
      closesPosition: true,
    });
    expect(e?.buyingPowerEffect).toBeNull();
    expect(e?.buyingPowerEffectKind).toBe("none");
    expect(e?.netCashFlow).toBeGreaterThan(0);
  });
});