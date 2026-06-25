/**
 * Pure feature computation — zero I/O, zero side effects.
 * All functions mutate the Features object in-place (call-by-reference) so
 * the engine avoids allocating a new object on every bar.
 */
import { RSI, EMA, ATR } from "technicalindicators";
import type { Bar, Features, Config, TrendLabel } from "./types.js";

const MINUTES_PER_SESSION = 390;

export function initFeatures(): Features {
  return {
    orHigh: 0,
    orLow: 0,
    orRange: 0,
    orComplete: false,

    last: 0,
    rvol: 0,
    atr: 0,
    vwap: 0,
    vwapDist: 0,
    dayHigh: 0,
    dayLow: 0,
    rangePos: 0,
    spread: 0,
    spreadBps: 0,
    minutesSinceOpen: 0,

    body: 0,
    bodyFrac: 0,
    bodyAtr: 0,
    upperWick: 0,
    lowerWick: 0,
    volAvg: 0,
    volRatio: 0,
    recentDirection: 0,
    bodyShrinking: false,

    rsi: 0,
    ema50: 0,
    ema200: 0,
    trend: "UNDETERMINED",

    lowerRail: 0,
    upperRail: 0,
  };
}

/** ET wall-clock minutes since 9:30 AM open. Negative before open. */
export function minutesSinceMarketOpen(): number {
  const et = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  return et.getHours() * 60 + et.getMinutes() - (9 * 60 + 30);
}

/** Update per-bar session metrics: minutesSinceOpen, spread, vwap, day range, last. */
export function updateSession(
  bar: Bar,
  f: Features,
  bid: number | null,
  ask: number | null,
  last: number,
  dayHigh: number | null,
  dayLow: number | null,
): void {
  f.minutesSinceOpen = minutesSinceMarketOpen();
  f.last = last;
  f.vwap = bar.vwap; // cumulative VWAP already baked into Bar by the engine
  f.vwapDist = last - bar.vwap;

  if (bid != null && ask != null && bid > 0 && ask > bid) {
    f.spread = ask - bid;
    f.spreadBps = (f.spread / bar.close) * 10_000;
  }

  if (dayHigh != null) f.dayHigh = dayHigh;
  if (dayLow != null) f.dayLow = dayLow;
  const range = f.dayHigh - f.dayLow;
  f.rangePos = range > 0 ? Math.min(1, Math.max(0, (last - f.dayLow) / range)) : 0;
}

/**
 * Consume one bar into the opening range window (legacy ORB setup only).
 * The OR is complete once we've seen cfg.orWindowMinutes bars from 9:30.
 */
export function updateOpeningRange(bars: Bar[], f: Features, cfg: Config): void {
  if (f.orComplete) return;
  const orBars = bars.slice(0, cfg.orWindowMinutes);
  if (orBars.length < cfg.orWindowMinutes) return;

  f.orHigh = Math.max(...orBars.map((b) => b.high));
  f.orLow = Math.min(...orBars.map((b) => b.low));
  f.orRange = f.orHigh - f.orLow;
  f.orComplete = true;
}

/**
 * RVOL = cumulative session volume / expected cumulative volume at this minute,
 * using the historical per-minute volume profile. Reads 0 when no profile is
 * available (the swing setup does not gate on RVOL, so this is non-blocking).
 */
export function updateRVOL(
  bars: Bar[],
  f: Features,
  volProfile: Map<number, number>,
): void {
  if (volProfile.size === 0) {
    f.rvol = 0;
    return;
  }
  const minuteIdx = Math.min(bars.length - 1, MINUTES_PER_SESSION - 1);
  let expected = 0;
  for (let i = 0; i <= minuteIdx; i++) expected += volProfile.get(i) ?? 0;
  const sessionVol = bars.reduce((s, b) => s + b.volume, 0);
  f.rvol = expected > 0 ? sessionVol / expected : 0;
}

