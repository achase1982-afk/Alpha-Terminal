import { sql, eq, and, gte } from "drizzle-orm";
import { db, corporateEventsTable } from "@workspace/db";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import { getFmpEarningsCalendar } from "./fmpClient.js";
import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Daily FMP earnings calendar backfill for LC130 → corporate_events.
 * Logs via snapshot-style telemetry (DATABASE / INFO|ERROR).
 */
export async function runFmpEarningsBackfill(): Promise<{
  rowsUpserted: number;
  symbolsTouched: number;
  fmpRowsInRange: number;
}> {
  const from = todayUtcYmd();
  const to = addDaysYmd(from, 90);
  const lcSet = new Set(LIQUID_CORE_SYMBOL_STRINGS.map((s) => s.toUpperCase()));

  const calendar = await getFmpEarningsCalendar(from, to);
  const filtered = calendar.filter((r) => lcSet.has(r.symbol));

  let rowsUpserted = 0;
  const symbolsTouched = new Set<string>();

  for (const r of filtered) {
    await db.insert(corporateEventsTable)
      .values({
        symbol: r.symbol,
        earningsDate: r.date,
        earningsTiming: r.time,
        earningsEpsEstimate: r.epsEstimated,
        earningsRevenueEstimate: r.revenueEstimated,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [corporateEventsTable.symbol, corporateEventsTable.earningsDate],
        set: {
          earningsTiming: sql`excluded.earnings_timing`,
          earningsEpsEstimate: sql`excluded.earnings_eps_estimate`,
          earningsRevenueEstimate: sql`excluded.earnings_revenue_estimate`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    rowsUpserted++;
    symbolsTouched.add(r.symbol);
  }

  const summary = {
    rowsUpserted,
    symbolsTouched: symbolsTouched.size,
    fmpRowsInRange: filtered.length,
    from,
    to,
  };

  void logFailure("DATABASE", "INFO", "FMP earnings backfill completed", summary);
  logger.info(summary, "fmp earnings backfill completed");
  return { rowsUpserted, symbolsTouched: symbolsTouched.size, fmpRowsInRange: filtered.length };
}

export type NextEarningsFromDb = {
  earningsDate: string;
  earningsTiming: string | null;
  earningsEpsEstimate: number | null;
  earningsRevenueEstimate: number | null;
};

/**
 * Nearest forward earnings row for a symbol from corporate_events (DB).
 */
export async function getNextForwardEarningsFromDb(symbol: string): Promise<NextEarningsFromDb | null> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return null;

  const today = todayUtcYmd();
  const rows = await db
    .select({
      earningsDate: corporateEventsTable.earningsDate,
      earningsTiming: corporateEventsTable.earningsTiming,
      earningsEpsEstimate: corporateEventsTable.earningsEpsEstimate,
      earningsRevenueEstimate: corporateEventsTable.earningsRevenueEstimate,
    })
    .from(corporateEventsTable)
    .where(
      and(
        eq(corporateEventsTable.symbol, sym),
        gte(corporateEventsTable.earningsDate, today),
      ),
    );

  let best: NextEarningsFromDb | null = null;
  for (const row of rows) {
    const d = row.earningsDate;
    if (!d) continue;
    const ymd = typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (!best || ymd.localeCompare(best.earningsDate) < 0) {
      best = {
        earningsDate: ymd,
        earningsTiming: row.earningsTiming,
        earningsEpsEstimate: row.earningsEpsEstimate,
        earningsRevenueEstimate: row.earningsRevenueEstimate,
      };
    }
  }
  return best;
}
