import { and, desc, gte, isNotNull, lte } from "drizzle-orm";
import { CATALYSTS_WINDOW_CALENDAR_DAYS } from "@workspace/catalysts-types";
import { catalystEarningsDatesTable, db } from "@workspace/db";
import { addCalendarDaysNy, nyCalendarYmd } from "../usEquityMarketCalendar.js";
import { fetchSchwabEarningsDatesBestToken } from "./schwabEarningsFromQuotes.js";

/** Rows older than this are excluded from Catalysts discovery (staleness guard). */
export const CATALYST_EARNINGS_STALE_DAYS = 10;

export type CatalystDiscoveredEarnings = {
  symbol: string;
  earningsDate: string;
  earningsConfirmed: boolean;
  harvestedAt: string;
};

function staleCutoff(now: Date): Date {
  return new Date(now.getTime() - CATALYST_EARNINGS_STALE_DAYS * 86_400_000);
}

/**
 * Discovery for Catalysts rebuild: Schwab-harvested `catalyst_earnings_dates` only.
 *
 * - Window: next {@link CATALYSTS_WINDOW_CALENDAR_DAYS} calendar days (inclusive).
 * - Drops passed `next_earnings_date` and rows with `harvested_at` older than ~10 days.
 *
 * Catalysts intentionally does not call Benzinga or per-page Schwab here; Strategist/scanner
 * continue to use `earningsService.ts` for per-symbol resolution.
 */
export async function discoverCatalystEarningsInWindow(
  now = new Date(),
): Promise<CatalystDiscoveredEarnings[]> {
  const start = nyCalendarYmd(now);
  const end = addCalendarDaysNy(start, CATALYSTS_WINDOW_CALENDAR_DAYS);
  const harvestedAfter = staleCutoff(now);

  const rows = await db
    .select({
      symbol: catalystEarningsDatesTable.symbol,
      nextEarningsDate: catalystEarningsDatesTable.nextEarningsDate,
      earningsConfirmed: catalystEarningsDatesTable.earningsConfirmed,
      harvestedAt: catalystEarningsDatesTable.harvestedAt,
    })
    .from(catalystEarningsDatesTable)
    .where(
      and(
        isNotNull(catalystEarningsDatesTable.nextEarningsDate),
        gte(catalystEarningsDatesTable.nextEarningsDate, start),
        lte(catalystEarningsDatesTable.nextEarningsDate, end),
        gte(catalystEarningsDatesTable.harvestedAt, harvestedAfter),
      ),
    )
    .orderBy(desc(catalystEarningsDatesTable.nextEarningsDate));

  const out: CatalystDiscoveredEarnings[] = [];
  for (const r of rows) {
    const date = r.nextEarningsDate ? String(r.nextEarningsDate) : null;
    if (!date || date < start) continue;
    out.push({
      symbol: r.symbol.toUpperCase(),
      earningsDate: date,
      earningsConfirmed: r.earningsConfirmed === true,
      harvestedAt: new Date(r.harvestedAt).toISOString(),
    });
  }
  return out;
}

/** Latest harvest timestamp across the earnings table (for rebuild worker health checks). */
export async function latestCatalystEarningsHarvestAt(): Promise<Date | null> {
  const rows = await db
    .select({ harvestedAt: catalystEarningsDatesTable.harvestedAt })
    .from(catalystEarningsDatesTable)
    .orderBy(desc(catalystEarningsDatesTable.harvestedAt))
    .limit(1);
  const t = rows[0]?.harvestedAt;
  return t ? new Date(t) : null;
}