/** ATR(14) from 1-minute bars. */
export function updateATR(bars: Bar[], f: Features): void {
  const n = 14;
  if (bars.length < n + 1) return;
  const slice = bars.slice(-(n + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const h = slice[i]!.high;
    const l = slice[i]!.low;
    const pc = slice[i - 1]!.close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  f.atr = sum / n;
}

/** Latest-bar shape: body, wicks, rolling volume, short-term direction. */
export function updateBarShape(bars: Bar[], f: Features, cfg: Config): void {
  const last = bars[bars.length - 1];
  if (!last) return;

  const range = last.high - last.low;
  f.body = last.close - last.open;
  f.bodyFrac = range > 0 ? Math.abs(f.body) / range : 0;
  f.bodyAtr = f.atr > 0 ? Math.abs(f.body) / f.atr : 0;
  f.upperWick = last.high - Math.max(last.open, last.close);
  f.lowerWick = Math.min(last.open, last.close) - last.low;

  const prev = bars[bars.length - 2];
  f.bodyShrinking = prev ? Math.abs(f.body) < Math.abs(prev.close - prev.open) : false;

  // Trailing volume average over the configured window.
  const volWin = bars.slice(-cfg.volAvgWindow);
  f.volAvg = volWin.length ? volWin.reduce((s, b) => s + b.volume, 0) / volWin.length : 0;
  f.volRatio = f.volAvg > 0 ? last.volume / f.volAvg : 0;

  // Short-term direction over the last K bars: mean of close-to-close signs, −1..+1.
  const dirWin = bars.slice(-(cfg.directionLookback + 1));
  if (dirWin.length >= 2) {
    let net = 0;
    for (let i = 1; i < dirWin.length; i++) {
      net += Math.sign(dirWin[i]!.close - dirWin[i - 1]!.close);
    }
    f.recentDirection = net / (dirWin.length - 1);
  } else {
    f.recentDirection = 0;
  }
}

function classifyTrend(last: number, ema50: number, ema200: number): TrendLabel {
  if (!ema50 || !ema200 || !last) return "UNDETERMINED";
  if (last > ema50 && ema50 > ema200) return "BULLISH";
  if (last < ema50 && ema50 < ema200) return "BEARISH";
  if (last > ema200 && last < ema50) return "PULLBACK";
  if (last < ema200 && last > ema50) return "RECOVERY";
  return "MIXED";
}

/** RSI(14), EMA50, EMA200 and a trend label, computed natively from session bars. */
export function updateIndicators(bars: Bar[], f: Features): void {
  const closes = bars.map((b) => b.close);
  const lastClose = closes[closes.length - 1] ?? 0;

  const rsiSeries = closes.length >= 15 ? RSI.calculate({ values: closes, period: 14 }) : [];
  const ema50Series = closes.length >= 50 ? EMA.calculate({ values: closes, period: 50 }) : [];
  const ema200Series = closes.length >= 200 ? EMA.calculate({ values: closes, period: 200 }) : [];

  f.rsi = rsiSeries[rsiSeries.length - 1] ?? 0;
  f.ema50 = ema50Series[ema50Series.length - 1] ?? 0;
  f.ema200 = ema200Series[ema200Series.length - 1] ?? 0;
  f.trend = classifyTrend(lastClose, f.ema50, f.ema200);
  void ATR; // ATR handled in updateATR for parity with the legacy path
}

/** Swing range rails: VWAP ± (vwapBandAtrMult × ATR). */
export function updateRails(f: Features, cfg: Config): void {
  const band = cfg.vwapBandAtrMult * f.atr;
  f.lowerRail = f.vwap - band;
  f.upperRail = f.vwap + band;
}

/**
 * One-call orchestrator: recompute the full feature set from the session bars
 * and the latest quote. Mutates `f` in place.
 */
export function computeFeatures(
  bars: Bar[],
  f: Features,
  cfg: Config,
  quote: { bid: number | null; ask: number | null; last: number | null; high: number | null; low: number | null } | null,
  volProfile: Map<number, number>,
): void {
  const latest = bars[bars.length - 1];
  if (!latest) return;
  const last = quote?.last ?? latest.close;

  updateATR(bars, f);
  updateSession(latest, f, quote?.bid ?? null, quote?.ask ?? null, last, quote?.high ?? null, quote?.low ?? null);
  updateOpeningRange(bars, f, cfg);
  updateRVOL(bars, f, volProfile);
  updateBarShape(bars, f, cfg);
  updateIndicators(bars, f);
  updateRails(f, cfg);
}
