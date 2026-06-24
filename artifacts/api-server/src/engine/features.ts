/**
 * Pure feature computation — zero I/O, zero side effects.
 * All functions mutate the Features object in-place (call-by-reference) so
 * the engine avoids allocating a new object on every bar.
 */
import type { Bar, Features, Config } from "./types.js";

export function initFeatures(): Features {
  return {
    orHigh: 0,
    orLow: 0,
    orRange: 0,
    orComplete: false,
    rvol: 0,
    atr: 0,
    vwap: 0,
    spread: 0,
    spreadBps: 0,
    minutesSinceOpen: 0,
  };
}

/** ET wall-clock minutes since 9:30 AM open. Negative before open. */
export function minutesSinceMarketOpen(): number {
  const et = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  return et.getHours() * 60 + et.getMinutes() - (9 * 60 + 30);
}

/** Update per-bar session metrics: minutesSinceOpen, spread, vwap. */
export function updateSession(
  bar: Bar,
  f: Features,
  bid: number | null,
  ask: number | null,
): void {
  f.minutesSinceOpen = minutesSinceMarketOpen();

  if (bid != null && ask != null && bid > 0 && ask > bid) {
    f.spread = ask - bid;
    f.spreadBps = (f.spread / bar.close) * 10_000;
  }

  f.vwap = bar.vwap; // cumulative VWAP already baked into Bar by the engine
}

/**
 * Consume one bar into the opening range window.
 * The OR is complete once we've seen cfg.orWindowMinutes bars from 9:30.
 * bars: ALL bars seen this session, in chronological order.
 */
export function updateOpeningRange(bars: Bar[], f: Features, cfg: Config): void {
  if (f.orComplete) return;

  // Opening range bars = first orWindowMinutes bars of the session
  const orBars = bars.slice(0, cfg.orWindowMinutes);
  if (orBars.length < cfg.orWindowMinutes) return;

  f.orHigh = Math.max(...orBars.map((b) => b.high));
  f.orLow  = Math.min(...orBars.map((b) => b.low));
  f.orRange = f.orHigh - f.orLow;
  f.orComplete = true;
}

/**
 * RVOL = cumulative session volume / expected volume at this time.
 * Expected = avgDailyVolume × (minutesElapsed / 390).
 * Uses the per-minute volume profile when available; falls back to the
 * uniform-distribution approximation.
 */
export function updateRVOL(
  bars: Bar[],
  f: Features,
  volProfile: Map<number, number>, // key: minute-of-day (0-based from open), value: avg volume
): void {
  const sessionVol = bars.reduce((s, b) => s + b.volume, 0);
  const minuteIdx  = bars.length - 1;

  if (volProfile.size > 0) {
    // Sum expected volume through the current minute
    let expected = 0;
    for (let i = 0; i <= minuteIdx; i++) {
      expected += volProfile.get(i) ?? 0;
    }
    f.rvol = expected > 0 ? sessionVol / expected : 0;
  } else {
    // Fallback: uniform distribution over 390-minute session
    const fraction = Math.max(0.001, (minuteIdx + 1) / 390);
    f.rvol = 0; // can't compute without avg daily volume — caller must set
    void sessionVol; void fraction; // suppress unused warning
    f.rvol = 0;
  }
}

/**
 * Set RVOL using the simple approximation when no volume profile is available.
 * Call this from the engine when avgDailyVolume is known from the quote.
 */
export function setRvolFromAvgVolume(
  bars: Bar[],
  f: Features,
  avgDailyVolume: number,
): void {
  if (avgDailyVolume <= 0) return;
  const sessionVol = bars.reduce((s, b) => s + b.volume, 0);
  const elapsed    = Math.max(1, bars.length); // minutes elapsed
  const expected   = avgDailyVolume * (elapsed / 390);
  f.rvol = sessionVol / expected;
}

/**
 * ATR(14) from 1-minute bars — true range smoothed over the last 14 bars.
 * dailyBars is the full session bar list; we use the last 15 to get 14 TRs.
 */
export function updateATR(bars: Bar[], f: Features): void {
  const n = 14;
  if (bars.length < n + 1) return;
  const slice = bars.slice(-(n + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const h  = slice[i].high;
    const l  = slice[i].low;
    const pc = slice[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  f.atr = sum / n;
}
