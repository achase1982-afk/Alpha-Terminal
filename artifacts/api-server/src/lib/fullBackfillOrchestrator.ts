import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { eq, inArray, lte, sql } from "@workspace/db";
import {
  backfillRunJobsTable,
  db,
  equityDailyTable,
  optionsFlowPerStrikeTable,
} from "@workspace/db";
import {
  backfillAnalystEstimates,
  backfillAnalystGrades,
  backfillAnalystPriceTargets,
  backfillEarningsSurprises,
} from "./fmpBackfill.js";
import { runFmpEarningsBackfill } from "./fmpEarningsBackfill.js";
import { backfillEquityFromPolygon, backfillPolygonFlow } from "./dailySnapshot.js";
import { syncDateRange } from "./polygonFlatFiles.js"; // pragma: allowlist secret (false positive: filename matches POLYGON_S3_* secret name)
import { liquidCoreUnionTuningSymbols } from "./liquidCoreUniverse.js";
import { logger } from "./logger.js";
import { lastNyTradingSessionYmds } from "./usEquityMarketCalendar.js";
import { runTuningUniverseBackfill } from "../jobs/tuningUniverseBackfill.js";

const MIN_EQUITY_DISTINCT = 60;
const EQUITY_POLYGON_DAYS_BACK = 90;
const FLOW_DISTINCT_THRESHOLD = 20;
const FLOW_DAYS_BACK = 30;
const PARALLEL_EQUITY = 6;
export type PipelineKey =
  | "equity_polygon"
  | "flow_polygon"
  | "fmp_bundle"
  | "flat_files"
  | "tuning_audit";

export type PipelineSlice = {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  finishedAt?: string;
  detail?: Record<string, unknown>;
  error?: string;
};

function emptyProgress(): Record<PipelineKey, PipelineSlice> {
  return {
    equity_polygon: { status: "pending" },
    flow_polygon: { status: "pending" },
    fmp_bundle: { status: "pending" },
    flat_files: { status: "pending" },
    tuning_audit: { status: "pending" },
  };
}

