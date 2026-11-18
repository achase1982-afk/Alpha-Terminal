import { describe, expect, it } from "vitest";
import { computeSpxKeepawayFromDailyCandles } from "@workspace/order-ticket-math";

describe("computeSpxKeepawayFromDailyCandles (API path)", () => {
  it("accepts Schwab-shaped daily rows", () => {
    const lowHigh = (221 * 36.6 - 111 * 29.5) / 110;
    const highHigh = (221 * 34.6 - 111 * 24.2) / 110;
    const candles = Array.from({ length: 221 }, (_, i) => ({
      close: 5000,
      low: 5000 - (i < 111 ? 29.5 : lowHigh),
      high: 5000 + (i < 111 ? 24.2 : highHigh),
    }));
    const stats = computeSpxKeepawayFromDailyCandles(candles, {
      startYmd: "2026-01-01",
      endYmd: "2026-11-17",
    });
    expect(stats?.n).toBe(221);
    expect(stats?.lowSide.median).toBeCloseTo(29.5, 1);
    expect(stats?.highSide.mean).toBeCloseTo(34.6, 1);
  });
});