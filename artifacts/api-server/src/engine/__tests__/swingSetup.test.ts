import { describe, expect, it } from "vitest";
import { checkSwingSetup } from "../setups/swing.js";
import { initFeatures } from "../features.js";
import type { Bar, Config, Features } from "../types.js";

const CFG: Config = {
  symbol: "AAPL",
  symbols: ["AAPL"],
  accountHash: "",
  setup: "swing",
  orWindowMinutes: 15,
  rvolThreshold: 1.5,
  stopMode: "or_low",
  atrK: 1.0,
  rTarget: 1.5,
  minTargetOverSpread: 3,
  bodyAvgWindow: 10,
  volAvgWindow: 20,
  directionLookback: 5,
  vwapBandAtrMult: 2.0,
  belowVwapStretchThreshold: 0.6,
  volDryingThreshold: 1.0,
  rsiEntryMin: 25,
  rsiEntryMax: 55,
  swingTargetRail: "vwap",
  stopBelowRailAtrMult: 0.5,
  volumeProfileLookbackDays: 20,
  dailyLossHaltPct: 0.03,
  riskPerTradePct: 0.01,
  maxPositionSizePct: 0.2,
  lossStreakLimit: 3,
  cooldownMinutes: 60,
  tradesPerDay: 40,
  enableShorts: false,
  runMode: "shadow",
  cancelTimeoutSeconds: 30,
  timeStop: "15:55",
  startingEquity: 1000,
  logDb: ":memory:",
};

const BAR: Bar = {
  timestamp: new Date("2026-06-25T14:00:00Z"),
  open: 98.6, high: 98.9, low: 98.4, close: 98.6, volume: 800, vwap: 100,
};

/** A feature set that satisfies every long-entry condition. VWAP 100, ATR 1.0,
 *  band 2.0 → lower rail 98 / upper 102. Price 98.6 = 70% stretch to the rail. */
function qualifyingFeatures(): Features {
  const f = initFeatures();
  f.atr = 1.0;
  f.vwap = 100;
  f.last = 98.6;
  f.lowerRail = 98;
  f.upperRail = 102;
  f.volAvg = 1000;
  f.volRatio = 0.8;     // volume drying ≤ 1.0
  f.body = -0.05;       // tiny down body
  f.bodyShrinking = true;
  f.lowerWick = 0.2;    // wick > |body| → rejection
  f.upperWick = 0.05;
  f.rsi = 40;           // within 25–55
  f.trend = "PULLBACK"; // not BEARISH
  f.spread = 0;
  return f;
}

describe("checkSwingSetup", () => {
  it("returns a long bracket when all dip-exhaustion conditions hold", () => {
    const sig = checkSwingSetup(BAR, qualifyingFeatures(), CFG, "AAPL", 50);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("BUY");
    expect(sig!.symbol).toBe("AAPL");
    expect(sig!.entryPrice).toBeCloseTo(98.6, 5);
    // stop = lower rail (98) − 0.5 × ATR (1.0) = 97.5
    expect(sig!.stopPrice).toBeCloseTo(97.5, 5);
    // target = VWAP (swingTargetRail "vwap")
    expect(sig!.targetPrice).toBeCloseTo(100, 5);
    expect(sig!.size).toBeGreaterThan(0);
    expect(sig!.stopPrice).toBeLessThan(sig!.entryPrice);
    expect(sig!.targetPrice).toBeGreaterThan(sig!.entryPrice);
  });

  it("targets the upper rail when configured", () => {
    const sig = checkSwingSetup(BAR, qualifyingFeatures(), { ...CFG, swingTargetRail: "upper" }, "AAPL", 50);
    expect(sig!.targetPrice).toBeCloseTo(102, 5);
  });

  it("rejects when there aren't enough bars yet", () => {
    expect(checkSwingSetup(BAR, qualifyingFeatures(), CFG, "AAPL", 10)).toBeNull();
  });

  it("rejects when price hasn't stretched far enough toward the lower rail", () => {
    const f = qualifyingFeatures();
    f.last = 99.8; // stretch (100−99.8)/2 = 0.1 < 0.6
    expect(checkSwingSetup(BAR, f, CFG, "AAPL", 50)).toBeNull();
  });

  it("rejects when volume is still expanding (not drying)", () => {
    const f = qualifyingFeatures();
    f.volRatio = 1.6; // > volDryingThreshold
    expect(checkSwingSetup(BAR, f, CFG, "AAPL", 50)).toBeNull();
  });

  it("rejects when there is no lower-wick rejection", () => {
    const f = qualifyingFeatures();
    f.lowerWick = 0.01; // ≤ |body| (0.05)
    expect(checkSwingSetup(BAR, f, CFG, "AAPL", 50)).toBeNull();
  });

  it("rejects a clean bearish downtrend (falling-knife guard)", () => {
    const f = qualifyingFeatures();
    f.trend = "BEARISH";
    expect(checkSwingSetup(BAR, f, CFG, "AAPL", 50)).toBeNull();
  });

  it("rejects when RSI is outside the entry band", () => {
    const f = qualifyingFeatures();
    f.rsi = 72;
    expect(checkSwingSetup(BAR, f, CFG, "AAPL", 50)).toBeNull();
  });

  it("rejects when the down-move is not decelerating", () => {
    const f = qualifyingFeatures();
    f.bodyShrinking = false;
    expect(checkSwingSetup(BAR, f, CFG, "AAPL", 50)).toBeNull();
  });
});
