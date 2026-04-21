import { db, optionsFlowExecPerStrikeTable, optionsFlowRawTradesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// Periodic rollup of options_flow_raw_trades → options_flow_exec_per_strike.
//
// Runs every ROLLUP_INTERVAL_MS during market hours. Aggregates today's raw
// trades into per-strike summaries (sweep/block/regular counts + notional +
// volume). Idempotent: full re-aggregation per call, upserted on the unique
// composite key, so partial failures or restart never produce duplicates.

const ROLLUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let rollupTimer: ReturnType<typeof setInterval> | null = null;
let lastRunTs: number | null = null;
let lastRunRows = 0;
let lastRunMs = 0;
let totalRuns = 0;
let totalFailures = 0;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isMarketHoursUtc(d = new Date()): boolean {
  // US options regular hours roughly 13:30–20:30 UTC, with a +30min buffer
  // either side to capture pre/post settlement prints.
  const h = d.getUTCHours() * 60 + d.getUTCMinutes();
  return h >= 13 * 60 && h <= 21 * 60;
}

export async function runRollupOnce(forDate?: string): Promise<{ rowsUpserted: number; durationMs: number }> {
  const t0 = Date.now();
  const date = forDate ?? todayIso();

  // Aggregate raw trades for the date, grouped by strike key.
  // sweep takes precedence over block in classification (Polygon's sweep
  // condition often co-occurs with size>=100); regular = neither.
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

  const durationMs = Date.now() - t0;
  const rowsUpserted = (rolled as any).rowCount ?? 0;
  return { rowsUpserted, durationMs };
}

async function tick(): Promise<void> {
  if (!isMarketHoursUtc()) return; // skip overnight/weekends — nothing new flowing
  try {
    const { rowsUpserted, durationMs } = await runRollupOnce();
    totalRuns++;
    lastRunTs = Date.now();
    lastRunRows = rowsUpserted;
    lastRunMs = durationMs;
    logger.info({ op: "flowRollup.tick", rows: rowsUpserted, durationMs }, "Flow rollup tick");
  } catch (err) {
    totalFailures++;
    logger.warn({ err, op: "flowRollup.tick.failed" }, "Flow rollup tick failed");
  }
}

export function startFlowRollup(): void {
  if (rollupTimer) return;
  rollupTimer = setInterval(() => { void tick(); }, ROLLUP_INTERVAL_MS);
  rollupTimer.unref?.();
  // Fire once on startup so the first scan after restart isn't empty.
  void tick();
  logger.info({ op: "flowRollup.start", intervalMs: ROLLUP_INTERVAL_MS }, "Options flow rollup started");
}

export function stopFlowRollup(): void {
  if (rollupTimer) { clearInterval(rollupTimer); rollupTimer = null; }
}

export function getFlowRollupStats() {
  return { lastRunTs, lastRunRows, lastRunMs, totalRuns, totalFailures, intervalMs: ROLLUP_INTERVAL_MS };
}
