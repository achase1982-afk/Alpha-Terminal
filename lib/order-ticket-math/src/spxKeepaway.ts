export type DailyOhlc = {
  high: number;
  low: number;
  close: number;
};

export type SpxKeepawaySideStats = {
  median: number;
  mean: number;
};

export type SpxKeepawayStats = {
  symbol: "SPX";
  n: number;
  startYmd: string;
  endYmd: string;
  lowSide: SpxKeepawaySideStats;
  highSide: SpxKeepawaySideStats;
};

function median(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Daily keep-away coefficients from Schwab-style daily candles (2026 YTD window).
 * lowSide = distribution of (close - low); highSide = distribution of (high - close).
 */
export function computeSpxKeepawayFromDailyCandles(
  candles: DailyOhlc[],
  meta: { startYmd: string; endYmd: string },
): SpxKeepawayStats | null {
  const lowSpreads: number[] = [];
  const highSpreads: number[] = [];
  for (const c of candles) {
    if (
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      c.high < c.low
    ) {
      continue;
    }
    const lowSpr = c.close - c.low;
    const highSpr = c.high - c.close;
    if (lowSpr >= 0 && Number.isFinite(lowSpr)) lowSpreads.push(lowSpr);
    if (highSpr >= 0 && Number.isFinite(highSpr)) highSpreads.push(highSpr);
  }
  if (lowSpreads.length < 20 || highSpreads.length < 20) return null;
  const lowSorted = [...lowSpreads].sort((a, b) => a - b);
  const highSorted = [...highSpreads].sort((a, b) => a - b);
  return {
    symbol: "SPX",
    n: lowSpreads.length,
    startYmd: meta.startYmd,
    endYmd: meta.endYmd,
    lowSide: { median: median(lowSorted), mean: mean(lowSpreads) },
    highSide: { median: median(highSorted), mean: mean(highSpreads) },
  };
}

/** SPX strike grid: floor put boundary, ceil call boundary on 5-pt increments. */
export function roundKeepawayPutLine(raw: number): number {
  return Math.floor(raw / 5) * 5;
}

export function roundKeepawayCallLine(raw: number): number {
  return Math.ceil(raw / 5) * 5;
}

export function spxKeepawayBoundary(
  stats: SpxKeepawayStats,
  side: "put" | "call",
  sessionLow: number,
  sessionHigh: number,
  useMean: boolean,
): number | null {
  if (!Number.isFinite(sessionLow) || !Number.isFinite(sessionHigh)) return null;
  const k =
    side === "put"
      ? useMean
        ? stats.lowSide.mean
        : stats.lowSide.median
      : useMean
        ? stats.highSide.mean
        : stats.highSide.median;
  if (!Number.isFinite(k)) return null;
  const raw = side === "put" ? sessionLow - k : sessionHigh + k;
  return side === "put" ? roundKeepawayPutLine(raw) : roundKeepawayCallLine(raw);
}

export function isSpxSymbol(sym: string): boolean {
  const u = sym.replace(/^\$/, "").trim().toUpperCase();
  return u === "SPX" || u === "SPXW";
}