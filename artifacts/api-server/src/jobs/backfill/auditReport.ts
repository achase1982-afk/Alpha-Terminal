import {
  backfillAuditRunsTable,
  corporateEventsTable,
  db,
  dividendsTable,
  earningsReactionsTable,
  equityDailyTable,
  optionsDailyTable,
} from "@workspace/db";
import { and, count, eq, gte, isNotNull, like, or } from "drizzle-orm";

export type AuditStatus = "ok" | "ok_empty" | "warn" | "fail";

export interface SymbolAuditJson {
  equity_daily: { rows: number; expected_min: number; status: AuditStatus };
  hv_coverage: {
    rows_with_hv20: number;
    rows_with_hv30: number;
    rows_with_hv60: number;
    status: AuditStatus;
  };
  dividends: { rows: number; status: AuditStatus };
  corporate_events_earnings: { rows: number; expected_min: number; status: AuditStatus };
  corporate_events_splits: { rows: number; status: AuditStatus };
  eps_estimate_coverage: { filled: number; total: number; pct: number; status: AuditStatus };
  eps_actual_coverage: { filled: number; total: number; pct: number; status: AuditStatus };
  revenue_estimate_coverage: { filled: number; total: number; pct: number; status: AuditStatus };
  revenue_actual_coverage: { filled: number; total: number; pct: number; status: AuditStatus };
  options_daily: { rows: number; contracts_processed: number; status: AuditStatus };
  earnings_reactions: { rows: number; expected_min: number; status: AuditStatus };
  /** True when FMP returned HTTP 402 on premium historical endpoints (/earnings or /splits). */
  fmp_premium_historical_unavailable: boolean;
}

function pct(filled: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((filled / total) * 1000) / 10;
}

function covStatus(filled: number, total: number, warnBelowPct: number): AuditStatus {
  if (total <= 0) return "warn";
  const p = (filled / total) * 100;
  return p < warnBelowPct ? "warn" : "ok";
}

