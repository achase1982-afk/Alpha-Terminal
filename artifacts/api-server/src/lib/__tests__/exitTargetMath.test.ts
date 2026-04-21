import { describe, it, expect } from "vitest";
import { clampProfitTargetToMaxPayout, PROFIT_TARGET_TICK_BUFFER } from "../exitTargetMath.js";

describe("clampProfitTargetToMaxPayout", () => {
  it("clamps the SPY 705/700 bug case", () => {
    // The exact production bug: bear put spread, $1.81 debit, $5 strike width.
    // maxProfit per 1 lot = $319. Generated profit target $3.30/share.
    // Cap = (319/100) - 0.05 = 3.14. Expect clamp.
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 3.3,
      maxProfit: 319,
      isCredit: false,
    });
    expect(r.wasClamped).toBe(true);
    expect(r.clamped).toBe(3.14);
    expect(r.cap).toBe(3.14);
  });

  it("does not clamp targets that are already within max payout", () => {
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 2.5,
      maxProfit: 319,
      isCredit: false,
    });
    expect(r.wasClamped).toBe(false);
    expect(r.clamped).toBe(2.5);
  });

  it("does not clamp credit structures", () => {
    // Credit spread: max profit IS the credit collected, exit target is buyback.
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 0.4,
      maxProfit: 50,
      isCredit: true,
    });
    expect(r.wasClamped).toBe(false);
    expect(r.reason).toBe("credit_structure");
  });

  it("does not clamp unbounded-profit structures (long calls/puts sentinel)", () => {
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 50,
      maxProfit: 99999,
      isCredit: false,
    });
    expect(r.wasClamped).toBe(false);
    expect(r.reason).toBe("unbounded_max_profit");
  });

  it("respects the tick buffer exactly", () => {
    // maxProfit = $200 → per-share = $2.00 → cap = 2.00 - 0.05 = $1.95
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 1.95,
      maxProfit: 200,
      isCredit: false,
    });
    expect(r.wasClamped).toBe(false);
    expect(r.clamped).toBe(1.95);

    const over = clampProfitTargetToMaxPayout({
      profitTarget: 1.96,
      maxProfit: 200,
      isCredit: false,
    });
    expect(over.wasClamped).toBe(true);
    expect(over.clamped).toBe(1.95);
  });

  it("buffer constant is the spec value ($0.05)", () => {
    expect(PROFIT_TARGET_TICK_BUFFER).toBe(0.05);
  });

  it.each([
    // Defined-risk debit structures across the realistic range. Each row:
    // [strike_width, debit, generated_target, expected_clamped]
    [5.0, 1.81, 3.3, 3.14], // SPY bug
    [10.0, 4.5, 6.0, 5.45], // wider vertical
    [2.5, 0.9, 1.7, 1.55],  // tight vertical
    [1.0, 0.4, 0.65, 0.55], // tiny vertical
    [5.0, 4.95, 0.5, 0.0],  // pathological: nearly priced at max — cap floors at 0
  ])("strike_width=%s debit=%s target=%s → clamped=%s", (sw, debit, target, expected) => {
    const maxProfitDollar = (sw - debit) * 100;
    const r = clampProfitTargetToMaxPayout({
      profitTarget: target,
      maxProfit: maxProfitDollar,
      isCredit: false,
    });
    expect(r.clamped).toBeCloseTo(expected, 2);
  });

  it("INVARIANT: no generated target ever exceeds (strike_width - debit - buffer)", () => {
    // Sweep a reasonable solution space. For any vertical debit spread, after
    // clamping, profit_target_per_share <= strike_width - debit - 0.05.
    const widths = [1, 2.5, 5, 10, 25];
    const debits = [0.1, 0.5, 1, 2, 4];
    const wildTargets = [0.01, 0.5, 3, 10, 100, 999];
    for (const sw of widths) {
      for (const debit of debits) {
        if (debit >= sw) continue;
        const maxProfitDollar = (sw - debit) * 100;
        const ceiling = sw - debit - PROFIT_TARGET_TICK_BUFFER;
        for (const t of wildTargets) {
          const r = clampProfitTargetToMaxPayout({
            profitTarget: t,
            maxProfit: maxProfitDollar,
            isCredit: false,
          });
          // Floor at zero (when ceiling < 0 the cap clamps to 0).
          const expectedCeiling = Math.max(0, ceiling);
          expect(r.clamped).toBeLessThanOrEqual(expectedCeiling + 1e-9);
        }
      }
    }
  });
});
