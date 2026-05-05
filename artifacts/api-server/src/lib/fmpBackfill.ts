import { sql } from "drizzle-orm";
import {
  db,
  analystGradesTable,
  analystPriceTargetsTable,
  corporateEventsTable,
  earningsSurprisesHistoryTable,
  macroCalendarTable,
} from "@workspace/db";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import {
  getFmpAnalystGrades,
  getFmpAnalystPriceTargets,
  getFmpEarningsCalendar,
  getFmpEarningsSurprises,
  getFmpEconomicCalendar,
} from "./fmpClient.js";
import { invalidateCalendarEventsCache } from "./calendarEventChecker.js";
import { refreshMacroCalendarCacheFromDb } from "./fmpMacroCalendarCache.js";
import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysUtcYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeFmpEarningsTiming(timeRaw: string | null): { earningsTimeRaw: string | null; earningsTiming: string | null } {
  if (!timeRaw) return { earningsTimeRaw: null, earningsTiming: null };
  const t = timeRaw.trim();
  if (!t) return { earningsTimeRaw: null, earningsTiming: null };
  const lower = t.toLowerCase();
  if (lower === "bmo" || lower.includes("before")) {
    return { earningsTimeRaw: t, earningsTiming: "BMO" };
  }
  if (lower === "amc" || lower.includes("after")) {
    return { earningsTimeRaw: t, earningsTiming: "AMC" };
  }
  if (/^\d{1,2}:\d{2}/.test(t)) {
    const hour = parseInt(t.split(":")[0]!, 10);
    if (Number.isFinite(hour)) {
      if (hour < 10) return { earningsTimeRaw: t, earningsTiming: "BMO" };
      if (hour >= 16) return { earningsTimeRaw: t, earningsTiming: "AMC" };
      return { earningsTimeRaw: t, earningsTiming: t.slice(0, 5) };
    }
  }
  return { earningsTimeRaw: t, earningsTiming: t };
}

const lcSet = () => new Set(LIQUID_CORE_SYMBOL_STRINGS.map((s) => s.toUpperCase()));

/**
 * FMP earnings calendar → `corporate_events` for Liquid Core 130 (next 90 days).
 */
