/**
 * Opening Range Breakout setup.
 * Swap this file to change strategy — same signature, same engine.
 *
 * Entry: first 1-min bar that closes above OR_high, after OR_complete,
 *        when RVOL ≥ threshold and target clears the spread.
 * Stop:  OR_low (or entry − atrK × ATR when stopMode = "atr")
 * Target: entry + rTarget × risk
 */
import type { Bar, Features, Config, Signal } from "../types.js";
import { sizeByDollars } from "../risk.js";

export function checkSetup(bar: Bar, f: Features, cfg: Config, symbol: string): Signal | null {
  if (!f.orComplete) return null;
  if (bar.close <= f.orHigh) return null;       // no confirmed breakout
  if (f.rvol < cfg.rvolThreshold) return null;  // volume not expanding

  const entry = Math.max(bar.close, f.orHigh);

  const stop =
    cfg.stopMode === "or_low"
      ? f.orLow
      : entry - cfg.atrK * (f.atr || f.orRange * 0.5); // fallback if ATR not ready

  const risk = entry - stop;
  if (risk <= 0) return null;

  const target = entry + cfg.rTarget * risk;

  // Reject if the target is too close to the spread to be worth trading
  if (f.spread > 0 && target - entry < f.spread * cfg.minTargetOverSpread) return null;

  // Dollar-based size (Max/Trade vs Total Budget); finalized in index.ts.
  const size = sizeByDollars(entry, cfg, 0);
  if (size <= 0) return null;

  return {
    timestamp:  bar.timestamp,
    symbol,
    action:     "BUY",
    entryPrice: entry,
    stopPrice:  stop,
    targetPrice: target,
    size,
    confidence: Math.min(f.rvol / cfg.rvolThreshold, 2) / 2, // 0–1
    reason: `ORB breakout ${f.orHigh.toFixed(2)} | RVOL ${f.rvol.toFixed(2)} | R ${cfg.rTarget}`,
  };
}
