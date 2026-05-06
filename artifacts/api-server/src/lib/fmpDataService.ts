import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  analystGradesTable,
  analystPriceTargetsTable,
  corporateEventsTable,
  earningsSurprisesHistoryTable,
  macroCalendarTable,
} from "@workspace/db";

const CORP_STALE_MS = 24 * 60 * 60 * 1000;

export type ForwardCorporateEarnings = {
  earningsDate: string;
  earningsTiming: string | null;
  earningsTimeRaw: string | null;
  earningsEpsEstimate: number | null;
  earningsRevenueEstimate: number | null;
  updatedAt: Date | null;
  stale: boolean;
};

function ymdFromDateCol(d: unknown): string | null {
  if (d == null) return null;
  if (typeof d === "string") {
    const y = d.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(y) ? y : null;
  }
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
}

/**
 * Next forward `corporate_events` earnings row for a symbol.
 * `stale` is true when `updated_at` is missing or older than 24 hours (caller may fall back to live APIs).
 */
export async function getForwardCorporateEarningsWithFreshness(symbol: string): Promise<ForwardCorporateEarnings | null> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return null;

  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      earningsDate: corporateEventsTable.earningsDate,
      earningsTiming: corporateEventsTable.earningsTiming,
      earningsTimeRaw: corporateEventsTable.earningsTimeRaw,
      earningsEpsEstimate: corporateEventsTable.earningsEpsEstimate,
      earningsRevenueEstimate: corporateEventsTable.earningsRevenueEstimate,
      updatedAt: corporateEventsTable.updatedAt,
    })
    .from(corporateEventsTable)
    .where(and(eq(corporateEventsTable.symbol, sym), gte(corporateEventsTable.earningsDate, today)));

  let best: (typeof rows)[0] | null = null;
  let bestYmd: string | null = null;
  for (const row of rows) {
    const ymd = ymdFromDateCol(row.earningsDate);
    if (!ymd) continue;
    if (!bestYmd || ymd.localeCompare(bestYmd) < 0) {
      best = row;
      bestYmd = ymd;
    }
  }
  if (!best || !bestYmd) return null;

  const uAt = best.updatedAt;
  const updatedMs = uAt instanceof Date ? uAt.getTime() : uAt ? new Date(String(uAt)).getTime() : NaN;
  const stale = !Number.isFinite(updatedMs) || Date.now() - updatedMs > CORP_STALE_MS;

  return {
    earningsDate: bestYmd,
    earningsTiming: best.earningsTiming,
    earningsTimeRaw: best.earningsTimeRaw,
    earningsEpsEstimate: best.earningsEpsEstimate,
    earningsRevenueEstimate: best.earningsRevenueEstimate,
    updatedAt: uAt instanceof Date ? uAt : uAt ? new Date(String(uAt)) : null,
    stale,
  };
}

export type AnalystPriceTargetsRow = {
  ticker: string;
  targetHigh: number | null;
  targetLow: number | null;
  targetMedian: number | null;
  targetConsensus: number | null;
  numAnalysts: number | null;
  asOfDate: string | null;
  updatedAt: Date | null;
};

