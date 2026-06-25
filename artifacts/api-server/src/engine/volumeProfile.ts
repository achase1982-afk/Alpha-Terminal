/**
 * Historical per-minute volume profile.
 *
 * Builds the "normal" intraday volume curve for a symbol from persisted
 * 1-minute bars (schwab_chart_equity_bars). The result maps each minute index
 * since the 9:30 ET open (0–389) to the average single-minute volume observed
 * at that minute across the lookback window of past sessions.
 *
 * RVOL then compares today's *cumulative* volume at the current minute against
 * the cumulative sum of this profile through the same minute — a real baseline,
 * not the circular "today vs. today" calc it replaces.
 */
import { db, and, eq, gte } from "@workspace/db";
import { schwabChartEquityBarsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger.js";

const MINUTES_PER_SESSION = 390; // 9:30 → 16:00 ET

/** Minute index since the 9:30 ET open for an epoch-ms timestamp (−1 if outside RTH). */
function minuteIndexET(barTimeMs: number): number {
  const et = new Date(new Date(barTimeMs).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const idx = et.getHours() * 60 + et.getMinutes() - (9 * 60 + 30);
  return idx >= 0 && idx < MINUTES_PER_SESSION ? idx : -1;
}

/** ET calendar date (YYYY-MM-DD) `lookbackDays` ago, for the SQL session_date filter. */
function cutoffSessionDate(lookbackDays: number): string {
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(cutoffMs));
}

/**
 * Build the per-minute average-volume profile for one symbol.
 * Returns an empty map when no history is available (caller falls back to RVOL = 0,
 * and the swing setup does not gate on RVOL, so trading still proceeds).
 */
export async function buildVolumeProfile(
  symbol: string,
  lookbackDays: number,
): Promise<Map<number, number>> {
  const profile = new Map<number, number>();
  try {
    const rows = await db
      .select({
        barTimeMs: schwabChartEquityBarsTable.barTimeMs,
        volume: schwabChartEquityBarsTable.volume,
      })
      .from(schwabChartEquityBarsTable)
      .where(
        and(
          eq(schwabChartEquityBarsTable.symbol, symbol.toUpperCase()),
          gte(schwabChartEquityBarsTable.sessionDate, cutoffSessionDate(lookbackDays)),
        ),
      );

    // Sum volume and count sessions contributing to each minute index.
    const sum = new Map<number, number>();
    const count = new Map<number, number>();
    for (const row of rows) {
      const idx = minuteIndexET(row.barTimeMs);
      if (idx < 0) continue;
      const vol = Number(row.volume);
      if (!Number.isFinite(vol)) continue;
      sum.set(idx, (sum.get(idx) ?? 0) + vol);
      count.set(idx, (count.get(idx) ?? 0) + 1);
    }

    for (const [idx, total] of sum) {
      const n = count.get(idx) ?? 0;
      if (n > 0) profile.set(idx, total / n);
    }

    logger.info(
      { symbol, minutes: profile.size, rows: rows.length, lookbackDays },
      "[engine] volume profile built",
    );
  } catch (err) {
    logger.error({ err, symbol }, "[engine] volume profile build failed — RVOL will read 0");
  }
  return profile;
}
