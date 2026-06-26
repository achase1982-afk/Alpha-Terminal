/**
 * Long-momentum breakout setup (the active deterministic strategy).
 *
 * This trades WITH momentum — it does not fade moves or buy dips. It enters when
 * price is holding above VWAP and breaks out above the recent N-bar high on real
 * volume, with RSI in a strength band. There is NO fixed take-profit: the exit is
 * a trailing stop the engine raises each tick (managed in index.ts).
 *
 * Long entry forms when ALL of the following hold on the latest 1-min bar:
 *   1. Price at/above VWAP (reclaiming or holding above it).
 *   2. Breakout: price breaks above the high of the prior `breakoutLookback` bars.
 *   3. Participation: volRatio ≥ momVolRatioMin AND rvol ≥ momRvolMin
 *      (rvol enforced only when a baseline is available, i.e. rvol > 0).
 *   4. RSI in the strength band [momRsiMin, momRsiMax].
 *   5. Trend ≠ BEARISH.
 *
 * Stop (structural, protective): the lower of the breakout bar's low and the
 * recent swing low, with a floor of entry − (momStopAtrMult × ATR) so it is wide
 * enough to survive intrabar noise rather than a tight scalp stop.
 *
 * Long-only. Sizing is dollar-based and finalized in index.ts (it needs live
 * open-exposure); the size here is provisional (Max/Trade vs Total Budget).
 */
import type { Bar, Features, Config, Signal } from "../types.js";
import { sizeByDollars } from "../risk.js";

/** Minimum session bars before indicators (RSI/EMA/ATR/VWAP) are trustworthy. */
const MIN_BARS = 20;

export function checkSwingSetup(
  bar: Bar,
  f: Features,
  cfg: Config,
  symbol: string,
  bars: Bar[],
): Signal | null {
  // ── Readiness ──
  const N = Math.max(2, Math.floor(cfg.breakoutLookback));
  if (bars.length < Math.max(MIN_BARS, N + 2)) return null;
  if (f.atr <= 0 || f.vwap <= 0 || f.volAvg <= 0) return null;

  const last = f.last || bar.close;

  // ── 1. Holding above VWAP ──
  if (last < f.vwap) return null;

  // ── 2. Breakout above the prior N-bar high ──
  const priorBars = bars.slice(-(N + 1), -1); // the N bars BEFORE the current one
  if (priorBars.length < N) return null;
  const priorHigh = Math.max(...priorBars.map((b) => b.high));
  if (last <= priorHigh) return null;

  // ── 3. Volume participation ──
  if (f.volRatio < cfg.momVolRatioMin) return null;
  if (f.rvol > 0 && f.rvol < cfg.momRvolMin) return null; // enforce when a baseline exists

  // ── 4. RSI strength band ──
  if (f.rsi < cfg.momRsiMin || f.rsi > cfg.momRsiMax) return null;

  // ── 5. Not a downtrend ──
  if (f.trend === "BEARISH") return null;

  // ── Build the entry + structural stop ──
  const entry = last;
  const swingLow = Math.min(...bars.slice(-(N + 1)).map((b) => b.low));
  const structural = Math.min(bar.low, swingLow);
  const atrFloor = entry - cfg.momStopAtrMult * f.atr; // never tighter than this
  const stop = Math.min(structural, atrFloor);

  if (stop >= entry) return null; // sanity

  // ── Provisional dollar size (authoritative size set in index.ts) ──
  const size = sizeByDollars(entry, cfg, 0);
  if (size < 1) return null;

  // Confidence: breakout margin (ATR units) + volume + RSI room in the band.
  const breakoutMargin = (entry - priorHigh) / f.atr;
  const rsiRoom = (f.rsi - cfg.momRsiMin) / Math.max(1, cfg.momRsiMax - cfg.momRsiMin);
  const confidence = Math.min(
    1,
    0.4 * Math.min(breakoutMargin, 1) +
      0.3 * Math.min(f.volRatio / (cfg.momVolRatioMin + 1e-9) / 2, 1) +
      0.3 * Math.min(Math.max(rsiRoom, 0), 1),
  );

  return {
    timestamp: bar.timestamp,
    symbol,
    action: "BUY",
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: 0, // momentum has no fixed target — trailing stop manages the exit
    size,
    confidence,
    reason:
      `MOMENTUM breakout @ ${entry.toFixed(2)} > ${priorHigh.toFixed(2)} (${N}-bar high) | ` +
      `vol ${f.volRatio.toFixed(2)}× rvol ${f.rvol.toFixed(2)} | RSI ${f.rsi.toFixed(0)} | ` +
      `stop ${stop.toFixed(2)} (${(((entry - stop) / f.atr) || 0).toFixed(1)}×ATR)`,
  };
}
