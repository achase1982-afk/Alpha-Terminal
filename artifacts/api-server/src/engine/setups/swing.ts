/**
 * Intraday VWAP-band swing setup (the active strategy).
 *
 * The session range is VWAP ± (vwapBandAtrMult × ATR): a lower rail and an
 * upper rail that move with the session. The engine buys oversold pullbacks
 * near the lower rail — but only once the reversal has actually STARTED and is
 * backed by real volume, not while price is still falling.
 *
 * Long entry forms when ALL of the following hold:
 *   Location (a discount worth buying):
 *     1. Price is below VWAP and stretched toward the lower rail
 *        (stretch fraction ≥ belowVwapStretchThreshold).
 *     2. RSI in the configured entry band (oversold-ish, not extended).
 *     3. Not a clean BEARISH downtrend (falling-knife guard).
 *   Confirmation (the turn is real, not a fake bounce):
 *     4. The latest bar is an UP bar (close > open) that closed ABOVE the
 *        previous bar's close — price has actually turned up.
 *     5. Lower-wick rejection (lowerWick > |body|) — buyers defended the lows.
 *     6. Volume is EXPANDING on the turn (volRatio ≥ reversalVolRatioMin) —
 *        real demand is stepping in, the tell of a genuine reversal vs. a quiet
 *        drift that keeps bleeding.
 *
 * Exit: target back toward VWAP / upper rail; hard stop just below the reversal
 * bar's low — if that low breaks, the reversal failed and we're out small.
 *
 * Long-only: shorts are gated by cfg.enableShorts and not implemented here yet.
 */
import type { Bar, Features, Config, Signal } from "../types.js";

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
  if (bars.length < MIN_BARS) return null;
  if (f.atr <= 0 || f.vwap <= 0 || f.volAvg <= 0) return null;

  const prev = bars[bars.length - 2];
  if (!prev) return null;

  const band = cfg.vwapBandAtrMult * f.atr; // = vwap − lowerRail
  if (band <= 0) return null;

  const last = f.last || bar.close;

  // ── Location: oversold pullback below VWAP, stretched toward the lower rail ──
  if (last >= f.vwap) return null;
  const stretch = (f.vwap - last) / band; // 0 at VWAP, 1 at the lower rail
  if (stretch < cfg.belowVwapStretchThreshold) return null;

  // RSI band + falling-knife guard.
  if (f.rsi < cfg.rsiEntryMin || f.rsi > cfg.rsiEntryMax) return null;
  if (f.trend === "BEARISH") return null;

  // ── Confirmation: the reversal has actually started ──
  // Up bar that closed above the prior bar — price is turning up, not still falling.
  if (f.body <= 0) return null;
  if (bar.close <= prev.close) return null;
  // Buyers rejected the lows on this bar (hammer-like).
  if (f.lowerWick <= Math.abs(f.body)) return null;
  // Real demand on the turn — expanding volume, not a quiet fake bounce.
  if (f.volRatio < cfg.reversalVolRatioMin) return null;

  // ── Build the bracket ──
  const entry = last;
  // Stop sits below the reversal bar's low: break it and the reversal failed.
  const stop = bar.low - cfg.stopBelowRailAtrMult * f.atr;
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

  // Confidence blends stretch depth, wick rejection and volume confirmation, 0–1.
  const wickStrength = f.lowerWick / (Math.abs(f.body) + 1e-9);
  const volStrength = f.volRatio / (cfg.reversalVolRatioMin + 1e-9);
  const confidence = Math.min(
    1,
    0.4 * Math.min(stretch, 1) + 0.3 * Math.min(wickStrength / 2, 1) + 0.3 * Math.min(volStrength / 2, 1),
  );

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
      `SWING reversal @ ${entry.toFixed(2)} | stretch ${(stretch * 100).toFixed(0)}% to rail ` +
      `${f.lowerRail.toFixed(2)} | turn-bar vol ${f.volRatio.toFixed(2)}× | RSI ${f.rsi.toFixed(0)} | ` +
      `target ${target.toFixed(2)} (${cfg.swingTargetRail})`,
  };
}
