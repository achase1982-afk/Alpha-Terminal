/**
 * CLI: Path B BSM historical IV backfill (Polygon) for Liquid Core 130 + sector ETFs.
 * Run from this package directory with tsx.
 * Requires DATABASE_URL and the Polygon API key in the environment.
 */
import { backfillHistoricalIV } from "../src/lib/historicalIVBackfill";
import { LIQUID_CORE_SYMBOLS } from "../src/data/liquidCore130";

const DAYS = 252;

async function main() {
  const symbols = [...LIQUID_CORE_SYMBOLS];
  console.log(JSON.stringify({
    event: "pathb_backfill_start",
    symbols: symbols.length,
    daysBack: DAYS,
    pid: process.pid,
  }));
  const report = await backfillHistoricalIV(symbols, DAYS);
  console.log(JSON.stringify({ event: "pathb_backfill_done", report }));
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "pathb_backfill_fatal", error: (e as Error).message }));
  process.exit(1);
});
