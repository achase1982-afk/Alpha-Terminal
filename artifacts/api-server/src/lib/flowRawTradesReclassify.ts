/**
 * Item 24: prune old raw flow rows; prune Schwab CHART_EQUITY minute bars (30d);
 * refresh volume_vs_baseline_20d from options_flow_strike_baseline_daily (04:45 UTC nightly).
 */

import { db, lt, optionsFlowRawTradesTable, schwabChartEquityBarsTable, sql } from "@workspace/db";
import { logger } from "./logger.js";
import { logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";

const RETENTION_DAYS = 90;
const SCHWAB_CHART_EQUITY_RETENTION_DAYS = 30;

export async function pruneOptionsFlowRawTradesOlderThanRetention(): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  await db.delete(optionsFlowRawTradesTable).where(lt(optionsFlowRawTradesTable.date, cutoffStr));
  logger.info({ op: "flowRaw.prune", cutoffDate: cutoffStr, retentionDays: RETENTION_DAYS }, "options_flow_raw_trades retention prune");
}

export async function pruneSchwabChartEquityBarsOlderThanRetention(): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - SCHWAB_CHART_EQUITY_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  await db.delete(schwabChartEquityBarsTable).where(lt(schwabChartEquityBarsTable.sessionDate, cutoffStr));
  logger.info(
    { op: "schwabChartBars.prune", cutoffDate: cutoffStr, retentionDays: SCHWAB_CHART_EQUITY_RETENTION_DAYS },
    "schwab_chart_equity_bars retention prune",
  );
}

/** Recompute volume_vs_baseline_20d from materialized strike baselines (all dates with matching rows). */
export async function refreshVolumeVsBaselineFromStrikeTable(): Promise<number> {
  try {
    const res = await db.execute(sql`
      UPDATE options_flow_raw_trades AS r
      SET volume_vs_baseline_20d = ROUND((r.size::double precision / NULLIF(b.avg_volume_20d, 0))::numeric, 4)::double precision
      FROM options_flow_strike_baseline_daily AS b
      WHERE r.option_symbol = b.option_symbol
        AND r.date = b.baseline_date
        AND r.underlying_symbol = b.ticker
        AND b.avg_volume_20d > 0
    `);
    const n = (res as { rowCount?: number }).rowCount ?? 0;
    logger.info({ op: "flowRaw.rebaseline", rows: n }, "volume_vs_baseline_20d refreshed from strike baseline table");
    return n;
  } catch (err) {
    logFlowPipelineWarn(
      "flow_raw_rebaseline",
      "refreshVolumeVsBaselineFromStrikeTable failed",
      { err },
    );
    throw err;
  }
}

export async function runNightlyFlowRawMaintenance(): Promise<void> {
  await pruneOptionsFlowRawTradesOlderThanRetention();
  await pruneSchwabChartEquityBarsOlderThanRetention();
  await refreshVolumeVsBaselineFromStrikeTable();
}
