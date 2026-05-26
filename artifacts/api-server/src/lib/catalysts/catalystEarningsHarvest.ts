import { sql } from "drizzle-orm";
import { catalystEarningsDatesTable, db } from "@workspace/db";
import { backfillEarningsCalendarForCatalystsHarvest } from "../fmpBackfill.js";
import { logger } from "../logger.js";
import { CATALYST_EARNINGS_HARVEST_FORWARD_DAYS } from "./catalystEarningsConstants.js";
import { loadAllForwardEarningsInHorizon } from "./catalystEarningsFromCorporateEvents.js";
import { fetchSchwabEarningsDatesBestToken } from "./schwabEarningsFromQuotes.js";

/** ~4s between 50-symbol batches — rate-limit safe for weekly Schwab last-date pull. */
export const CATALYST_EARNINGS_BATCH_DELAY_MS = 4_000;

export type CatalystEarningsHarvestReport = {
  sweepId: string;
  symbolsDiscovered: number;
  written: number;
  withLastDate: number;
  withNextDate: number;
  fmpBackfillSymbolsTouched: number;
  fmpRowsRaw: number;
  fmpWindowTruncated: boolean;
  startedAt: string;
  finishedAt: string;
};

function newSweepId(): string {
  return `catalyst-earnings-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * Weekly Catalysts earnings harvest — full FMP calendar in window (no index gate).
 *
 * 1. FMP earnings calendar → `corporate_events` ({@link CATALYST_EARNINGS_HARVEST_FORWARD_DAYS} days).
 * 2. Schwab `/quotes` last-earnings for discovered symbols only.
 * 3. Upsert `catalyst_earnings_dates` (tradeability gate runs at feed build).
 */
export async function runCatalystEarningsHarvest(opts?: {
  delayBetweenBatchesMs?: number;
  skipFmpBackfill?: boolean;
  harvestForwardDays?: number;
}): Promise<CatalystEarningsHarvestReport> {
  const sweepId = newSweepId();
  const startedAt = new Date();
  const forwardDays = opts?.harvestForwardDays ?? CATALYST_EARNINGS_HARVEST_FORWARD_DAYS;
  const harvestedAt = new Date();

  let fmpBackfillSymbolsTouched = 0;
  let fmpRowsRaw = 0;
  let fmpWindowTruncated = false;

  if (!opts?.skipFmpBackfill) {
    const backfill = await backfillEarningsCalendarForCatalystsHarvest(forwardDays);
    fmpBackfillSymbolsTouched = backfill.symbolsTouched;
    fmpRowsRaw = backfill.fmpRowsRaw;
    fmpWindowTruncated = backfill.windowTruncated;
  }

  const forward = await loadAllForwardEarningsInHorizon(forwardDays);
  const symbols = [...forward.keys()];

  const quotes = await fetchSchwabEarningsDatesBestToken(symbols, {
    delayBetweenBatchesMs: opts?.delayBetweenBatchesMs ?? CATALYST_EARNINGS_BATCH_DELAY_MS,
  });

  let written = 0;
  let withLastDate = 0;
  let withNextDate = 0;

  const rows = symbols.map((sym) => {
    const upper = sym.toUpperCase();
    const q = quotes.get(upper);
    const lastDate = q?.lastEarningsDate ?? null;
    const corp = forward.get(upper);
    const nextDate = corp?.nextEarningsDate ?? q?.nextEarningsDate ?? null;
    const earningsConfirmed =
      corp != null ? corp.earningsConfirmed : (q?.earningsConfirmed ?? null);

    if (lastDate) withLastDate += 1;
    if (nextDate) withNextDate += 1;

    return {
      symbol: upper,
      lastEarningsDate: lastDate,
      nextEarningsDate: nextDate,
      earningsConfirmed,
      harvestedAt,
      sweepId,
    };
  });

  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db
      .insert(catalystEarningsDatesTable)
      .values(chunk)
      .onConflictDoUpdate({
        target: catalystEarningsDatesTable.symbol,
        set: {
          lastEarningsDate: sql`excluded.last_earnings_date`,
          nextEarningsDate: sql`excluded.next_earnings_date`,
          earningsConfirmed: sql`excluded.earnings_confirmed`,
          harvestedAt: sql`excluded.harvested_at`,
          sweepId: sql`excluded.sweep_id`,
        },
      });
    written += chunk.length;
  }

  const finishedAt = new Date();
  const report: CatalystEarningsHarvestReport = {
    sweepId,
    symbolsDiscovered: symbols.length,
    written,
    withLastDate,
    withNextDate,
    fmpBackfillSymbolsTouched,
    fmpRowsRaw,
    fmpWindowTruncated,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };

  logger.info(report, "Catalyst earnings harvest complete");
  return report;
}
