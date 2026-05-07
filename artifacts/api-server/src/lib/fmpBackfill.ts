import { sql } from "drizzle-orm";
import {
  db,
  analystEstimatesTable,
  analystGradesTable,
  analystPriceTargetsTable,
  corporateEventsTable,
  earningsSurprisesHistoryTable,
  equityDailyTable,
  macroCalendarTable,
} from "@workspace/db";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import {
  getFmpAnalystEstimatesQuarterly,
  getFmpEarningsCalendar,
  getFmpEarningsSurprises,
  getFmpEconomicCalendar,
  getFmpHistoricalPriceEodFull,
  getFmpAnalystGrades,
  getFmpAnalystPriceTargets,
  getFmpStockSplits,
  type FmpEarningsSurpriseRow,
} from "./fmpClient.js";
import { invalidateCalendarEventsCache } from "./calendarEventChecker.js";
import { refreshMacroCalendarCacheFromDb } from "./fmpMacroCalendarCache.js";
import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

async function upsertCorporateEarningsFromCalendarRow(r: {
  symbol: string;
  date: string;
  time: string | null;
  epsEstimated: number | null;
  revenueEstimated: number | null;
  epsActual?: number | null;
  revenueActual?: number | null;
}): Promise<void> {
  const { earningsTimeRaw, earningsTiming } = normalizeFmpEarningsTiming(r.time);
  await db
    .insert(corporateEventsTable)
    .values({
      symbol: r.symbol,
      earningsDate: r.date,
      earningsTiming,
      earningsTimeRaw,
      earningsEpsEstimate: r.epsEstimated,
      earningsRevenueEstimate: r.revenueEstimated,
      earningsEpsActual: r.epsActual ?? null,
      earningsRevenueActual: r.revenueActual ?? null,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [corporateEventsTable.symbol, corporateEventsTable.earningsDate],
      set: {
        earningsTiming: sql`excluded.earnings_timing`,
        earningsTimeRaw: sql`excluded.earnings_time_raw`,
        earningsEpsEstimate: sql`excluded.earnings_eps_estimate`,
        earningsRevenueEstimate: sql`excluded.earnings_revenue_estimate`,
        earningsEpsActual: sql`excluded.earnings_eps_actual`,
        earningsRevenueActual: sql`excluded.earnings_revenue_actual`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
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
    await upsertCorporateEarningsFromCalendarRow(r);
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
    const surprises = await getFmpEarningsSurprises(sym, 100);
    for (const s of surprises) {
      const surprisePct =
        s.surprisePercentage != null && Number.isFinite(s.surprisePercentage)
          ? String(s.surprisePercentage)
          : null;
      const revenueSurprisePct =
        s.revenueSurprisePct != null && Number.isFinite(s.revenueSurprisePct)
          ? String(s.revenueSurprisePct)
          : null;
      await db.insert(earningsSurprisesHistoryTable)
        .values({
          ticker: sym,
          reportDate: s.date,
          epsEstimate: s.epsEstimated != null ? String(s.epsEstimated) : null,
          epsActual: s.epsActual != null ? String(s.epsActual) : null,
          surprisePct,
          revenueEstimate: s.revenueEstimated != null ? String(s.revenueEstimated) : null,
          revenueActual: s.revenueActual != null ? String(s.revenueActual) : null,
          revenueSurprisePct,
          createdAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [earningsSurprisesHistoryTable.ticker, earningsSurprisesHistoryTable.reportDate],
          set: {
            epsEstimate: sql`excluded.eps_estimate`,
            epsActual: sql`excluded.eps_actual`,
            surprisePct: sql`excluded.surprise_pct`,
            revenueEstimate: sql`excluded.revenue_estimate`,
            revenueActual: sql`excluded.revenue_actual`,
            revenueSurprisePct: sql`excluded.revenue_surprise_pct`,
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

const EQUITY_HISTORY_FROM = "2021-01-01";

export async function backfillEquityDailyHistory(): Promise<{
  rowsInserted: number;
  symbolsAttempted: number;
  failures: Array<{ symbol: string; error: string }>;
}> {
  const set = lcSet();
  const to = todayUtcYmd();
  let rowsInserted = 0;
  const failures: Array<{ symbol: string; error: string }> = [];

  for (const sym of set) {
    try {
      const bars = await getFmpHistoricalPriceEodFull(sym, EQUITY_HISTORY_FROM, to);
      const values: Array<typeof equityDailyTable.$inferInsert> = [];
      for (const b of bars) {
        const close = b.close;
        if (close == null || !Number.isFinite(close)) continue;
        const vol = b.volume != null && Number.isFinite(b.volume) ? Math.round(b.volume) : null;
        /** FMP full EOD: OHLC are split-adjusted; no adjClose field — mirror close for adjusted_close (Option A). */
        values.push({
          symbol: sym,
          date: b.date,
          open: b.open ?? null,
          high: b.high ?? null,
          low: b.low ?? null,
          close,
          adjustedClose: close,
          volume: vol,
        });
      }
      for (const batch of chunkArray(values, 400)) {
        if (batch.length === 0) continue;
        const result = await db.insert(equityDailyTable).values(batch).onConflictDoNothing({
          target: [equityDailyTable.symbol, equityDailyTable.date],
        });
        const rc = (result as { rowCount?: number }).rowCount;
        if (typeof rc === "number" && rc > 0) rowsInserted += rc;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ symbol: sym, error: msg });
      logger.warn({ sym, err: msg }, "backfillEquityDailyHistory: symbol failed");
    }
  }

  const summary = {
    job: "backfillEquityDailyHistory",
    rowsInserted,
    symbolsAttempted: set.size,
    failureCount: failures.length,
    from: EQUITY_HISTORY_FROM,
    to,
  };
  void logFailure("DATABASE", "INFO", "fmp backfill completed", summary);
  logger.info(summary, "fmp backfill completed");
  return { rowsInserted, symbolsAttempted: set.size, failures };
}

export async function backfillAnalystEstimates(): Promise<{
  rowsUpserted: number;
  symbolsWithNoData: number;
}> {
  const set = lcSet();
  let rowsUpserted = 0;
  let symbolsWithNoData = 0;

  for (const sym of set) {
    const rows = await getFmpAnalystEstimatesQuarterly(sym, { page: 0, limit: 12 });
    if (rows.length === 0) {
      symbolsWithNoData++;
      continue;
    }
    for (const r of rows) {
      await db.insert(analystEstimatesTable)
        .values({
          ticker: sym,
          fiscalPeriodEnd: r.fiscalPeriodEnd,
          epsAvg: r.epsAvg != null ? String(r.epsAvg) : null,
          epsHigh: r.epsHigh != null ? String(r.epsHigh) : null,
          epsLow: r.epsLow != null ? String(r.epsLow) : null,
          revenueAvg: r.revenueAvg != null ? String(r.revenueAvg) : null,
          revenueHigh: r.revenueHigh != null ? String(r.revenueHigh) : null,
          revenueLow: r.revenueLow != null ? String(r.revenueLow) : null,
          analystCountEps: r.analystCountEps != null ? Math.round(r.analystCountEps) : null,
          analystCountRevenue: r.analystCountRevenue != null ? Math.round(r.analystCountRevenue) : null,
          createdAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [analystEstimatesTable.ticker, analystEstimatesTable.fiscalPeriodEnd],
          set: {
            epsAvg: sql`excluded.eps_avg`,
            epsHigh: sql`excluded.eps_high`,
            epsLow: sql`excluded.eps_low`,
            revenueAvg: sql`excluded.revenue_avg`,
            revenueHigh: sql`excluded.revenue_high`,
            revenueLow: sql`excluded.revenue_low`,
            analystCountEps: sql`excluded.analyst_count_eps`,
            analystCountRevenue: sql`excluded.analyst_count_revenue`,
            createdAt: sql`excluded.created_at`,
          },
        });
      rowsUpserted++;
    }
  }

  const summary = { job: "backfillAnalystEstimates", rowsUpserted, symbolsWithNoData };
  void logFailure("DATABASE", "INFO", "fmp backfill completed", summary);
  logger.info(summary, "fmp backfill completed");
  return { rowsUpserted, symbolsWithNoData };
}

async function upsertCorporateEarningsFromSurpriseMerge(sym: string, s: FmpEarningsSurpriseRow): Promise<void> {
  await db
    .insert(corporateEventsTable)
    .values({
      symbol: sym,
      earningsDate: s.date,
      earningsEpsEstimate: s.epsEstimated,
      earningsEpsActual: s.epsActual,
      earningsRevenueEstimate: s.revenueEstimated,
      earningsRevenueActual: s.revenueActual,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [corporateEventsTable.symbol, corporateEventsTable.earningsDate],
      set: {
        earningsEpsEstimate: sql`COALESCE(excluded.earnings_eps_estimate, corporate_events.earnings_eps_estimate)`,
        earningsRevenueEstimate: sql`COALESCE(excluded.earnings_revenue_estimate, corporate_events.earnings_revenue_estimate)`,
        earningsEpsActual: sql`COALESCE(excluded.earnings_eps_actual, corporate_events.earnings_eps_actual)`,
        earningsRevenueActual: sql`COALESCE(excluded.earnings_revenue_actual, corporate_events.earnings_revenue_actual)`,
        earningsTiming: sql`COALESCE(corporate_events.earnings_timing, excluded.earnings_timing)`,
        earningsTimeRaw: sql`COALESCE(corporate_events.earnings_time_raw, excluded.earnings_time_raw)`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

/**
 * Scoped `corporate_events` sync for tuning symbols: chunked earnings-calendar (symbol filter),
 * merged `/earnings` actuals, and split-only rows (FMP splits → corporate_events.split_*).
 */
export async function syncCorporateEventsForTuningSymbol(symbol: string): Promise<{
  calendarUpserts: number;
  surpriseUpserts: number;
  splitUpserts: number;
}> {
  const sym = symbol.toUpperCase().trim();
  const horizonStart = addDaysUtcYmd(todayUtcYmd(), -365 * 5 - 45);
  const horizonEnd = addDaysUtcYmd(todayUtcYmd(), 180);
  let calendarUpserts = 0;
  let cur = horizonStart;
  while (cur <= horizonEnd) {
    const chunkEnd = addDaysUtcYmd(cur, 88);
    const end = chunkEnd > horizonEnd ? horizonEnd : chunkEnd;
    const rows = await getFmpEarningsCalendar(cur, end, { symbol: sym });
    for (const r of rows) {
      if (r.symbol !== sym) continue;
      await upsertCorporateEarningsFromCalendarRow(r);
      calendarUpserts++;
    }
    cur = addDaysUtcYmd(end, 1);
  }

  const surprises = await getFmpEarningsSurprises(sym, 100);
  let surpriseUpserts = 0;
  for (const s of surprises) {
    await upsertCorporateEarningsFromSurpriseMerge(sym, s);
    surpriseUpserts++;
  }

  const splitRows = await getFmpStockSplits(sym);
  let splitUpserts = 0;
  for (const sp of splitRows) {
    if (sp.symbol !== sym || sp.date < horizonStart) continue;
    await db.execute(sql`
      INSERT INTO corporate_events (symbol, earnings_date, split_date, split_ratio, updated_at)
      VALUES (${sym}, NULL, ${sp.date}, ${sp.label}, NOW())
      ON CONFLICT (symbol, split_date) WHERE earnings_date IS NULL AND split_date IS NOT NULL
      DO UPDATE SET
        split_ratio = EXCLUDED.split_ratio,
        updated_at = EXCLUDED.updated_at
    `);
    splitUpserts++;
  }

  invalidateCalendarEventsCache();
  return { calendarUpserts, surpriseUpserts, splitUpserts };
}