function numFromNumeric(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getAnalystPriceTargets(ticker: string): Promise<AnalystPriceTargetsRow | null> {
  const sym = (ticker || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return null;

  const rows = await db
    .select()
    .from(analystPriceTargetsTable)
    .where(eq(analystPriceTargetsTable.ticker, sym))
    .limit(1);
  const r = rows[0];
  if (!r) return null;

  const asOfUnknown = r.asOfDate as string | Date | null | undefined;
  const asOfStr =
    asOfUnknown == null
      ? null
      : typeof asOfUnknown === "string"
        ? asOfUnknown.slice(0, 10)
        : asOfUnknown instanceof Date
          ? asOfUnknown.toISOString().slice(0, 10)
          : String(asOfUnknown).slice(0, 10);

  return {
    ticker: r.ticker,
    targetHigh: numFromNumeric(r.targetHigh),
    targetLow: numFromNumeric(r.targetLow),
    targetMedian: numFromNumeric(r.targetMedian),
    targetConsensus: numFromNumeric(r.targetConsensus),
    numAnalysts: r.numAnalysts,
    asOfDate: asOfStr,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt : r.updatedAt ? new Date(String(r.updatedAt)) : null,
  };
}

export type AnalystGradeDbRow = {
  ticker: string;
  actionDate: string;
  action: string;
  gradingCompany: string | null;
  previousGrade: string | null;
  newGrade: string | null;
};

export async function getRecentAnalystGrades(ticker: string, daysBack: number): Promise<AnalystGradeDbRow[]> {
  const sym = (ticker || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const days = Math.max(1, Math.min(365, Math.floor(daysBack)));
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffYmd = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select({
      ticker: analystGradesTable.ticker,
      actionDate: analystGradesTable.actionDate,
      action: analystGradesTable.action,
      gradingCompany: analystGradesTable.gradingCompany,
      previousGrade: analystGradesTable.previousGrade,
      newGrade: analystGradesTable.newGrade,
    })
    .from(analystGradesTable)
    .where(and(eq(analystGradesTable.ticker, sym), gte(analystGradesTable.actionDate, cutoffYmd)))
    .orderBy(desc(analystGradesTable.actionDate))
    .limit(40);

  return rows.map((r) => ({
    ticker: r.ticker,
    actionDate: ymdFromDateCol(r.actionDate) ?? "",
    action: r.action,
    gradingCompany: r.gradingCompany,
    previousGrade: r.previousGrade,
    newGrade: r.newGrade,
  }));
}

export type EarningsSurpriseDbRow = {
  reportDate: string;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  revenueSurprisePct: number | null;
};

export async function getEarningsSurpriseHistory(ticker: string, limit = 8): Promise<EarningsSurpriseDbRow[]> {
  const sym = (ticker || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const lim = Math.max(1, Math.min(32, limit));
  const rows = await db
    .select({
      reportDate: earningsSurprisesHistoryTable.reportDate,
      epsEstimate: earningsSurprisesHistoryTable.epsEstimate,
      epsActual: earningsSurprisesHistoryTable.epsActual,
      surprisePct: earningsSurprisesHistoryTable.surprisePct,
      revenueEstimate: earningsSurprisesHistoryTable.revenueEstimate,
      revenueActual: earningsSurprisesHistoryTable.revenueActual,
      revenueSurprisePct: earningsSurprisesHistoryTable.revenueSurprisePct,
    })
    .from(earningsSurprisesHistoryTable)
    .where(eq(earningsSurprisesHistoryTable.ticker, sym))
    .orderBy(desc(earningsSurprisesHistoryTable.reportDate))
    .limit(lim);

  return rows
    .map((r) => {
      const ymd = ymdFromDateCol(r.reportDate);
      if (!ymd) return null;
      return {
        reportDate: ymd,
        epsEstimate: numFromNumeric(r.epsEstimate),
        epsActual: numFromNumeric(r.epsActual),
        surprisePct: numFromNumeric(r.surprisePct),
        revenueEstimate: numFromNumeric(r.revenueEstimate),
        revenueActual: numFromNumeric(r.revenueActual),
        revenueSurprisePct: numFromNumeric(r.revenueSurprisePct),
      };
    })
    .filter((x): x is EarningsSurpriseDbRow => x != null);
}

export type MacroCalendarDbRow = {
  eventDate: string;
  eventTime: string | null;
  country: string;
  event: string;
  impact: string | null;
};

/** US macro rows from `macro_calendar` between today and `toYmd` inclusive. */
export async function getMacroCalendarRowsInRange(toYmd: string): Promise<MacroCalendarDbRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  if (toYmd < today) return [];

  const rows = await db
    .select({
      eventDate: macroCalendarTable.eventDate,
      eventTime: macroCalendarTable.eventTime,
      country: macroCalendarTable.country,
      event: macroCalendarTable.event,
      impact: macroCalendarTable.impact,
    })
    .from(macroCalendarTable)
    .where(
      and(
        gte(macroCalendarTable.eventDate, today),
        lte(macroCalendarTable.eventDate, toYmd),
        eq(macroCalendarTable.country, "US"),
      ),
    )
    .orderBy(macroCalendarTable.eventDate);

  return rows.map((r) => ({
    eventDate: ymdFromDateCol(r.eventDate) ?? "",
    eventTime: r.eventTime,
    country: r.country,
    event: r.event,
    impact: r.impact,
  }));
}
