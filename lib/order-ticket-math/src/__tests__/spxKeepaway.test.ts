import { describe, expect, it } from "vitest";
import {
  computeSpxKeepawayFromDailyCandles,
  spxKeepawayBoundary,
  type DailyOhlc,
} from "../spxKeepaway";

/** 221-day synthetic set matching owner golden aggregates (med/avg). */
function buildGolden221Candles(): DailyOhlc[] {
  const lowHigh = (221 * 36.6 - 111 * 29.5) / 110;
  const highHigh = (221 * 34.6 - 111 * 24.2) / 110;
  const candles: DailyOhlc[] = [];
  for (let i = 0; i < 221; i++) {
    const lowSpr = i < 111 ? 29.5 : lowHigh;
    const highSpr = i < 111 ? 24.2 : highHigh;
    const close = 5000;
    candles.push({
      close,
      low: close - lowSpr,
      high: close + highSpr,
    });
  }
  return candles;
}

describe("computeSpxKeepawayFromDailyCandles", () => {
  it("matches Quinn golden medians/means for n=221", () => {
    const stats = computeSpxKeepawayFromDailyCandles(buildGolden221Candles(), {
      startYmd: "2026-01-01",
      endYmd: "2026-11-17",
    });
    expect(stats).not.toBeNull();
    expect(stats!.n).toBe(221);
    expect(stats!.lowSide.median).toBeCloseTo(29.5, 1);
    expect(stats!.lowSide.mean).toBeCloseTo(36.6, 1);
    expect(stats!.highSide.median).toBeCloseTo(24.2, 1);
    expect(stats!.highSide.mean).toBeCloseTo(34.6, 1);
  });

  it("computes session boundaries from median vs mean", () => {
    const stats = computeSpxKeepawayFromDailyCandles(buildGolden221Candles(), {
      startYmd: "2026-01-01",
      endYmd: "2026-11-17",
    })!;
    const putMed = spxKeepawayBoundary(stats, "put", 7540, 7550, false);
    const putAvg = spxKeepawayBoundary(stats, "put", 7540, 7550, true);
    const callMed = spxKeepawayBoundary(stats, "call", 7540, 7550, false);
    expect(putMed).toBeCloseTo(7540 - 29.5, 5);
    expect(putAvg).toBeCloseTo(7540 - 36.6, 5);
    expect(callMed).toBeCloseTo(7550 + 24.2, 5);
  });
});