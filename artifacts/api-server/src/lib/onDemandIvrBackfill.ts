import { db, equityDailyTable, ivrBackfillJobsTable, trackedTickersTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { notifyStrategistCompletion } from "./strategistNotifications.js";
import { backfillEquityFromPolygon } from "./dailySnapshot.js";
import { backfillHistoricalIV } from "./historicalIVBackfill.js";
import { backfillHvProxy } from "./hvProxyBackfill.js";

export const IVR_MIN_COVERAGE_DAYS = 60;
export const IVR_TARGET_TRADING_DAYS = 252;

const POLYGON_CALENDAR_LOOKBACK_DAYS = 420;
const DEFAULT_CONCURRENCY = 4;

export type IvrBackfillStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "failed_insufficient_history";

export interface IvrCoverageReady {
  status: "ready";
  symbol: string;
  ivDays: number;
}

export interface IvrCoveragePending {
  status: "populating";
  symbol: string;
  ivDays: number;
  jobId: string;
  jobStatus: IvrBackfillStatus;
  daysLoaded: number;
  daysRequested: number;
}

export interface IvrCoverageInsufficient {
  status: "failed_insufficient_history";
  symbol: string;
  ivDays: number;
  jobId: string | null;
  message: string;
}

export interface IvrCoverageFailed {
  status: "failed";
  symbol: string;
  ivDays: number;
  jobId: string | null;
  message: string;
}

export type IvrCoverageResult =
  | IvrCoverageReady
  | IvrCoveragePending
  | IvrCoverageInsufficient
  | IvrCoverageFailed;

interface QueueEntry {
  jobId: string;
  symbol: string;
}

const queue: QueueEntry[] = [];
const activeJobs = new Set<string>();

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function concurrencyLimit(): number {
  const raw = Number(process.env.ON_DEMAND_IVR_BACKFILL_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  if (!Number.isFinite(raw)) return DEFAULT_CONCURRENCY;
  return Math.max(3, Math.min(5, Math.floor(raw)));
}

async function countRealIvDays(symbol: string): Promise<number> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symbol),
      sql`${equityDailyTable.iv30d} IS NOT NULL`,
    ));
  return count;
}

async function countAnyIvrDays(symbol: string): Promise<number> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symbol),
      sql`(${equityDailyTable.iv30d} IS NOT NULL OR ${equityDailyTable.iv30dProxy} IS NOT NULL)`,
    ));
  return count;
}

async function countPriceHistoryDays(symbol: string): Promise<number> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symbol),
      sql`${equityDailyTable.close} IS NOT NULL`,
    ));
  return count;
}

async function latestJobForSymbol(symbol: string) {
  const [job] = await db
    .select()
    .from(ivrBackfillJobsTable)
    .where(eq(ivrBackfillJobsTable.symbol, symbol))
    .orderBy(desc(ivrBackfillJobsTable.createdAt))
    .limit(1);
  return job ?? null;
}

async function activeJobForSymbol(symbol: string) {
  const [job] = await db
    .select()
    .from(ivrBackfillJobsTable)
    .where(and(
      eq(ivrBackfillJobsTable.symbol, symbol),
      sql`${ivrBackfillJobsTable.status} IN ('queued', 'running')`,
    ))
    .orderBy(desc(ivrBackfillJobsTable.createdAt))
    .limit(1);
  return job ?? null;
}

async function upsertTrackedTicker(symbol: string, jobId?: string): Promise<void> {
  await db
    .insert(trackedTickersTable)
    .values({
      symbol,
      source: "strategist_on_demand",
      active: true,
      lastIvrBackfillJobId: jobId ?? null,
    })
    .onConflictDoUpdate({
      target: trackedTickersTable.symbol,
      set: {
        active: sql`true`,
        lastRequestedAt: sql`now()`,
        lastIvrBackfillJobId: jobId ?? undefined,
        errorMsg: sql`null`,
      },
    });
}

async function updateJob(jobId: string, patch: Partial<typeof ivrBackfillJobsTable.$inferInsert>): Promise<void> {
  await db
    .update(ivrBackfillJobsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ivrBackfillJobsTable.id, jobId));
}

function enqueue(jobId: string, symbol: string): void {
  queue.push({ jobId, symbol });
  drainQueue();
}

function drainQueue(): void {
  while (activeJobs.size < concurrencyLimit() && queue.length > 0) {
    const next = queue.shift()!;
    activeJobs.add(next.jobId);
    void runBackfillJob(next.jobId, next.symbol)
      .catch((err) => logger.error({ err, jobId: next.jobId, symbol: next.symbol }, "On-demand IVR backfill: job crashed"))
      .finally(() => {
        activeJobs.delete(next.jobId);
        drainQueue();
      });
  }
}

