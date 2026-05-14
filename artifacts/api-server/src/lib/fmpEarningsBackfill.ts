import { eq, and, gte } from "@workspace/db";
import { db, corporateEventsTable } from "@workspace/db";

export { backfillEarningsCalendar as runFmpEarningsBackfill } from "./fmpBackfill.js";

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
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
