import { db, optionsFlowExecPerStrikeTable, optionsFlowRawTradesTable } from "@workspace/db";
import { sql } from "@workspace/db";
import { logger } from "./logger.js";
import { logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";

// Periodic rollup of options_flow_raw_trades → options_flow_exec_per_strike.
//
// Runs every ROLLUP_INTERVAL_MS during market hours. Aggregates today's raw
// trades into per-strike summaries (sweep/block/regular counts + notional +
// volume). Idempotent: full re-aggregation per call, upserted on the unique
// composite key, so partial failures or restart never produce duplicates.

const ROLLUP_INTERVAL_MS = 60 * 1000; // 1 minute
/** Default wall-clock cap for per-symbol rollup during strategist tape capture. */
export const SYMBOL_ROLLUP_DEFAULT_MAX_MS = 45_000;

export type SymbolRollupResult = {
  rowsUpserted: number;
  rawScanned: number;
  durationMs: number;
  timedOut?: boolean;
};

export type SymbolRollupOptions = {
  /** Wall-clock budget; strategist capture passes remaining time until flowCaptureDeadlineAt. */
  maxMs?: number;
};

function raceWithWallClock<T>(work: Promise<T>, maxMs: number, label: string): Promise<T> {
  if (!Number.isFinite(maxMs) || maxMs <= 0) {
    return Promise.reject(new Error(`${label}_budget_exhausted`));
  }
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_timeout`)), maxMs);
    }),
  ]);
}

let rollupTimer: ReturnType<typeof setInterval> | null = null;
let lastRunTs: number | null = null;
let lastRunRows = 0;
let lastRunMs = 0;
let totalRuns = 0;
let totalFailures = 0;

function pgExecuteRows(result: unknown): Array<Record<string, unknown>> {
  const r = result as { rows?: Array<Record<string, unknown>> };
  return r.rows ?? [];
}

function pgExecuteRowCount(result: unknown): number {
  const r = result as { rowCount?: number | null };
  return r.rowCount ?? 0;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isMarketHoursUtc(d = new Date()): boolean {
  // US options regular hours roughly 13:30–20:30 UTC, with a +30min buffer
  // either side to capture pre/post settlement prints.
  const h = d.getUTCHours() * 60 + d.getUTCMinutes();
  return h >= 13 * 60 && h <= 21 * 60;
}

export async function runRollupOnce(forDate?: string): Promise<{ rowsUpserted: number; rawScanned: number; durationMs: number }> {
  const t0 = Date.now();
  const date = forDate ?? todayIso();

  const rawCountResult = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM options_flow_raw_trades WHERE date = ${date}`,
  );
  const countRows = pgExecuteRows(rawCountResult);
  const rawScanned = Number((countRows[0]?.n as number | string | undefined) ?? 0);

  let rowsUpserted = 0;
  try {
    const rolled = await db.execute(sql`
    INSERT INTO options_flow_exec_per_strike (
      underlying_symbol, date, option_type, strike, expiration,
      sweep_count, block_count, regular_count,
      sweep_notional, block_notional, regular_notional,
      sweep_volume, block_volume, regular_volume,
      last_event_ts, updated_at
    )
    SELECT
      underlying_symbol, date, option_type, strike, expiration,
      COUNT(*) FILTER (WHERE is_sweep)                                          AS sweep_count,
      COUNT(*) FILTER (WHERE is_block AND NOT is_sweep)                         AS block_count,
      COUNT(*) FILTER (WHERE NOT is_sweep AND NOT is_block)                     AS regular_count,
      COALESCE(SUM(notional) FILTER (WHERE is_sweep), 0)                        AS sweep_notional,
      COALESCE(SUM(notional) FILTER (WHERE is_block AND NOT is_sweep), 0)       AS block_notional,
      COALESCE(SUM(notional) FILTER (WHERE NOT is_sweep AND NOT is_block), 0)   AS regular_notional,
      COALESCE(SUM(size) FILTER (WHERE is_sweep), 0)                            AS sweep_volume,
      COALESCE(SUM(size) FILTER (WHERE is_block AND NOT is_sweep), 0)           AS block_volume,
      COALESCE(SUM(size) FILTER (WHERE NOT is_sweep AND NOT is_block), 0)       AS regular_volume,
      MAX(timestamp)                                                            AS last_event_ts,
      NOW()                                                                     AS updated_at
    FROM options_flow_raw_trades
    WHERE date = ${date}
    GROUP BY underlying_symbol, date, option_type, strike, expiration
    ON CONFLICT (underlying_symbol, date, option_type, strike, expiration)
    DO UPDATE SET
      sweep_count = EXCLUDED.sweep_count,
      block_count = EXCLUDED.block_count,
      regular_count = EXCLUDED.regular_count,
      sweep_notional = EXCLUDED.sweep_notional,
      block_notional = EXCLUDED.block_notional,
      regular_notional = EXCLUDED.regular_notional,
      sweep_volume = EXCLUDED.sweep_volume,
      block_volume = EXCLUDED.block_volume,
      regular_volume = EXCLUDED.regular_volume,
      last_event_ts = EXCLUDED.last_event_ts,
      updated_at = NOW()
  `);
    rowsUpserted = pgExecuteRowCount(rolled);
  } catch (err) {
    logFlowPipelineWarn(
      "rollup_global",
      "optionsFlowRollup: global rollup SQL failed",
      { err, date, rawScanned },
    );
    throw err;
  }

  const durationMs = Date.now() - t0;
  return { rowsUpserted, rawScanned, durationMs };
}

