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
  reversalVolRatioMin: 1.2,
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
  cancelTimeoutSeconds: 30,
  timeStop: "15:55",
  startingEquity: 1000,
  logDb: ":memory:",
};

/** The confirmation (turn) bar: an up-bar that closed above the prior bar,
 *  with a long lower wick and a low of 98.3. */
const TURN_BAR: Bar = {
  timestamp: new Date("2026-06-25T14:00:00Z"),
  open: 98.4, high: 98.7, low: 98.3, close: 98.6, volume: 1500, vwap: 100,
};

/** A 50-bar history whose last bar closed at `prevClose` (the bar before the
 *  turn). Only length and the last element are read by the setup. */
function barsEndingBefore(prevClose: number): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 50; i++) {
    bars.push({ ...TURN_BAR, close: prevClose, open: prevClose, high: prevClose, low: prevClose });
  }
  return bars;
}

/** A feature set that satisfies every long-entry condition. VWAP 100, ATR 1.0,
 *  band 2.0 → lower rail 98 / upper 102. Price 98.6 = 70% stretch to the rail.
 *  Up bar (body > 0), lower-wick rejection, expanding volume. */
function qualifyingFeatures(): Features {
  const f = initFeatures();
  f.atr = 1.0;
  f.vwap = 100;
  f.last = 98.6;
  f.lowerRail = 98;
  f.upperRail = 102;
  f.volAvg = 1000;
  f.volRatio = 1.5;     // expanding ≥ reversalVolRatioMin (1.2)
  f.body = 0.2;         // up bar (close > open)
  f.lowerWick = 0.3;    // wick > |body| → rejection of the lows
  f.upperWick = 0.05;
  f.rsi = 40;           // within 25–55
  f.trend = "PULLBACK"; // not BEARISH
  f.spread = 0;
  return f;
}

/** Prior bar closed at 98.4, below the turn bar's 98.6 → confirms the turn up. */
const PRIOR = barsEndingBefore(98.4);

describe("checkSwingSetup", () => {
  it("returns a long bracket when a confirmed reversal forms", () => {
    const sig = checkSwingSetup(TURN_BAR, qualifyingFeatures(), CFG, "AAPL", PRIOR);
    expect(sig).not.toBeNull();
    expect(sig!.action).toBe("BUY");
    expect(sig!.symbol).toBe("AAPL");
    expect(sig!.entryPrice).toBeCloseTo(98.6, 5);
    // stop = turn-bar low (98.3) − 0.5 × ATR (1.0) = 97.8
    expect(sig!.stopPrice).toBeCloseTo(97.8, 5);
    // target = VWAP (swingTargetRail "vwap")
    expect(sig!.targetPrice).toBeCloseTo(100, 5);
    expect(sig!.size).toBeGreaterThan(0);
    expect(sig!.stopPrice).toBeLessThan(sig!.entryPrice);
    expect(sig!.targetPrice).toBeGreaterThan(sig!.entryPrice);
  });

  it("targets the upper rail when configured", () => {
    const sig = checkSwingSetup(TURN_BAR, qualifyingFeatures(), { ...CFG, swingTargetRail: "upper" }, "AAPL", PRIOR);
    expect(sig!.targetPrice).toBeCloseTo(102, 5);
  });

  it("rejects when there aren't enough bars yet", () => {
    expect(checkSwingSetup(TURN_BAR, qualifyingFeatures(), CFG, "AAPL", PRIOR.slice(0, 10))).toBeNull();
  });

  it("rejects when price hasn't stretched far enough toward the lower rail", () => {
    const f = qualifyingFeatures();
    f.last = 99.8; // stretch (100−99.8)/2 = 0.1 < 0.6
    expect(checkSwingSetup(TURN_BAR, f, CFG, "AAPL", PRIOR)).toBeNull();
  });

  it("rejects when the bar is still falling (not an up-bar)", () => {
    const f = qualifyingFeatures();
    f.body = -0.1; // down bar — the turn hasn't started
    expect(checkSwingSetup(TURN_BAR, f, CFG, "AAPL", PRIOR)).toBeNull();
  });

  it("rejects when the bar did not close above the prior bar", () => {
    // Prior bar closed at 98.9, above the turn bar's 98.6 → no higher close.
    expect(checkSwingSetup(TURN_BAR, qualifyingFeatures(), CFG, "AAPL", barsEndingBefore(98.9))).toBeNull();
  });

  it("rejects when volume is not expanding on the turn (fake bounce)", () => {
    const f = qualifyingFeatures();
    f.volRatio = 0.8; // < reversalVolRatioMin — quiet drift, not real demand
    expect(checkSwingSetup(TURN_BAR, f, CFG, "AAPL", PRIOR)).toBeNull();
  });

  it("rejects when there is no lower-wick rejection", () => {
    const f = qualifyingFeatures();
    f.lowerWick = 0.01; // ≤ |body| (0.2)
    expect(checkSwingSetup(TURN_BAR, f, CFG, "AAPL", PRIOR)).toBeNull();
  });

  it("rejects a clean bearish downtrend (falling-knife guard)", () => {
    const f = qualifyingFeatures();
    f.trend = "BEARISH";
    expect(checkSwingSetup(TURN_BAR, f, CFG, "AAPL", PRIOR)).toBeNull();
  });

  it("rejects when RSI is outside the entry band", () => {
    const f = qualifyingFeatures();
    f.rsi = 72;
    expect(checkSwingSetup(TURN_BAR, f, CFG, "AAPL", PRIOR)).toBeNull();
  });
});
