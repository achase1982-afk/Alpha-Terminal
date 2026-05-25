/**
 * One-shot: FMP SP1500 earnings calendar backfill + Schwab last-earnings harvest → catalyst_earnings_dates.
 *
 * Usage (from artifacts/api-server):
 *   pnpm run catalyst:harvest
 *
 * Optional env:
 *   CATALYST_EARNINGS_BATCH_DELAY_MS=1000
 *   CATALYST_EARNINGS_SKIP_FMP_BACKFILL=1
 */
import "../loadEnv.js";
import { eq } from "drizzle-orm";
import { initTokenStore, getBestAccessToken } from "../lib/tokenStore.js";
import { ensureCatalystEarningsDatesTable } from "../lib/ensureCatalystEarningsDatesSchema.js";
import {
  runCatalystEarningsHarvest,
  CATALYST_EARNINGS_BATCH_DELAY_MS,
} from "../lib/catalysts/catalystEarningsHarvest.js";
import { catalystEarningsDatesTable, db } from "@workspace/db";

async function main(): Promise<void> {
  await initTokenStore();
  const token = getBestAccessToken();
  if (!token) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "no_schwab_token",
        hint: "Connect Schwab (market or trader) so token store is populated.",
      }),
    );
    process.exit(1);
  }

  await ensureCatalystEarningsDatesTable();

  const delayRaw = process.env["CATALYST_EARNINGS_BATCH_DELAY_MS"];
  const delayMs = delayRaw ? Math.max(0, Number(delayRaw)) : CATALYST_EARNINGS_BATCH_DELAY_MS;
  const skipFmp = process.env["CATALYST_EARNINGS_SKIP_FMP_BACKFILL"] === "1";

  console.log(
    JSON.stringify({ msg: "catalyst_earnings_harvest_start", batchDelayMs: delayMs, skipFmpBackfill: skipFmp }),
  );

  const report = await runCatalystEarningsHarvest({
    delayBetweenBatchesMs: delayMs,
    skipFmpBackfill: skipFmp,
  });

  const sweepRows = await db
    .select({
      symbol: catalystEarningsDatesTable.symbol,
      lastEarningsDate: catalystEarningsDatesTable.lastEarningsDate,
      nextEarningsDate: catalystEarningsDatesTable.nextEarningsDate,
    })
    .from(catalystEarningsDatesTable)
    .where(eq(catalystEarningsDatesTable.sweepId, report.sweepId));

  const withLast = sweepRows.filter((r) => r.lastEarningsDate != null).length;
  const withNext = sweepRows.filter((r) => r.nextEarningsDate != null).length;

  console.log(
    JSON.stringify({
      ok: true,
      report,
      sweepRows: sweepRows.length,
      sweepWithLastEarningsDate: withLast,
      sweepWithNextEarningsDate: withNext,
      sample: sweepRows
        .filter((r) => r.nextEarningsDate)
        .slice(0, 8)
        .map((r) => ({
          symbol: r.symbol,
          lastEarningsDate: r.lastEarningsDate ? String(r.lastEarningsDate) : null,
          nextEarningsDate: String(r.nextEarningsDate),
        })),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
