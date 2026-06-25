/**
 * Intraday VWAP-band swing setup (the active strategy).
 *
 * The session range is VWAP ± (vwapBandAtrMult × ATR): a lower rail and an
 * upper rail that move with the session. The engine buys dips near the lower
 * rail that show exhaustion, and exits back toward VWAP (or the upper rail).
 *
 * Long entry forms when ALL of the following hold near the lower rail:
 *   1. Stretch — price has pulled below VWAP toward the lower rail
 *      (stretch fraction ≥ belowVwapStretchThreshold).
 *   2. Volume drying — the latest bar's volume vs. its trailing average is
 *      falling (volRatio ≤ volDryingThreshold), i.e. the dip is losing fuel.
 *   3. Bodies shrinking — the down-move is decelerating (bodyShrinking).
 *   4. Lower-wick rejection — buyers are rejecting lower prices
 *      (lowerWick > |body|).
 *   5. RSI in the configured entry band, and not a clean BEARISH downtrend
 *      (falling-knife guard).
 *
 * Exit: target back toward VWAP / upper rail, hard stop below the lower rail —
 * a clean break of the lower rail means the range read was wrong.
 *
 * Long-only: "selling swing highs" is the exit, not a short. Shorts are gated
 * by cfg.enableShorts and intentionally not implemented here yet.
 */
import type { Bar, Features, Config, Signal } from "../types.js";

/** Minimum session bars before indicators (RSI/EMA/ATR/VWAP) are trustworthy. */
const MIN_BARS = 20;

export function checkSwingSetup(
  bar: Bar,
  f: Features,
  cfg: Config,
  symbol: string,
  barCount: number,
): Signal | null {
  // ── Readiness ──
  if (barCount < MIN_BARS) return null;
  if (f.atr <= 0 || f.vwap <= 0 || f.volAvg <= 0) return null;

  const band = cfg.vwapBandAtrMult * f.atr; // = vwap − lowerRail
  if (band <= 0) return null;

  const last = f.last || bar.close;

  // ── 1. Stretch below VWAP toward the lower rail ──
  if (last >= f.vwap) return null;
  const stretch = (f.vwap - last) / band; // 0 at VWAP, 1 at the lower rail
  if (stretch < cfg.belowVwapStretchThreshold) return null;

  // ── 2. Volume drying (dip losing fuel, not expanding) ──
  if (f.volRatio > cfg.volDryingThreshold) return null;

  // ── 3. Down-move decelerating ──
  if (!f.bodyShrinking) return null;

  // ── 4. Lower-wick rejection of lower prices ──
  if (f.lowerWick <= Math.abs(f.body)) return null;

  // ── 5. RSI band + falling-knife guard ──
  if (f.rsi < cfg.rsiEntryMin || f.rsi > cfg.rsiEntryMax) return null;
  if (f.trend === "BEARISH") return null;

  // ── Build the bracket ──
  const entry = last;
  const stop = f.lowerRail - cfg.stopBelowRailAtrMult * f.atr;
  const target = cfg.swingTargetRail === "upper" ? f.upperRail : f.vwap;

  const risk = entry - stop;
  if (risk <= 0) return null;
  if (target <= entry) return null;

  // Reject if the target is too close to the spread to be worth trading.
  if (f.spread > 0 && target - entry < f.spread * cfg.minTargetOverSpread) return null;

  // ── Size by risk ──
  const riskDollars = cfg.startingEquity * cfg.riskPerTradePct;
  const maxDollars = cfg.startingEquity * cfg.maxPositionSizePct;
  const size = Math.min(Math.floor(riskDollars / risk), Math.floor(maxDollars / entry));
  if (size <= 0) return null;

  // Confidence blends stretch depth and wick rejection strength, 0–1.
  const wickStrength = f.lowerWick / (Math.abs(f.body) + 1e-9);
  const confidence = Math.min(1, 0.5 * Math.min(stretch, 1) + 0.5 * Math.min(wickStrength / 2, 1));

  return {
    timestamp: bar.timestamp,
    symbol,
    action: "BUY",
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    size,
    confidence,
    reason:
      `SWING dip @ ${entry.toFixed(2)} | stretch ${(stretch * 100).toFixed(0)}% to rail ` +
      `${f.lowerRail.toFixed(2)} | volRatio ${f.volRatio.toFixed(2)} | RSI ${f.rsi.toFixed(0)} | ` +
      `target ${target.toFixed(2)} (${cfg.swingTargetRail})`,
  };
}