/**
 * On-boot orphan recovery. Marks any ivr_backfill_jobs row still in
 * status='running' as failed with error_msg='server_restart'. These rows
 * are left behind whenever the Node process is killed mid-job (Railway
 * redeploy, SIGKILL, OOM). Without this, the stuck rows permanently block
 * re-triggering the backfill for those tickers because activeJobForSymbol()
 * finds them and returns "populating" instead of creating a new job.
 *
 * Called once from index.ts immediately after the DB is available.
 */
export async function recoverOrphanedIvrJobs(): Promise<void> {
  try {
    const orphans = await db
      .update(ivrBackfillJobsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMsg: "server_restart",
        updatedAt: new Date(),
      })
      .where(sql`${ivrBackfillJobsTable.status} = 'running'`)
      .returning({ id: ivrBackfillJobsTable.id, symbol: ivrBackfillJobsTable.symbol });

    if (orphans.length > 0) {
      logger.warn(
        { count: orphans.length, jobs: orphans.map(j => ({ id: j.id, symbol: j.symbol })) },
        "IVR orphan recovery: marked stuck running jobs as failed",
      );
    } else {
      logger.info("IVR orphan recovery: no stuck jobs found");
    }
  } catch (err) {
    logger.error({ err }, "IVR orphan recovery: failed (non-fatal)");
  }
}

export async function getIvrBackfillJob(jobId: string) {
  const [job] = await db
    .select()
    .from(ivrBackfillJobsTable)
    .where(eq(ivrBackfillJobsTable.id, jobId))
    .limit(1);
  return job ?? null;
}

export async function getLatestIvrBackfillJobForSymbol(symbol: string) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return null;
  return latestJobForSymbol(sym);
}

