import { describe, expect, it } from "vitest";
import {
  SCANNER_LAYER7_COMPOSITE_WEIGHTS,
  computeScannerLayer7Scores,
  computeWeightedComposite,
  scoreCatalyst,
  scoreFlow,
  scoreLiquidity,
  scoreTechnical,
  scoreVolatility,
} from "../scannerLayer7Scores.js";
import type { ScannerFlowLayer5Wire } from "../scannerFlowContext.js";
import type { ScannerTechnicalLayer6Wire } from "../scannerTechnicalContext.js";

describe("scannerLayer7Scores", () => {
  it("composite weights sum to 100%", () => {
    const s = Object.values(SCANNER_LAYER7_COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 6);
  });

  it("scoreLiquidity requires price for notional blend", () => {
    expect(scoreLiquidity(10e6, 8e6, null)).toBeNull();
    expect(scoreLiquidity(10e6, 8e6, 180)).not.toBeNull();
  });

  it("scoreCatalyst is zero when earnings beyond 30d", () => {
    expect(scoreCatalyst({ daysToEarnings: 45, reactionsLast4q: [5, 5, 5, 5] })).toBe(0);
  });

  it("scoreVolatility uses IVR with optional IV30 / IV vs HV tilt", () => {
    const base = scoreVolatility({ ivr: 50, iv30: null, ivVsHv: null });
    const richer = scoreVolatility({ ivr: 50, iv30: 0.45, ivVsHv: 1.15 });
    expect(base).not.toBeNull();
    expect(richer).not.toBeNull();
    expect(richer!).toBeGreaterThanOrEqual(base!);
  });

  it("scoreFlow is null without volume_4h", () => {
    const empty: ScannerFlowLayer5Wire = {
      blocks_4h: 1,
      sweeps_4h: 1,
      net_delta_dollar: 1e6,
      top_strike_label: null,
      top_strike: null,
      volume_4h: null,
      volume_over_oi: 0.5,
    };
    expect(scoreFlow(empty)).toBeNull();
  });

  it("scoreTechnical is directional around 50", () => {
    const bull: ScannerTechnicalLayer6Wire = {
      fifty_two_week_low: 100,
      fifty_two_week_high: 200,
      off_fifty_two_week_high_pct: -2,
      vs_twenty_ma_pct: 4,
      vs_fifty_ma_pct: 3,
      vs_two_hundred_ma_pct: 5,
      five_day_return_pct: 2,
      thirty_day_return_pct: 1,
    };
    const bear: ScannerTechnicalLayer6Wire = {
      ...bull,
      vs_twenty_ma_pct: -6,
      vs_fifty_ma_pct: -8,
      vs_two_hundred_ma_pct: -10,
      five_day_return_pct: -4,
      thirty_day_return_pct: -3,
      off_fifty_two_week_high_pct: -35,
    };
    expect(scoreTechnical(bull)!).toBeGreaterThan(55);
    expect(scoreTechnical(bear)!).toBeLessThan(45);
  });

  it("computeWeightedComposite renormalizes when legs are null", () => {
    const c = computeWeightedComposite({
      liquidity: null,
      volatility: 100,
      catalyst: null,
      flow: null,
      technical: null,
    });
    expect(c).toBe(100);
  });

  it("sanity: AAPL-like vs NVDA-like illustrative cards", () => {
    const aapl = computeScannerLayer7Scores({
      volume: 55_000_000,
      avg_volume_20d: 60_000_000,
      price: 210,
      iv30: 0.22,
      ivr: 38,
      iv_vs_hv: 1.05,
      days_to_earnings: 12,
      reactions_last_4q: [2.1, -1.5, 0.9, 1.2],
      flow: {
        blocks_4h: 4,
        sweeps_4h: 18,
        net_delta_dollar: -2_500_000,
        top_strike_label: "$210C",
        top_strike: null,
        volume_4h: 120_000,
        volume_over_oi: 0.18,
      },
      technical: {
        fifty_two_week_low: 160,
        fifty_two_week_high: 260,
        off_fifty_two_week_high_pct: -8,
        vs_twenty_ma_pct: 0.5,
        vs_fifty_ma_pct: 1.2,
        vs_two_hundred_ma_pct: 2.0,
        five_day_return_pct: 0.4,
        thirty_day_return_pct: -0.2,
      },
    });

    const nvda = computeScannerLayer7Scores({
      volume: 120_000_000,
      avg_volume_20d: 45_000_000,
      price: 1180,
      iv30: 0.52,
      ivr: 78,
      iv_vs_hv: 1.22,
      days_to_earnings: 5,
      reactions_last_4q: [6, 8, -4, 5],
      flow: {
        blocks_4h: 22,
        sweeps_4h: 55,
        net_delta_dollar: 18_000_000,
        top_strike_label: "$1200C",
        top_strike: null,
        volume_4h: 420_000,
        volume_over_oi: 0.65,
      },
      technical: {
        fifty_two_week_low: 400,
        fifty_two_week_high: 1400,
        off_fifty_two_week_high_pct: -4,
        vs_twenty_ma_pct: 3.5,
        vs_fifty_ma_pct: 4.1,
        vs_two_hundred_ma_pct: 6.2,
        five_day_return_pct: 3.2,
        thirty_day_return_pct: 5.1,
      },
    });

    expect(aapl.compositeScore).not.toBeNull();
    expect(nvda.compositeScore).not.toBeNull();
    expect(nvda.compositeScore!).toBeGreaterThan(aapl.compositeScore!);
    expect(nvda.volatilityScore!).toBeGreaterThan(aapl.volatilityScore!);
    expect(nvda.flowScore!).toBeGreaterThan(aapl.flowScore!);
  });
});