export async function backfillEarningsCalendar(): Promise<{
  rowsUpserted: number;
  symbolsTouched: number;
  fmpRowsInRange: number;
}> {
  const from = todayUtcYmd();
  const to = addDaysUtcYmd(from, 90);
  const set = lcSet();

  const calendar = await getFmpEarningsCalendar(from, to);
  const filtered = calendar.filter((r) => set.has(r.symbol));

  let rowsUpserted = 0;
  const symbolsTouched = new Set<string>();

  for (const r of filtered) {
    const { earningsTimeRaw, earningsTiming } = normalizeFmpEarningsTiming(r.time);
    await db.insert(corporateEventsTable)
      .values({
        symbol: r.symbol,
        earningsDate: r.date,
        earningsTiming,
        earningsTimeRaw,
        earningsEpsEstimate: r.epsEstimated,
        earningsRevenueEstimate: r.revenueEstimated,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [corporateEventsTable.symbol, corporateEventsTable.earningsDate],
        set: {
          earningsTiming: sql`excluded.earnings_timing`,
          earningsTimeRaw: sql`excluded.earnings_time_raw`,
          earningsEpsEstimate: sql`excluded.earnings_eps_estimate`,
          earningsRevenueEstimate: sql`excluded.earnings_revenue_estimate`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    rowsUpserted++;
    symbolsTouched.add(r.symbol);
  }

  const summary = {
    job: "backfillEarningsCalendar",
    rowsUpserted,
    symbolsTouched: symbolsTouched.size,
    fmpRowsInRange: filtered.length,
    from,
    to,
  };
  void logFailure("DATABASE", "INFO", "fmp backfill completed", summary);
  logger.info(summary, "fmp backfill completed");
  return { rowsUpserted, symbolsTouched: symbolsTouched.size, fmpRowsInRange: filtered.length };
}

export async function backfillAnalystPriceTargets(): Promise<{ rowsUpserted: number }> {
  const set = lcSet();
  const asOf = todayUtcYmd();
  let rowsUpserted = 0;

  for (const sym of set) {
    const row = await getFmpAnalystPriceTargets(sym);
    if (!row) continue;

    await db.insert(analystPriceTargetsTable)
      .values({
        ticker: sym,
        targetHigh: row.targetHigh != null ? String(row.targetHigh) : null,
        targetLow: row.targetLow != null ? String(row.targetLow) : null,
        targetMedian: row.targetMedian != null ? String(row.targetMedian) : null,
        targetConsensus: row.targetConsensus != null ? String(row.targetConsensus) : null,
        numAnalysts: row.numAnalysts,
        asOfDate: asOf,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: analystPriceTargetsTable.ticker,
        set: {
          targetHigh: sql`excluded.target_high`,
          targetLow: sql`excluded.target_low`,
          targetMedian: sql`excluded.target_median`,
          targetConsensus: sql`excluded.target_consensus`,
          numAnalysts: sql`excluded.num_analysts`,
          asOfDate: sql`excluded.as_of_date`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    rowsUpserted++;
  }

  const summary = { job: "backfillAnalystPriceTargets", rowsUpserted };
  void logFailure("DATABASE", "INFO", "fmp backfill completed", summary);
  logger.info(summary, "fmp backfill completed");
  return { rowsUpserted };
}

export async function backfillAnalystGrades(): Promise<{ rowsAttempted: number }> {
  const set = lcSet();
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - 30);

  let rowsAttempted = 0;

  for (const sym of set) {
    const grades = await getFmpAnalystGrades(sym, fromDate);
    for (const g of grades) {
      await db.insert(analystGradesTable)
        .values({
          ticker: sym,
          actionDate: g.date,
          action: g.action,
          gradingCompany: g.gradingCompany ?? "Unknown firm",
          previousGrade: g.previousGrade,
          newGrade: g.newGrade,
          createdAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [
            analystGradesTable.ticker,
            analystGradesTable.actionDate,
            analystGradesTable.gradingCompany,
            analystGradesTable.action,
          ],
          set: {
            previousGrade: sql`excluded.previous_grade`,
            newGrade: sql`excluded.new_grade`,
            createdAt: sql`excluded.created_at`,
          },
        });
      rowsAttempted++;
    }
  }

  const summary = { job: "backfillAnalystGrades", rowsAttempted };
  void logFailure("DATABASE", "INFO", "fmp backfill completed", summary);
  logger.info(summary, "fmp backfill completed");
  return { rowsAttempted };
}

export async function backfillEconomicCalendar(): Promise<{ rowsUpserted: number }> {
  const from = todayUtcYmd();
  const to = addDaysUtcYmd(from, 60);
  const rows = await getFmpEconomicCalendar(from, to, "US");

  let rowsUpserted = 0;
  for (const r of rows) {
    await db.insert(macroCalendarTable)
      .values({
        eventDate: r.date,
        eventTime: r.eventTime,
        country: r.country,
        event: r.event,
        impact: r.impact,
        actual: r.actual != null ? String(r.actual) : null,
        previous: r.previous != null ? String(r.previous) : null,
        estimate: r.estimate != null ? String(r.estimate) : null,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          macroCalendarTable.eventDate,
          macroCalendarTable.country,
          macroCalendarTable.event,
        ],
        set: {
          eventTime: sql`excluded.event_time`,
          impact: sql`excluded.impact`,
          actual: sql`excluded.actual`,
          previous: sql`excluded.previous`,
          estimate: sql`excluded.estimate`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    rowsUpserted++;
  }

  await refreshMacroCalendarCacheFromDb();
  invalidateCalendarEventsCache();

  const summary = { job: "backfillEconomicCalendar", rowsUpserted, from, to };
  void logFailure("DATABASE", "INFO", "fmp backfill completed", summary);
  logger.info(summary, "fmp backfill completed");
  return { rowsUpserted };
}

export async function backfillEarningsSurprises(): Promise<{ rowsUpserted: number }> {
  const set = lcSet();
  let rowsUpserted = 0;

  for (const sym of set) {
    const surprises = await getFmpEarningsSurprises(sym, 8);
    for (const s of surprises) {
      const surprisePct =
        s.surprisePercentage != null && Number.isFinite(s.surprisePercentage)
          ? String(s.surprisePercentage)
          : null;
      await db.insert(earningsSurprisesHistoryTable)
        .values({
          ticker: sym,
          reportDate: s.date,
          epsEstimate: s.epsEstimated != null ? String(s.epsEstimated) : null,
          epsActual: s.epsActual != null ? String(s.epsActual) : null,
          surprisePct,
          createdAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [earningsSurprisesHistoryTable.ticker, earningsSurprisesHistoryTable.reportDate],
          set: {
            epsEstimate: sql`excluded.eps_estimate`,
            epsActual: sql`excluded.eps_actual`,
            surprisePct: sql`excluded.surprise_pct`,
            createdAt: sql`excluded.created_at`,
          },
        });
      rowsUpserted++;
    }
  }

  const summary = { job: "backfillEarningsSurprises", rowsUpserted };
  void logFailure("DATABASE", "INFO", "fmp backfill completed", summary);
  logger.info(summary, "fmp backfill completed");
  return { rowsUpserted };
}
