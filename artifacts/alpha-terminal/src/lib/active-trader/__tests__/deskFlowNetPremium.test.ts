import { describe, expect, it } from "vitest";
import {
  createDeskFlowAggregatorInternal,
  deskFlowAggregatorMarkConnected,
  deskFlowAggregatorProject,
  reduceDeskFlowFrame,
} from "../deskFlowAggregator";
import {
  buildDeskNetPremiumGlance,
  EMPTY_HYSTERESIS,
  NET_PREMIUM_WINDOW_CHOICES_MS,
} from "../deskFlowNetPremium";

/** Synthetic 1s buckets: sustained call buying then put selling bursts. */
function seedSpxFlow(baseMs: number) {
  let internal = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("index"), true);
  for (let i = 0; i < 45; i++) {
    const t = baseMs - (45 - i) * 1000;
    const callBuy = i < 20 ? 400_000 : 50_000;
    const putSell = i % 4 === 0 ? 600_000 : 80_000;
    internal = reduceDeskFlowFrame(internal, {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: t,
      call_buy: callBuy,
      call_sell: 20_000,
      put_buy: 30_000,
      put_sell: putSell,
      rx_ts_ms: t,
    });
  }
  return internal;
}

describe("deskFlowNetPremium rolling windows", () => {
  const now = 1_700_000_000_000;

  for (const windowMs of NET_PREMIUM_WINDOW_CHOICES_MS) {
    it(`responds to sustained call bias over ${windowMs / 1000}s`, () => {
      const internal = seedSpxFlow(now);
      const agg = deskFlowAggregatorProject({ ...internal, nowMs: now });
      const built = buildDeskNetPremiumGlance(internal, agg, windowMs, 200_000, EMPTY_HYSTERESIS, now);
      expect(built.glance.calls?.direction).toBe("buy");
      expect((built.glance.calls?.netUsd ?? 0) > 0).toBe(true);
    });
  }

  it("15/30/60s windows rank calls net similarly on same tape", () => {
    const internal = seedSpxFlow(now);
    const agg = deskFlowAggregatorProject({ ...internal, nowMs: now });
    const nets = NET_PREMIUM_WINDOW_CHOICES_MS.map((w) => {
      const b = buildDeskNetPremiumGlance(internal, agg, w, 200_000, EMPTY_HYSTERESIS, now);
      return b.glance.calls?.netUsd ?? 0;
    });
    expect(nets[0]).toBeGreaterThan(0);
    expect(nets[1]).toBeGreaterThan(0);
    expect(nets[2]).toBeGreaterThan(0);
    expect(Math.abs(nets[1] - nets[0]) / nets[1]).toBeLessThan(0.85);
  });

  it("alternating bursts stay Mixed/Quiet near zero after hysteresis", () => {
    let internal = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("index"), true);
    for (let i = 0; i < 30; i++) {
      const t = now - (30 - i) * 1000;
      internal = reduceDeskFlowFrame(internal, {
        type: "flow_1s",
        sym: "SPX",
        bucket_ms: t,
        call_buy: i % 2 === 0 ? 120_000 : 10_000,
        call_sell: i % 2 === 0 ? 10_000 : 120_000,
        put_buy: 15_000,
        put_sell: 15_000,
        rx_ts_ms: t,
      });
    }
    const agg = deskFlowAggregatorProject({ ...internal, nowMs: now });
    const built = buildDeskNetPremiumGlance(internal, agg, 30_000, 500_000, EMPTY_HYSTERESIS, now);
    expect(["mixed", "quiet"]).toContain(built.glance.calls?.direction);
  });

  it("marks stale when rx gap exceeds threshold", () => {
    const internal = seedSpxFlow(now - 60_000);
    const agg = deskFlowAggregatorProject({ ...internal, nowMs: now - 60_000, lastRxMs: now - 60_000 });
    const built = buildDeskNetPremiumGlance(internal, agg, 30_000, 200_000, EMPTY_HYSTERESIS, now);
    expect(built.glance.stale).toBe(true);
  });

  it("no_prints when connected but empty", () => {
    const internal = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("index"), true);
    const agg = deskFlowAggregatorProject(internal);
    const built = buildDeskNetPremiumGlance(internal, agg, 30_000, 200_000, EMPTY_HYSTERESIS, now);
    expect(built.glance.noPrints).toBe(true);
  });
});