async function patchJob(
  jobId: string,
  patch: {
    status?: string;
    finishedAt?: Date | null;
    perPipelineProgress?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .update(backfillRunJobsTable)
    .set({
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      ...(patch.perPipelineProgress != null ? { perPipelineProgress: patch.perPipelineProgress } : {}),
    })
    .where(eq(backfillRunJobsTable.id, jobId));
}

async function mergePipeline(
  jobId: string,
  current: Record<string, unknown>,
  key: PipelineKey,
  slice: PipelineSlice,
): Promise<Record<string, unknown>> {
  const next = {
    ...current,
    [key]: slice,
  };
  await patchJob(jobId, { perPipelineProgress: next });
  return next;
}

/**
 * Queues a row then runs the full LC130 ∪ tuning pipeline in the background.
 */
export async function enqueueFullBackfillJob(): Promise<{ jobId: string }> {
  const progress = emptyProgress();
  const jobId = randomUUID();
  await db.insert(backfillRunJobsTable).values({
    id: jobId,
    status: "queued",
    perPipelineProgress: progress as unknown as Record<string, unknown>,
  });

  setImmediate(() => {
    void runFullBackfillChain(jobId).catch((err) => {
      logger.error({ err, jobId }, "full backfill: fatal chain error");
    });
  });

  return { jobId };
}

async function runFullBackfillChain(jobId: string): Promise<void> {
  const universe = liquidCoreUnionTuningSymbols();
  const [initial] = await db
    .select({ p: backfillRunJobsTable.perPipelineProgress })
    .from(backfillRunJobsTable)
    .where(eq(backfillRunJobsTable.id, jobId))
    .limit(1);
  let progressObj = (initial?.p ?? {}) as Record<string, unknown>;

  await patchJob(jobId, { status: "running" });

  const runStep = async <T>(
    key: PipelineKey,
    fn: () => Promise<T>,
    detail?: (r: T) => Record<string, unknown>,
  ): Promise<void> => {
    const startedAt = new Date().toISOString();
    progressObj = await mergePipeline(jobId, progressObj, key, {
      status: "running",
      startedAt,
    });
    try {
      const r = await fn();
      progressObj = await mergePipeline(jobId, progressObj, key, {
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: detail ? detail(r) : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error({ jobId, key, err: msg }, "full backfill: step failed");
      progressObj = await mergePipeline(jobId, progressObj, key, {
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: msg,
      });
      throw e;
    }
  };

  try {
    // Step 1 — equity from Polygon for symbols with <60 distinct equity_daily dates
    await runStep("equity_polygon", async () => {
      const counts = await db
        .select({
          sym: equityDailyTable.symbol,
          cnt: sql<number>`count(distinct ${equityDailyTable.date})`,
        })
        .from(equityDailyTable)
        .where(inArray(equityDailyTable.symbol, universe))
        .groupBy(equityDailyTable.symbol);
      const countMap = new Map(counts.map((r) => [String(r.sym).toUpperCase(), Number(r.cnt)]));
      const thin = universe.filter((s) => (countMap.get(s.toUpperCase()) ?? 0) < MIN_EQUITY_DISTINCT);
      if (thin.length === 0) {
        return { symbolsNeedingBackfill: 0, thin: [] as string[], results: [] as { sym: string; rows: number }[] };
      }
      const limit = pLimit(PARALLEL_EQUITY);
      const results = await Promise.all(
        thin.map((sym) =>
          limit(async () => {
            const r = await backfillEquityFromPolygon([sym], EQUITY_POLYGON_DAYS_BACK);
            return { sym: sym.toUpperCase(), rows: r.totalRows };
          }),
        ),
      );
      return { symbolsNeedingBackfill: thin.length, thin, results };
    });

    // Step 2 — flow aggregates (≤2d ago), <20 distinct dates → force 30d
    await runStep("flow_polygon", async () => {
      const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
      const rows = await db
        .select({
          sym: optionsFlowPerStrikeTable.underlyingSymbol,
          dateCnt: sql<number>`count(distinct ${optionsFlowPerStrikeTable.date})`,
        })
        .from(optionsFlowPerStrikeTable)
        .where(lte(optionsFlowPerStrikeTable.date, cutoff))
        .groupBy(optionsFlowPerStrikeTable.underlyingSymbol);
      const dateCnt = new Map(rows.map((r) => [String(r.sym).toUpperCase(), Number(r.dateCnt)]));
      const needy = universe.filter((s) => (dateCnt.get(s.toUpperCase()) ?? 0) < FLOW_DISTINCT_THRESHOLD);
      if (needy.length === 0) {
        return { needy: 0, skippedAll: true as const };
      }
      const result = await backfillPolygonFlow(needy, FLOW_DAYS_BACK, true);
      return {
        needy: needy.length,
        totalStrikeRows: result.totalStrikeRows,
        symbolsDone: result.symbolsDone,
        datesProcessed: result.datesProcessed,
      };
    });

    // Step 3 — FMP weekly bundle + earnings calendar (parallel where safe)
    await runStep("fmp_bundle", async () => {
      const settled = await Promise.allSettled([
        backfillAnalystPriceTargets(),
        backfillAnalystGrades(),
        backfillEarningsSurprises(),
        backfillAnalystEstimates(),
        runFmpEarningsBackfill(),
      ]);
      const labels = ["price_targets", "grades", "earnings_surprises", "analyst_estimates", "earnings_calendar"] as const;
      const parts: Record<string, unknown> = {};
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i]!;
        parts[labels[i]!] =
          s.status === "fulfilled" ? { ok: true, value: s.value } : { ok: false, reason: String(s.reason) };
      }
      const failed = settled.filter((s) => s.status === "rejected");
      if (failed.length > 0) {
        throw new Error(`FMP bundle: ${failed.length} sub-job(s) failed`);
      }
      return parts;
    });

    // Step 4 — Polygon flat files: last 30 NY sessions
    await runStep("flat_files", async () => {
      const ymds = lastNyTradingSessionYmds(30);
      const sorted = [...ymds].sort();
      if (sorted.length === 0) {
        return { dates: 0, rows: [] };
      }
      const startDate = new Date(`${sorted[0]}T12:00:00Z`);
      const endDate = new Date(`${sorted[sorted.length - 1]}T12:00:00Z`);
      const tickers = universe.map((s) => s.toUpperCase());
      const rows = await syncDateRange(startDate, endDate, tickers, { force: true });
      return {
        tradeSessions: sorted.length,
        from: sorted[0],
        to: sorted[sorted.length - 1],
        daysSynced: rows.filter((r) => !r.skipped && !r.error).length,
        sample: rows.slice(0, 5),
      };
    });

    // Step 5 — tuning universe multi-domain audit (tuning symbols only; existing job)
    await runStep("tuning_audit", async () => {
      const r = await runTuningUniverseBackfill({ quiet: true });
      return {
        tuningRunId: r.runId,
        overallStatus: r.overallStatus,
        failedSymbols: r.failedSymbols,
        warnedSymbols: r.warnedSymbols,
        durationMs: r.durationMs,
      };
    });

    await patchJob(jobId, {
      status: "completed",
      finishedAt: new Date(),
    });
    logger.info({ jobId }, "full backfill: completed");
  } catch {
    await patchJob(jobId, {
      status: "failed",
      finishedAt: new Date(),
    });
  }
}