export async function buildSymbolAudit(params: {
  symbol: string;
  fiveYearCutoffYmd: string;
  optionsContractsProcessed: number;
  fmpPremiumHistoricalUnavailable?: boolean;
}): Promise<SymbolAuditJson> {
  const sym = params.symbol.toUpperCase();

  const [eqRow] = await db
    .select({ c: count() })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, sym));

  const eqCount = Number(eqRow?.c ?? 0);

  const [hv20Row] = await db
    .select({ c: count() })
    .from(equityDailyTable)
    .where(and(eq(equityDailyTable.symbol, sym), isNotNull(equityDailyTable.hv20d)));

  const [hv30Row] = await db
    .select({ c: count() })
    .from(equityDailyTable)
    .where(and(eq(equityDailyTable.symbol, sym), isNotNull(equityDailyTable.hv30d)));

  const [hv60Row] = await db
    .select({ c: count() })
    .from(equityDailyTable)
    .where(and(eq(equityDailyTable.symbol, sym), isNotNull(equityDailyTable.hv60d)));

  const hv20c = Number(hv20Row?.c ?? 0);
  const hv30c = Number(hv30Row?.c ?? 0);
  const hv60c = Number(hv60Row?.c ?? 0);

  const hvStatus: AuditStatus =
    eqCount >= 1200 && hv20c >= 1000 && hv30c >= 1000 && hv60c >= 800 ? "ok" : eqCount >= 1200 ? "warn" : "warn";

  const [divRow] = await db
    .select({ c: count() })
    .from(dividendsTable)
    .where(eq(dividendsTable.symbol, sym));
  const divCount = Number(divRow?.c ?? 0);

  const [earnRow] = await db
    .select({ c: count() })
    .from(corporateEventsTable)
    .where(
      and(
        eq(corporateEventsTable.symbol, sym),
        isNotNull(corporateEventsTable.earningsDate),
        gte(corporateEventsTable.earningsDate, params.fiveYearCutoffYmd),
      ),
    );
  const earnCount = Number(earnRow?.c ?? 0);

  const [splitRow] = await db
    .select({ c: count() })
    .from(corporateEventsTable)
    .where(and(eq(corporateEventsTable.symbol, sym), isNotNull(corporateEventsTable.splitDate)));
  const splitCount = Number(splitRow?.c ?? 0);

  const [epsEstRow] = await db
    .select({ c: count() })
    .from(corporateEventsTable)
    .where(
      and(
        eq(corporateEventsTable.symbol, sym),
        isNotNull(corporateEventsTable.earningsDate),
        gte(corporateEventsTable.earningsDate, params.fiveYearCutoffYmd),
        isNotNull(corporateEventsTable.earningsEpsEstimate),
      ),
    );
  const epsEstFilled = Number(epsEstRow?.c ?? 0);

  const [epsActRow] = await db
    .select({ c: count() })
    .from(corporateEventsTable)
    .where(
      and(
        eq(corporateEventsTable.symbol, sym),
        isNotNull(corporateEventsTable.earningsDate),
        gte(corporateEventsTable.earningsDate, params.fiveYearCutoffYmd),
        isNotNull(corporateEventsTable.earningsEpsActual),
      ),
    );
  const epsActFilled = Number(epsActRow?.c ?? 0);

  const [revEstRow] = await db
    .select({ c: count() })
    .from(corporateEventsTable)
    .where(
      and(
        eq(corporateEventsTable.symbol, sym),
        isNotNull(corporateEventsTable.earningsDate),
        gte(corporateEventsTable.earningsDate, params.fiveYearCutoffYmd),
        isNotNull(corporateEventsTable.earningsRevenueEstimate),
      ),
    );
  const revEstFilled = Number(revEstRow?.c ?? 0);

  const [revActRow] = await db
    .select({ c: count() })
    .from(corporateEventsTable)
    .where(
      and(
        eq(corporateEventsTable.symbol, sym),
        isNotNull(corporateEventsTable.earningsDate),
        gte(corporateEventsTable.earningsDate, params.fiveYearCutoffYmd),
        isNotNull(corporateEventsTable.earningsRevenueActual),
      ),
    );
  const revActFilled = Number(revActRow?.c ?? 0);

  const totalEarn = earnCount;

  const [optRow] = await db
    .select({ c: count() })
    .from(optionsDailyTable)
    .where(or(eq(optionsDailyTable.underlyingSymbol, sym), like(optionsDailyTable.occ, `O:${sym}%`)));
  const optCount = Number(optRow?.c ?? 0);

  const [erRow] = await db
    .select({ c: count() })
    .from(earningsReactionsTable)
    .where(eq(earningsReactionsTable.symbol, sym));
  const erCount = Number(erRow?.c ?? 0);

  return {
    equity_daily: {
      rows: eqCount,
      expected_min: 1200,
      status: eqCount >= 1200 ? "ok" : eqCount > 0 ? "warn" : "fail",
    },
    hv_coverage: {
      rows_with_hv20: hv20c,
      rows_with_hv30: hv30c,
      rows_with_hv60: hv60c,
      status: hvStatus,
    },
    dividends: {
      rows: divCount,
      status: divCount === 0 ? "ok_empty" : "ok",
    },
    corporate_events_earnings: {
      rows: earnCount,
      expected_min: 12,
      status: earnCount >= 12 ? "ok" : earnCount > 0 ? "warn" : "fail",
    },
    corporate_events_splits: {
      rows: splitCount,
      status: splitCount === 0 ? "ok_empty" : "ok",
    },
    eps_estimate_coverage: {
      filled: epsEstFilled,
      total: totalEarn,
      pct: pct(epsEstFilled, totalEarn),
      status: covStatus(epsEstFilled, totalEarn, 50),
    },
    eps_actual_coverage: {
      filled: epsActFilled,
      total: totalEarn,
      pct: pct(epsActFilled, totalEarn),
      status: covStatus(epsActFilled, totalEarn, 40),
    },
    revenue_estimate_coverage: {
      filled: revEstFilled,
      total: totalEarn,
      pct: pct(revEstFilled, totalEarn),
      status: covStatus(revEstFilled, totalEarn, 40),
    },
    revenue_actual_coverage: {
      filled: revActFilled,
      total: totalEarn,
      pct: pct(revActFilled, totalEarn),
      status: covStatus(revActFilled, totalEarn, 30),
    },
    options_daily: {
      rows: optCount,
      contracts_processed: params.optionsContractsProcessed,
      status: optCount > 0 ? "ok" : "warn",
    },
    earnings_reactions: {
      rows: erCount,
      expected_min: 12,
      status: erCount >= 12 ? "ok" : erCount > 0 ? "warn" : "fail",
    },
    fmp_premium_historical_unavailable: params.fmpPremiumHistoricalUnavailable === true,
  };
}

export function mergeSymbolOverallStatus(a: SymbolAuditJson): AuditStatus {
  const domains: AuditStatus[] = [
    a.equity_daily.status,
    a.hv_coverage.status,
    a.dividends.status,
    a.corporate_events_earnings.status,
    a.corporate_events_splits.status,
    a.eps_estimate_coverage.status,
    a.eps_actual_coverage.status,
    a.revenue_estimate_coverage.status,
    a.revenue_actual_coverage.status,
    a.options_daily.status,
    a.earnings_reactions.status,
  ];
  if (domains.some((s) => s === "fail")) return "fail";
  if (domains.some((s) => s === "warn")) return "warn";
  return "ok";
}

export async function insertAuditRun(params: {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  perSymbol: Record<string, SymbolAuditJson>;
  overallStatus: AuditStatus;
  universeSize: number;
  notes?: string;
}): Promise<string> {
  const [row] = await db
    .insert(backfillAuditRunsTable)
    .values({
      runId: params.runId,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      universe: "tuning_universe",
      universeSize: params.universeSize,
      perSymbolAudit: params.perSymbol,
      overallStatus: params.overallStatus,
      notes: params.notes ?? null,
    })
    .returning({ runId: backfillAuditRunsTable.runId });

  return row?.runId ?? params.runId;
}

export function printSummaryTable(rows: Array<{ symbol: string; audit: SymbolAuditJson }>): void {
  const headers = ["symbol", "eq_daily", "opts_rows", "earn_ce", "earn_rx", "status"];
  const lines = [headers.join("\t")];
  for (const { symbol, audit } of rows) {
    lines.push(
      [
        symbol,
        String(audit.equity_daily.rows),
        String(audit.options_daily.rows),
        String(audit.corporate_events_earnings.rows),
        String(audit.earnings_reactions.rows),
        mergeSymbolOverallStatus(audit),
      ].join("\t"),
    );
  }
  console.log(lines.join("\n"));
}
