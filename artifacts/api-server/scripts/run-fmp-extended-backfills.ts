/**
 * One-shot: equity_daily history + earnings surprises (full limit) + analyst_estimates.
 * Run from this package root: `pnpm exec tsx scripts/run-fmp-extended-backfills.ts`
 *
 * Requires DATABASE_URL and FMP_API_KEY.
 */
import "../src/loadEnv.js";
import {
  backfillAnalystEstimates,
  backfillEarningsSurprises,
  backfillEquityDailyHistory,
} from "../src/lib/fmpBackfill.js";

async function main(): Promise<void> {
  console.log("1/3 equity_daily_history...");
  const eq = await backfillEquityDailyHistory();
  console.log(JSON.stringify(eq, null, 2));

  console.log("2/3 earnings_surprises...");
  const es = await backfillEarningsSurprises();
  console.log(JSON.stringify(es, null, 2));

  console.log("3/3 analyst_estimates...");
  const ae = await backfillAnalystEstimates();
  console.log(JSON.stringify(ae, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
