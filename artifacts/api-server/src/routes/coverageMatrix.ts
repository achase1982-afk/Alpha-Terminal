/**
 * GET /coverage-matrix (mounted under /api/admin) — operational coverage dashboard.
 */
import { Router } from "express";
import {
  analystEstimatesTable,
  analystPriceTargetsTable,
  backfillAuditRunsTable,
  db,
  equityDailyTable,
  ivrBackfillJobsTable,
  optionsFlowPerStrikeTable,
  polygonOptionsHistoryTable,
  scannerTapeMetricsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { liquidCoreUnionTuningSymbols } from "../lib/liquidCoreUniverse.js";
import { getTuningUniverseSymbols } from "../lib/tuningUniverseRegistrar.js";
import { lastNyTradingSessionYmds } from "../lib/usEquityMarketCalendar.js";

const router = Router();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { ok: false, error: "ADMIN_API_KEY is not set on the server" };
  if (req.headers["x-admin-key"] !== adminKey) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

type CellStatus = "complete" | "partial" | "missing";

function equityCol(cnt: number): CellStatus {
  if (cnt >= 60) return "complete";
  if (cnt < 20) return "missing";
  return "partial";
}

function flowCol(cnt: number): CellStatus {
  if (cnt >= 20) return "complete";
  if (cnt === 0) return "missing";
  return "partial";
}

function flatCol(cnt: number): CellStatus {
  if (cnt >= 25) return "complete";
  if (cnt === 0) return "missing";
  return "partial";
}

router.get("/coverage-matrix", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

  const fmt = String(req.query["format"] ?? "json").toLowerCase();
  const universe = liquidCoreUnionTuningSymbols();
  const tuningSet = new Set(getTuningUniverseSymbols().map((s) => s.toUpperCase()));

  const cutoffFlow = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const warmCutoff = new Date(Date.now() - 14 * 86_400_000);

  const ny30 = lastNyTradingSessionYmds(30);
  const ny30set = new Set(ny30);

  const [auditRun] = await db
    .select()
    .from(backfillAuditRunsTable)
    .orderBy(desc(backfillAuditRunsTable.completedAt))
    .limit(1);

  const auditJson = (auditRun?.perSymbolAudit ?? {}) as Record<
    string,
    { overall_status?: string }
  >;

  const equityCounts = await db
    .select({
      sym: equityDailyTable.symbol,
      cnt: sql<number>`count(distinct ${equityDailyTable.date})`,
    })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, universe))
    .groupBy(equityDailyTable.symbol);

  const eqMap = new Map(equityCounts.map((r) => [String(r.sym).toUpperCase(), Number(r.cnt)]));

  const flowCounts = await db
    .select({
      sym: optionsFlowPerStrikeTable.underlyingSymbol,
      cnt: sql<number>`count(distinct ${optionsFlowPerStrikeTable.date})`,
    })
    .from(optionsFlowPerStrikeTable)
    .where(
      and(inArray(optionsFlowPerStrikeTable.underlyingSymbol, universe), sql`${optionsFlowPerStrikeTable.date} <= ${cutoffFlow}`),
    )
    .groupBy(optionsFlowPerStrikeTable.underlyingSymbol);

  const flowMap = new Map(flowCounts.map((r) => [String(r.sym).toUpperCase(), Number(r.cnt)]));

  const tapeAll = await db
    .select()
    .from(scannerTapeMetricsTable)
    .where(inArray(scannerTapeMetricsTable.ticker, universe));

  const tapeBest = new Map<string, (typeof tapeAll)[number]>();
  for (const r of tapeAll) {
    const k = r.ticker.toUpperCase();
    const prev = tapeBest.get(k);
    const ts = r.updatedAt?.getTime() ?? 0;
    if (!prev || ts >= (prev.updatedAt?.getTime() ?? 0)) tapeBest.set(k, r);
  }

  const tapeMap = new Map<
    string,
    { status: string; occRequested: number; occCompleted: number }
  >();
  for (const [k, r] of tapeBest) {
    tapeMap.set(k, {
      status: r.status,
      occRequested: r.occRequested,
      occCompleted: r.occCompleted,
    });
  }

  const ivrAll = await db
    .select()
    .from(ivrBackfillJobsTable)
    .where(and(inArray(ivrBackfillJobsTable.symbol, universe), eq(ivrBackfillJobsTable.jobKind, "ondemand_ivr")))
    .orderBy(desc(ivrBackfillJobsTable.createdAt));

  const ivrMap = new Map<string, (typeof ivrAll)[number]>();
  for (const r of ivrAll) {
    const k = r.symbol.toUpperCase();
    if (!ivrMap.has(k)) ivrMap.set(k, r);
  }

  const iv30Counts = await db
    .select({
      sym: equityDailyTable.symbol,
      cnt: sql<number>`count(*)::int`,
    })
    .from(equityDailyTable)
    .where(and(inArray(equityDailyTable.symbol, universe), sql`${equityDailyTable.iv30d} IS NOT NULL`))
    .groupBy(equityDailyTable.symbol);

  const iv30Map = new Map(iv30Counts.map((r) => [String(r.sym).toUpperCase(), Number(r.cnt)]));

  const flatCounts = await db
    .select({
      ticker: polygonOptionsHistoryTable.ticker,
      cnt: sql<number>`count(distinct ${polygonOptionsHistoryTable.tradeDate})`,
    })
    .from(polygonOptionsHistoryTable)
    .where(
      and(
        inArray(polygonOptionsHistoryTable.ticker, universe),
        inArray(polygonOptionsHistoryTable.tradeDate, [...ny30set]),
      ),
    )
    .groupBy(polygonOptionsHistoryTable.ticker);

  const flatMap = new Map(flatCounts.map((r) => [String(r.ticker).toUpperCase(), Number(r.cnt)]));

  const ptRows = await db
    .select({ ticker: analystPriceTargetsTable.ticker, updatedAt: analystPriceTargetsTable.updatedAt })
    .from(analystPriceTargetsTable)
    .where(inArray(analystPriceTargetsTable.ticker, universe));

  const ptMap = new Map(ptRows.map((r) => [r.ticker.toUpperCase(), r.updatedAt]));

  const todayYmd = new Date().toISOString().slice(0, 10);
  const estRows = await db
    .select({
      ticker: analystEstimatesTable.ticker,
      fiscalPeriodEnd: analystEstimatesTable.fiscalPeriodEnd,
      updatedAt: analystEstimatesTable.createdAt,
    })
    .from(analystEstimatesTable)
    .where(and(inArray(analystEstimatesTable.ticker, universe), gte(analystEstimatesTable.fiscalPeriodEnd, todayYmd)));

  const estMap = new Map<string, Date>();
  for (const r of estRows) {
    const t = r.ticker.toUpperCase();
    const cur = estMap.get(t);
    const fe = typeof r.fiscalPeriodEnd === "string" ? r.fiscalPeriodEnd : String(r.fiscalPeriodEnd).slice(0, 10);
    if (!fe || fe < todayYmd) continue;
    const cand = new Date(r.updatedAt);
    if (!cur || cand > cur) estMap.set(t, cand);
  }

  type Col = {
    equity_daily: { count: number; status: CellStatus };
    flow_aggregates: { count: number; status: CellStatus };
    tape_metrics: { status: CellStatus; detail: string | null };
    ivr_jobs: { status: CellStatus; detail: string | null };
    flat_files: { count: number; status: CellStatus };
    fmp_pt: { status: CellStatus; detail: string | null };
    fmp_estimates: { status: CellStatus; detail: string | null };
    tuning_audit: { status: CellStatus; detail: string | null };
  };

  const rows: Record<string, Col> = {};

  for (const sym of universe) {
    const u = sym.toUpperCase();
    const ec = eqMap.get(u) ?? 0;
    const fc = flowMap.get(u) ?? 0;
    const tape = tapeMap.get(u);
    const tapeOk =
      tape &&
      tape.status === "complete" &&
      tape.occRequested > 0 &&
      tape.occCompleted === tape.occRequested;
    const tapeStatus: CellStatus = tapeOk ? "complete" : tape ? "partial" : "missing";

    const ivJob = ivrMap.get(u);
    const iv30c = iv30Map.get(u) ?? 0;
    const ivrOk =
      ivJob?.status === "completed" && iv30c >= 60;
    const ivrStatus: CellStatus = ivrOk ? "complete" : ivJob ? "partial" : "missing";

    const flatc = flatMap.get(u) ?? 0;
    const ptAt = ptMap.get(u);
    const ptOk = ptAt != null && ptAt >= warmCutoff;
    const ptStatus: CellStatus = ptOk ? "complete" : ptAt ? "partial" : "missing";

    const estAt = estMap.get(u);
    const estOk = estAt != null && estAt >= warmCutoff;
    const estStatus: CellStatus = estOk ? "complete" : estAt ? "partial" : "missing";

    let tuningStatus: CellStatus = "missing";
    let tuningDetail: string | null = "n/a";
    if (tuningSet.has(u)) {
      const st = auditJson[u]?.overall_status;
      tuningDetail = st ?? null;
      if (st === "ok") tuningStatus = "complete";
      else if (st === "warn") tuningStatus = "partial";
      else if (st === "fail") tuningStatus = "missing";
      else tuningStatus = "missing";
    }

    rows[u] = {
      equity_daily: { count: ec, status: equityCol(ec) },
      flow_aggregates: { count: fc, status: flowCol(fc) },
      tape_metrics: {
        status: tapeStatus,
        detail: tape ? `${tape.status} occ ${tape.occCompleted}/${tape.occRequested}` : null,
      },
      ivr_jobs: {
        status: ivrStatus,
        detail: ivJob ? `${ivJob.status} iv30d_days=${iv30c}` : null,
      },
      flat_files: { count: flatc, status: flatCol(flatc) },
      fmp_pt: {
        status: ptStatus,
        detail: ptAt ? ptAt.toISOString() : null,
      },
      fmp_estimates: {
        status: estStatus,
        detail: estAt ? estAt.toISOString() : null,
      },
      tuning_audit: { status: tuningStatus, detail: tuningDetail },
    };
  }

  const cols: (keyof Col)[] = [
    "equity_daily",
    "flow_aggregates",
    "tape_metrics",
    "ivr_jobs",
    "flat_files",
    "fmp_pt",
    "fmp_estimates",
    "tuning_audit",
  ];

  function statusAt(row: Col, k: keyof Col): CellStatus {
    return row[k].status;
  }

  let completeAll = 0;
  let atLeast6 = 0;
  let missing2Plus = 0;

  for (const sym of universe) {
    const r = rows[sym.toUpperCase()]!;
    const sts = cols.map((c) => statusAt(r, c));
    if (sts.every((s) => s === "complete")) completeAll++;
    if (sts.filter((s) => s === "complete").length >= 6) atLeast6++;
    if (sts.filter((s) => s === "missing").length >= 2) missing2Plus++;
  }

  const summary = {
    totalTickers: universe.length,
    completeOnEveryColumn: completeAll,
    completeOnAtLeastSixOfEight: atLeast6,
    missingOnTwoOrMoreColumns: missing2Plus,
  };

  if (fmt === "csv") {
    const headers = [
      "ticker",
      "equity_daily_count",
      "equity_daily",
      "flow_distinct_dates",
      "flow_aggregates",
      "tape_metrics",
      "ivr_jobs",
      "flat_files_count",
      "flat_files",
      "fmp_pt",
      "fmp_estimates",
      "tuning_audit",
    ];
    const lines = [headers.join(",")];
    for (const sym of universe) {
      const u = sym.toUpperCase();
      const row = rows[u]!;
      lines.push(
        [
          u,
          String(row.equity_daily.count),
          row.equity_daily.status,
          String(row.flow_aggregates.count),
          row.flow_aggregates.status,
          row.tape_metrics.status,
          row.ivr_jobs.status,
          String(row.flat_files.count),
          row.flat_files.status,
          row.fmp_pt.status,
          row.fmp_estimates.status,
          row.tuning_audit.status,
        ].join(","),
      );
    }
    lines.push(
      [
        "SUMMARY",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    );
    lines.push(
      [
        "complete_all_columns",
        String(summary.completeOnEveryColumn),
        "at_least_6_of_8",
        String(summary.completeOnAtLeastSixOfEight),
        "missing_2_plus",
        String(summary.missingOnTwoOrMoreColumns),
      ].join(","),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.send(lines.join("\n"));
  }

  return res.json({
    ok: true,
    summary,
    universeSize: universe.length,
    rows,
  });
});

export default router;
