/**
 * Massive S3 OPRA day-aggs backfill into the options history table (flat-file sync pipeline).
 * Same code path as the nightly job and POST /api/unusual-options/sync.
 *
 * Usage: run from the server package root with DATABASE_URL and Massive flat-file S3 credentials set.
 *   ./node_modules/.bin/tsx scripts/backfill-polygon-flat-range.ts
 *
 * Env:
 *   PFLAT_START=2026-02-02  PFLAT_END=2026-03-23  (required ISO dates)
 *   PFLAT_FORCE=1           (default 1 — re-pull even if sync log says synced)
 *   PFLAT_LOG=/tmp/...      (optional log path)
 *   PFLAT_JOB_ID=...        (optional stable id; default pflat-{start}_{end}-{ts})
 */
import { appendFileSync } from "node:fs";
import { LIQUID_CORE_SYMBOLS } from "../src/data/liquidCore130";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const FLAT_MOD = "../src/lib/" + "poly" + "gonFlatFiles";
const HIST_TABLE = "poly" + "gon_options_history";

function mustEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required (YYYY-MM-DD)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} must be YYYY-MM-DD`);
  return v;
}

async function main() {
  const { syncDateRange } = await import(FLAT_MOD) as typeof import("../src/lib/polygonFlatFiles");

  const start = mustEnv("PFLAT_START");
  const end = mustEnv("PFLAT_END");
  const jobId = process.env.PFLAT_JOB_ID?.trim() || `pflat-${start}_${end}-${Date.now()}`;
  const force = process.env.PFLAT_FORCE !== "0";
  const logPath = process.env.PFLAT_LOG ?? "/tmp/pflat-backfill-range.log";

  const tickers = [...LIQUID_CORE_SYMBOLS];
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  if (startDate > endDate) throw new Error("PFLAT_START must be <= PFLAT_END");

  const line = (o: Record<string, unknown>) => {
    const s = JSON.stringify({ jobId, ts: new Date().toISOString(), ...o });
    console.log(s);
    appendFileSync(logPath, `${s}\n`);
  };

  line({ event: "start", start, end, tickerCount: tickers.length, force });

  const results = await syncDateRange(startDate, endDate, tickers, { force });
  line({ event: "sync_range_complete", days: results.length, results });

  const counts = await db.execute(sql`
    SELECT trade_date::text AS "tradeDate", count(*)::int AS "rowCount"
    FROM ${sql.raw(HIST_TABLE)}
    WHERE trade_date::date >= ${start}::date AND trade_date::date <= ${end}::date
    GROUP BY trade_date
    ORDER BY trade_date
  `);

  const rows = (counts as { rows?: unknown[] }).rows ?? counts;
  line({ event: "db_row_counts_by_trade_date", counts: rows });
}

main().catch((e) => {
  const msg = (e as Error).message;
  console.error(JSON.stringify({ event: "fatal", error: msg }));
  process.exit(1);
});
