import { describe, expect, it } from "vitest";
import { chainFallbackZones, reduceGammaGlance, type GammaGlanceBody } from "../atGammaGlanceBind";
import type { ZoneModel } from "../zonesModel";

function glance(tickerWall: number, flip: number, asOfMs: number): GammaGlanceBody {
  const zones: ZoneModel = {
    callWall: tickerWall,
    putWall: tickerWall - 100,
    flip,
    netGexUsdPer1Pct: 1,
    env: "damping",
    asOfLabel: "2:30 PM",
  };
  return { zones, source: "unusual_whales", asOfMs, sessionClosed: false };
}

describe("reduceGammaGlance", () => {
  const now = Date.parse("2026-11-18T19:30:00.000Z");

  it("drops a late SPX sample after the ticker is NVDA", () => {
    const spx = glance(7400, 7200, now - 1_000);
    const leaked = reduceGammaGlance(spx, {
      activeTicker: "NVDA",
      requestTicker: "SPX",
      requestId: 1,
      currentId: 2,
      body: spx,
      error: false,
      nowMs: now,
    });
    expect(leaked).toBeNull();

    const state = reduceGammaGlance(null, {
      activeTicker: "NVDA",
      requestTicker: "NVDA",
      requestId: 2,
      currentId: 2,
      body: glance(180, 175, now - 1_000),
      error: false,
      nowMs: now,
    });
    expect(state?.zones?.callWall).toBe(180);
    expect(state?.zones?.flip).toBe(175);
    expect(state?.zones?.levelSource).toBe("unusual_whales");
    expect(state?.zones?.levelFresh).toBe(true);
    expect(state?.zones?.callWall).not.toBe(7400);
  });

  it("clears the previous ticker when the new request fails", () => {
    const next = reduceGammaGlance(glance(7400, 7200, now), {
      activeTicker: "NVDA",
      requestTicker: "NVDA",
      requestId: 2,
      currentId: 2,
      body: null,
      error: true,
      nowMs: now,
    });
    expect(next).toBeNull();
  });

  it("keeps the newer sample when an older poll for the same ticker finishes last", () => {
    const newer = glance(181, 176, now);
    const older = glance(100, 90, now - 5_000);
    const kept = reduceGammaGlance(newer, {
      activeTicker: "NVDA",
      requestTicker: "NVDA",
      requestId: 1,
      currentId: 2,
      body: older,
      error: false,
      nowMs: now,
    });
    expect(kept?.zones?.callWall).toBe(181);
  });

  it("does not mark an undated or old gamma sample as fresh", () => {
    const old = reduceGammaGlance(null, {
      activeTicker: "SPX",
      requestTicker: "SPX",
      requestId: 1,
      currentId: 1,
      body: glance(7400, 7200, now - 120_000),
      error: false,
      nowMs: now,
    });
    expect(old?.zones?.levelFresh).toBe(false);
    expect(old?.glanceCaption).toBe("Gamma · 2:30 PM");
  });
});

describe("chainFallbackZones", () => {
  it("labels chain walls as chain and not as a live gamma sample", () => {
    const labeled = chainFallbackZones({
      callWall: 150,
      putWall: 140,
      flip: 145,
      netGexUsdPer1Pct: null,
      env: null,
      asOfLabel: "2:31 PM",
      glanceCaption: "Gamma",
    });
    expect(labeled.levelSource).toBe("chain");
    expect(labeled.levelFresh).toBe(false);
    expect(labeled.glanceCaption).toBe("Chain · 2:31 PM");
    expect(labeled.callWall).toBe(150);
  });
});