async function runRollupOnceForSymbolCore(
  underlyingSymbol: string,
  forDate?: string,
): Promise<SymbolRollupResult> {
  const t0 = Date.now();
  const date = forDate ?? todayIso();
  const sym = underlyingSymbol.toUpperCase();

  const rawCountResult = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM options_flow_raw_trades WHERE date = ${date} AND underlying_symbol = ${sym}`,
  );
  const countRows = pgExecuteRows(rawCountResult);
  const rawScanned = Number((countRows[0]?.n as number | string | undefined) ?? 0);

  let rowsUpserted = 0;
  try {
    const rolled = await db.execute(sql`
    INSERT INTO options_flow_exec_per_strike (
      underlying_symbol, date, option_type, strike, expiration,
      sweep_count, block_count, regular_count,
      sweep_notional, block_notional, regular_notional,
      sweep_volume, block_volume, regular_volume,
      last_event_ts, updated_at
    )
    SELECT
      underlying_symbol, date, option_type, strike, expiration,
      COUNT(*) FILTER (WHERE is_sweep)                                          AS sweep_count,
      COUNT(*) FILTER (WHERE is_block AND NOT is_sweep)                         AS block_count,
      COUNT(*) FILTER (WHERE NOT is_sweep AND NOT is_block)                     AS regular_count,
      COALESCE(SUM(notional) FILTER (WHERE is_sweep), 0)                        AS sweep_notional,
      COALESCE(SUM(notional) FILTER (WHERE is_block AND NOT is_sweep), 0)       AS block_notional,
      COALESCE(SUM(notional) FILTER (WHERE NOT is_sweep AND NOT is_block), 0)   AS regular_notional,
      COALESCE(SUM(size) FILTER (WHERE is_sweep), 0)                            AS sweep_volume,
      COALESCE(SUM(size) FILTER (WHERE is_block AND NOT is_sweep), 0)           AS block_volume,
      COALESCE(SUM(size) FILTER (WHERE NOT is_sweep AND NOT is_block), 0)       AS regular_volume,
      MAX(timestamp)                                                            AS last_event_ts,
      NOW()                                                                     AS updated_at
    FROM options_flow_raw_trades
    WHERE date = ${date} AND underlying_symbol = ${sym}
    GROUP BY underlying_symbol, date, option_type, strike, expiration
    ON CONFLICT (underlying_symbol, date, option_type, strike, expiration)
    DO UPDATE SET
      sweep_count = EXCLUDED.sweep_count,
      block_count = EXCLUDED.block_count,
      regular_count = EXCLUDED.regular_count,
      sweep_notional = EXCLUDED.sweep_notional,
      block_notional = EXCLUDED.block_notional,
      regular_notional = EXCLUDED.regular_notional,
      sweep_volume = EXCLUDED.sweep_volume,
      block_volume = EXCLUDED.block_volume,
      regular_volume = EXCLUDED.regular_volume,
      last_event_ts = EXCLUDED.last_event_ts,
      updated_at = NOW()
  `);
    rowsUpserted = pgExecuteRowCount(rolled);
  } catch (err) {
    logFlowPipelineWarn(
      "rollup_symbol",
      "optionsFlowRollup: per-symbol rollup SQL failed",
      { err, date, underlyingSymbol: sym, rawScanned },
    );
    throw err;
  }

  const durationMs = Date.now() - t0;
  return { rowsUpserted, rawScanned, durationMs };
}

/** Same as runRollupOnce but only raw rows for one underlying (Strategist tape backfill). */
export async function runRollupOnceForSymbol(
  underlyingSymbol: string,
  forDate?: string,
  opts?: SymbolRollupOptions,
): Promise<SymbolRollupResult> {
  const maxMs = opts?.maxMs ?? SYMBOL_ROLLUP_DEFAULT_MAX_MS;
  const t0 = Date.now();
  try {
    return await raceWithWallClock(
      runRollupOnceForSymbolCore(underlyingSymbol, forDate),
      maxMs,
      "symbol_rollup",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "symbol_rollup_timeout" || msg === "symbol_rollup_budget_exhausted") {
      const sym = underlyingSymbol.toUpperCase();
      const date = forDate ?? todayIso();
      logFlowPipelineWarn(
        "rollup_symbol_timeout",
        "optionsFlowRollup: per-symbol rollup exceeded wall-clock budget (analysis continues)",
        { underlyingSymbol: sym, date, maxMs, durationMs: Date.now() - t0 },
      );
      return { rowsUpserted: 0, rawScanned: 0, durationMs: Date.now() - t0, timedOut: true };
    }
    throw err;
  }
}

let lastRawScanned = 0;

async function tick(): Promise<void> {
  if (!isMarketHoursUtc()) return;
  try {
    const { rowsUpserted, rawScanned, durationMs } = await runRollupOnce();
    totalRuns++;
    lastRunTs = Date.now();
    lastRunRows = rowsUpserted;
    lastRawScanned = rawScanned;
    lastRunMs = durationMs;
    logger.info({
      op: "flowRollup.tick",
      rawScanned,
      strikesUpserted: rowsUpserted,
      durationMs,
      runIdx: totalRuns,
    }, `Flow rollup: ${rawScanned} raw → ${rowsUpserted} strikes (${durationMs}ms)`);
  } catch (err) {
    totalFailures++;
    logFlowPipelineWarn(
      "rollup_tick",
      "Flow rollup tick failed",
      { err, totalFailures, totalRuns },
    );
  }
}

export function startFlowRollup(): void {
  if (rollupTimer) return;
  rollupTimer = setInterval(() => { void tick(); }, ROLLUP_INTERVAL_MS);
  rollupTimer.unref?.();
  void tick();
  logger.info({ op: "flowRollup.start", intervalMs: ROLLUP_INTERVAL_MS }, "Options flow rollup started");
}

export function stopFlowRollup(): void {
  if (rollupTimer) { clearInterval(rollupTimer); rollupTimer = null; }
}

export function getFlowRollupStats() {
  return {
    lastRunTs,
    lastRunRows,
    lastRunMs,
    lastRawScanned,
    totalRuns,
    totalFailures,
    intervalMs: ROLLUP_INTERVAL_MS,
  };
}
