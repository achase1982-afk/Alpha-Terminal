import { db, desc, eq, equityDailyTable } from "@workspace/db";

const BB_PERIOD = 20;
const BB_STDDEV = 2;

/**
 * Classic daily Bollinger Bands: SMA(20) ± 2 × sample standard deviation over the same 20 closes.
 * `closes` must be oldest → newest; uses the last BB_PERIOD values; "current" is the newest close in that window.
 */
export function computeBollingerBands20_2(closesOldestToNewest: number[]): {
  middle: number;
  upper: number;
  lower: number;
  lastClose: number;
  pctB: number | null;
  bandwidthPct: number | null;
} | null {
  const closes = closesOldestToNewest.filter((n) => Number.isFinite(n));
  if (closes.length < BB_PERIOD) return null;
  const window = closes.slice(-BB_PERIOD);
  const lastClose = window[window.length - 1]!;
  const middle = window.reduce((a, b) => a + b, 0) / BB_PERIOD;
  if (!Number.isFinite(middle) || middle <= 0) return null;
  const mean = middle;
  const variance =
    window.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, BB_PERIOD - 1);
  const sd = Math.sqrt(variance);
  const upper = middle + BB_STDDEV * sd;
  const lower = middle - BB_STDDEV * sd;
  const band = upper - lower;
  const pctB = band > 1e-12 ? (lastClose - lower) / band : null;
  const bandwidthPct = middle > 0 ? (band / middle) * 100 : null;
  return {
    middle: Math.round(middle * 100) / 100,
    upper: Math.round(upper * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    lastClose: Math.round(lastClose * 100) / 100,
    pctB: pctB != null ? Math.round(pctB * 1000) / 1000 : null,
    bandwidthPct: bandwidthPct != null ? Math.round(bandwidthPct * 100) / 100 : null,
  };
}

/** One-line summary for the AI chat context pack (equity_daily closes). */
export async function fetchDailyBollinger20Line(sym: string): Promise<string> {
  const rows = await db
    .select({ close: equityDailyTable.close, date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, sym))
    .orderBy(desc(equityDailyTable.date))
    .limit(40);
  if (rows.length < BB_PERIOD) {
    return `BB20_2=n/a (need ≥${BB_PERIOD} daily closes in equity_daily for ${sym}; have ${rows.length})`;
  }
  const chrono = [...rows].reverse();
  const closes = chrono.map((r) => Number(r.close)).filter((n) => Number.isFinite(n));
  if (closes.length < BB_PERIOD) {
    return `BB20_2=n/a (non-numeric closes in equity_daily for ${sym})`;
  }
  const bb = computeBollingerBands20_2(closes);
  if (!bb) return `BB20_2=n/a (could not compute for ${sym})`;
  const asOfRaw = chrono[chrono.length - 1]?.date as unknown;
  const asOf =
    asOfRaw instanceof Date ? asOfRaw.toISOString().slice(0, 10) : String(asOfRaw ?? "");
  let position = "inside_bands";
  if (bb.lastClose > bb.upper) position = "above_upper_band";
  else if (bb.lastClose < bb.lower) position = "below_lower_band";
  return (
    `BB20_2_daily middle=${bb.middle} upper=${bb.upper} lower=${bb.lower} lastClose=${bb.lastClose} `
    + `pctB=${bb.pctB ?? "n/a"} bandwidthPct=${bb.bandwidthPct ?? "n/a"} position=${position} asOfDailyClose=${asOf} `
    + `(SMA${BB_PERIOD} ± ${BB_STDDEV}×sampleStdev on equity_daily closes; not intraday bands)`
  );
}