export async function ensureIvrCoverage(symbol: string): Promise<IvrCoverageResult> {
  const sym = normalizeSymbol(symbol);
  if (!sym) {
    return { status: "failed", symbol: sym, ivDays: 0, jobId: null, message: "Ticker is required." };
  }

  try {
    const ivDays = await countRealIvDays(sym);
    if (ivDays >= IVR_MIN_COVERAGE_DAYS) {
      return { status: "ready", symbol: sym, ivDays };
    }

    const existing = await activeJobForSymbol(sym);
    if (existing) {
      await upsertTrackedTicker(sym, existing.id);
      return {
        status: "populating",
        symbol: sym,
        ivDays,
        jobId: existing.id,
        jobStatus: existing.status as IvrBackfillStatus,
        daysLoaded: existing.daysLoaded ?? 0,
        daysRequested: existing.daysRequested ?? IVR_TARGET_TRADING_DAYS,
      };
    }

    const latest = await latestJobForSymbol(sym);
    if (latest?.status === "failed_insufficient_history") {
      return {
        status: "failed_insufficient_history",
        symbol: sym,
        ivDays,
        jobId: latest.id,
        message: "This ticker is too new to compute IVR. At least 60 trading days of price history required.",
      };
    }

    const jobId = `ivr-${Date.now()}-${sym}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(ivrBackfillJobsTable).values({
      id: jobId,
      symbol: sym,
      jobKind: "ondemand_ivr",
      status: "queued",
      source: "none",
      daysRequested: IVR_TARGET_TRADING_DAYS,
    });
    await upsertTrackedTicker(sym, jobId);
    enqueue(jobId, sym);

    return {
      status: "populating",
      symbol: sym,
      ivDays,
      jobId,
      jobStatus: "queued",
      daysLoaded: 0,
      daysRequested: IVR_TARGET_TRADING_DAYS,
    };
  } catch (err) {
    logger.error({ err, symbol: sym }, "ensureIvrCoverage: unexpected database error");
    return {
      status: "failed",
      symbol: sym,
      ivDays: 0,
      jobId: null,
      message: "IVR service temporarily unavailable. Please retry in a moment.",
    };
  }
}

async function runBackfillJob(jobId: string, symbol: string): Promise<void> {
  logger.info({ jobId, symbol }, "On-demand IVR backfill: starting");
  await updateJob(jobId, { status: "running", startedAt: new Date(), errorMsg: null });

  try {
    if (!process.env.POLYGON_API_KEY) {
      throw new Error("POLYGON_API_KEY missing");
    }

    const equity = await backfillEquityFromPolygon([symbol], POLYGON_CALENDAR_LOOKBACK_DAYS);
    const priceDays = await countPriceHistoryDays(symbol);
    await updateJob(jobId, {
      daysLoaded: Math.min(priceDays, IVR_TARGET_TRADING_DAYS),
      equityRowsWritten: equity.totalRows,
    });

    if (priceDays < IVR_MIN_COVERAGE_DAYS) {
      const message = "This ticker is too new to compute IVR. At least 60 trading days of price history required.";
      await updateJob(jobId, {
        status: "failed_insufficient_history",
        completedAt: new Date(),
        errorMsg: message,
      });
      await db.update(trackedTickersTable)
        .set({ errorMsg: message, lastIvrBackfillJobId: jobId })
        .where(eq(trackedTickersTable.symbol, symbol));
      notifyStrategistCompletion({
        kind: "ivr_failed",
        ticker: symbol,
        jobId,
        message: `Strategist failed for ${symbol}`,
        resultStatus: "failed_insufficient_history",
      });
      logger.warn({ jobId, symbol, priceDays }, "On-demand IVR backfill: insufficient history");
      return;
    }

    const realReport = await backfillHistoricalIV([symbol], POLYGON_CALENDAR_LOOKBACK_DAYS, { skipSectorEtfs: true });
    let realIvDays = await countRealIvDays(symbol);
    await updateJob(jobId, {
      ivRowsWritten: realReport.equityRowsIVUpdated,
      ivrRowsWritten: realReport.ivrRowsUpdated,
      source: realIvDays >= IVR_MIN_COVERAGE_DAYS ? "real_iv" : "none",
    });

    if (realIvDays >= IVR_MIN_COVERAGE_DAYS) {
      await db.execute(sql`
        UPDATE equity_daily
        SET ivr_source = 'real_iv'
        WHERE symbol = ${symbol}
          AND iv_30d IS NOT NULL
          AND ivr IS NOT NULL
      `);
    } else {
      const proxyReport = await backfillHvProxy([symbol], POLYGON_CALENDAR_LOOKBACK_DAYS, { skipAutoSectorEtfs: true });
      const proxyDays = await countAnyIvrDays(symbol);
      realIvDays = await countRealIvDays(symbol);
      await updateJob(jobId, {
        source: proxyDays >= IVR_MIN_COVERAGE_DAYS ? "hv_proxy" : "none",
        ivRowsWritten: realReport.equityRowsIVUpdated + proxyReport.rowsWritten,
        ivrRowsWritten: realReport.ivrRowsUpdated + proxyReport.ivrRowsUpdated,
      });

      if (proxyDays < IVR_MIN_COVERAGE_DAYS) {
        const message = "This ticker is too new to compute IVR. At least 60 trading days of price history required.";
        await updateJob(jobId, {
          status: "failed_insufficient_history",
          completedAt: new Date(),
          errorMsg: message,
        });
        await db.update(trackedTickersTable)
          .set({ errorMsg: message, lastIvrBackfillJobId: jobId })
          .where(eq(trackedTickersTable.symbol, symbol));
        notifyStrategistCompletion({
          kind: "ivr_failed",
          ticker: symbol,
          jobId,
          message: `Strategist failed for ${symbol}`,
          resultStatus: "failed_insufficient_history",
        });
        return;
      }
    }

    await updateJob(jobId, {
      status: "completed",
      completedAt: new Date(),
      errorMsg: null,
    });
    await db.update(trackedTickersTable)
      .set({ active: true, errorMsg: null, lastIvrBackfillJobId: jobId })
      .where(eq(trackedTickersTable.symbol, symbol));
    notifyStrategistCompletion({
      kind: "ivr_ready",
      ticker: symbol,
      jobId,
      message: `Strategist ready for ${symbol}`,
      resultStatus: "ivr_backfill_completed",
    });
    logger.info({ jobId, symbol, realIvDays }, "On-demand IVR backfill: completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, {
      status: "failed",
      completedAt: new Date(),
      errorMsg: message,
    });
    await db.update(trackedTickersTable)
      .set({ errorMsg: message, lastIvrBackfillJobId: jobId })
      .where(eq(trackedTickersTable.symbol, symbol));
    notifyStrategistCompletion({
      kind: "ivr_failed",
      ticker: symbol,
      jobId,
      message: `Strategist failed for ${symbol}`,
      resultStatus: "ivr_backfill_failed",
    });
    logger.error({ err, jobId, symbol }, "On-demand IVR backfill: failed");
  }
}
