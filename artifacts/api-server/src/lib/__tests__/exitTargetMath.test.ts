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

  it("clamps a bear call credit spread when target exceeds credit collected", () => {
    // Sell 100C / Buy 105C for $1.50 credit. maxProfit = $150/lot.
    // AI hallucinates target $2.00/share — impossible (can't profit more than
    // the credit collected). Expect clamp to (1.50 - 0.05) = 1.45.
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 2.0,
      maxProfit: 150,
      isCredit: true,
    });
    expect(r.wasClamped).toBe(true);
    expect(r.clamped).toBe(1.45);
  });

  it("clamps a bull put credit spread when target exceeds credit collected", () => {
    // Sell 95P / Buy 90P for $0.40 credit. maxProfit = $40/lot.
    // AI hallucinates target $1.50/share — impossible. Expect clamp to $0.35.
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 1.5,
      maxProfit: 40,
      isCredit: true,
    });
    expect(r.wasClamped).toBe(true);
    expect(r.clamped).toBe(0.35);
  });

  it("does NOT clamp a credit-spread closing-debit target that is sensible", () => {
    // $1.50 credit collected. Closing-debit target of $0.30 → captures $1.20
    // profit/share, well under the cap.
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 0.3,
      maxProfit: 150,
      isCredit: true,
    });
    expect(r.wasClamped).toBe(false);
    expect(r.clamped).toBe(0.3);
  });

  it("clamps an iron condor when target exceeds total net credit", () => {
    // Iron condor collecting $2.40 net credit. maxProfit = $240/lot.
    // AI hallucinates target $5.00 — impossible. Expect clamp to $2.35.
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 5.0,
      maxProfit: 240,
      isCredit: true,
    });
    expect(r.wasClamped).toBe(true);
    expect(r.clamped).toBe(2.35);
  });

  it("clamps an iron butterfly when target exceeds net credit", () => {
    // Iron fly collecting $3.20 net credit. maxProfit = $320/lot.
    // AI hallucinates target $4.50 — impossible. Expect clamp to $3.15.
    const r = clampProfitTargetToMaxPayout({
      profitTarget: 4.5,
      maxProfit: 320,
      isCredit: true,
    });
    expect(r.wasClamped).toBe(true);
    expect(r.clamped).toBe(3.15);
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

  it("INVARIANT: no generated target ever exceeds maxProfit/100 - buffer (debit + credit)", () => {
    // Sweep across structure types. The clamp is structure-agnostic — it
    // depends only on maxProfit. The structures below cover:
    //   - debit verticals (bull call / bear put)
    //   - credit verticals (bear call / bull put)
    //   - iron condors / iron butterflies (4-leg credits)
    // parametrized by the resulting maxProfit dollar per 1 lot. We feed wildly
    // implausible targets and assert the clamp ceiling holds in every case.
    const structures: Array<{ name: string; maxProfitDollar: number; isCredit: boolean }> = [
      // Debit verticals: maxProfit = (width − debit) × 100
      { name: "bull_call_debit_5x1.81",    maxProfitDollar: (5 - 1.81) * 100, isCredit: false },
      { name: "bear_put_debit_5x1.81",     maxProfitDollar: (5 - 1.81) * 100, isCredit: false },
      { name: "bull_call_debit_10x4.5",    maxProfitDollar: (10 - 4.5) * 100, isCredit: false },
      { name: "bear_put_debit_2.5x0.9",    maxProfitDollar: (2.5 - 0.9) * 100, isCredit: false },
      { name: "bull_call_debit_25x2",      maxProfitDollar: (25 - 2) * 100, isCredit: false },
      // Credit verticals: maxProfit = credit_collected × 100
      { name: "bear_call_credit_1.50",     maxProfitDollar: 1.5 * 100, isCredit: true },
      { name: "bull_put_credit_0.40",      maxProfitDollar: 0.4 * 100, isCredit: true },
      { name: "bear_call_credit_2.20",     maxProfitDollar: 2.2 * 100, isCredit: true },
      { name: "bull_put_credit_3.10",      maxProfitDollar: 3.1 * 100, isCredit: true },
      // Iron condor / iron butterfly: maxProfit = total_net_credit × 100
      { name: "iron_condor_2.40",          maxProfitDollar: 2.4 * 100, isCredit: true },
      { name: "iron_condor_0.85",          maxProfitDollar: 0.85 * 100, isCredit: true },
      { name: "iron_fly_3.20",             maxProfitDollar: 3.2 * 100, isCredit: true },
      { name: "iron_fly_5.50",             maxProfitDollar: 5.5 * 100, isCredit: true },
    ];
    const wildTargets = [0.01, 0.5, 3, 10, 100, 999];
    for (const struct of structures) {
      const ceiling = Math.max(0, struct.maxProfitDollar / 100 - PROFIT_TARGET_TICK_BUFFER);
      for (const t of wildTargets) {
        const r = clampProfitTargetToMaxPayout({
          profitTarget: t,
          maxProfit: struct.maxProfitDollar,
          isCredit: struct.isCredit,
        });
        expect(r.clamped, `${struct.name}, target=${t}`).toBeLessThanOrEqual(ceiling + 1e-9);
      }
    }
  });
});
