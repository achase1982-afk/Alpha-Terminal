import { describe, expect, it } from "vitest";
import { checkSwingSetup } from "../setups/swing.js";
import { initFeatures } from "../features.js";
import type { Bar, Config, Features } from "../types.js";

const CFG: Config = {
  symbol: "AAPL",
  symbols: ["AAPL"],
  accountHash: "",
  setup: "swing",
  engine: "deterministic",
  modelId: "claude-opus-4-8",
  orWindowMinutes: 15,
  rvolThreshold: 1.5,
  stopMode: "or_low",
  atrK: 1.0,
  rTarget: 1.5,
  minTargetOverSpread: 3,
  breakoutLookback: 10,
  momVolRatioMin: 1.5,
  momRvolMin: 1.0,
  momRsiMin: 55,
  momRsiMax: 70,
  momStopAtrMult: 1.5,
  momTrailAtrMult: 1.0,
  bodyAvgWindow: 10,
  volAvgWindow: 20,
  directionLookback: 5,
  vwapBandAtrMult: 2.0,
  belowVwapStretchThreshold: 0.6,
  volDryingThreshold: 1.0,
  reversalVolRatioMin: 1.2,
  rsiEntryMin: 25,
  rsiEntryMax: 55,
  swingTargetRail: "vwap",
  stopBelowRailAtrMult: 0.5,
  volumeProfileLookbackDays: 20,
  totalBudget: 1000,
  maxPerTrade: 300,
  dailyMaxLoss: 100,
  pollIntervalSec: 60,
  lossStreakLimit: 3,
  cooldownMinutes: 60,
  tradesPerDay: 40,
  enableShorts: false,
  enableExtendedHours: false,
  flattenAtClose: true,
  cancelTimeoutSeconds: 30,
  timeStop: "15:55",
  logDb: ":memory:",
};

/** The breakout bar: pushes to a new high at 101.0 above VWAP (100). */
const BREAKOUT_BAR: Bar = {
  timestamp: new Date("2026-06-25T14:00:00Z"),
  open: 100.3, high: 101.05, low: 100.2, close: 101.0, volume: 2000, vwap: 100,
};

/** 30 bars all capped at `priorHigh` so the current bar's 101.0 is a clean break. */
function barsWithPriorHigh(priorHigh: number): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 30; i++) {
    bars.push({ ...BREAKOUT_BAR, open: priorHigh - 0.5, high: priorHigh, low: priorHigh - 0.6, close: priorHigh - 0.2 });
  }
  bars.push(BREAKOUT_BAR); // current bar
  return bars;
}

/** Feature set that satisfies every momentum-entry condition. ATR 0.5, VWAP 100. */
function qualifyingFeatures(): Features {
  const f = initFeatures();
  f.atr = 0.5;
  f.vwap = 100;
  f.last = 101.0;       // at/above VWAP and the breakout level
  f.volAvg = 1000;
  f.volRatio = 2.0;     // ≥ momVolRatioMin (1.5)
  f.rvol = 1.5;         // ≥ momRvolMin (1.0)
  f.rsi = 62;           // within [55, 70]
  f.trend = "BULLISH";  // not BEARISH
  f.spread = 0;
  return f;
}

const BARS = barsWithPriorHigh(100.5); // prior 10-bar high = 100.5; current 101.0 breaks it

describe("checkSwingSetup (momentum)", () => {
  it("returns a long breakout signal when all momentum conditions hold", () => {
    const sig = checkSwingSetup(BREAKOUT_BAR, qualifyingFeatures(), CFG, "AAPL", BARS);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("BUY");
    expect(sig!.entryPrice).toBeCloseTo(101.0, 5);
    // No fixed target on momentum — trailing stop manages the exit.
    expect(sig!.targetPrice).toBe(0);
    // Stop is at least momStopAtrMult×ATR below entry (101 − 1.5×0.5 = 100.25), or lower.
    expect(sig!.stopPrice).toBeLessThanOrEqual(100.25 + 1e-9);
    expect(sig!.stopPrice).toBeLessThan(sig!.entryPrice);
    expect(sig!.size).toBeGreaterThan(0);
  });

  it("rejects when price is below VWAP (not holding above it)", () => {
    const f = qualifyingFeatures();
    f.last = 99.5; // below VWAP 100
    expect(checkSwingSetup(BREAKOUT_BAR, f, CFG, "AAPL", BARS)).toBeNull();
  });

  it("rejects when price has not broken the prior N-bar high", () => {
    // Prior high 101.5 > current 101.0 → no breakout.
    expect(checkSwingSetup(BREAKOUT_BAR, qualifyingFeatures(), CFG, "AAPL", barsWithPriorHigh(101.5))).toBeNull();
  });

  it("rejects when volume is not participating", () => {
    const f = qualifyingFeatures();
    f.volRatio = 1.0; // < momVolRatioMin
    expect(checkSwingSetup(BREAKOUT_BAR, f, CFG, "AAPL", BARS)).toBeNull();
  });

  it("rejects when RVOL is below the floor (baseline available)", () => {
    const f = qualifyingFeatures();
    f.rvol = 0.5; // > 0 but < momRvolMin
    expect(checkSwingSetup(BREAKOUT_BAR, f, CFG, "AAPL", BARS)).toBeNull();
  });

  it("rejects when RSI is outside the strength band", () => {
    const f = qualifyingFeatures();
    f.rsi = 45; // < momRsiMin
    expect(checkSwingSetup(BREAKOUT_BAR, f, CFG, "AAPL", BARS)).toBeNull();
  });

  it("rejects a bearish trend", () => {
    const f = qualifyingFeatures();
    f.trend = "BEARISH";
    expect(checkSwingSetup(BREAKOUT_BAR, f, CFG, "AAPL", BARS)).toBeNull();
  });

  it("rejects when there aren't enough bars yet", () => {
    expect(checkSwingSetup(BREAKOUT_BAR, qualifyingFeatures(), CFG, "AAPL", BARS.slice(0, 5))).toBeNull();
  });
});
