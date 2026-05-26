import { sql } from "drizzle-orm";
import { CATALYSTS_WINDOW_CALENDAR_DAYS } from "@workspace/catalysts-types";
import { catalystEarningsDatesTable, db } from "@workspace/db";
import { backfillEarningsCalendarForSp1500 } from "../fmpBackfill.js";
import { SP_COMPOSITE_1500_SYMBOL_STRINGS } from "../../data/spComposite1500Symbols.js";
import { logger } from "../logger.js";
import { loadForwardEarningsFromCorporateEvents } from "./catalystEarningsFromCorporateEvents.js";
import { fetchSchwabEarningsDatesBestToken } from "./schwabEarningsFromQuotes.js";

/** ~4s between 50-symbol batches → ~2 min for 1,500 names (rate-limit safe). */
export const CATALYST_EARNINGS_BATCH_DELAY_MS = 4_000;

export type CatalystEarningsHarvestReport = {
  sweepId: string;
  symbols: number;
  written: number;
  withLastDate: number;
  withNextDate: number;
  fmpBackfillSymbolsTouched: number;
  startedAt: string;
  finishedAt: string;
};

function newSweepId(): string {
  return `catalyst-earnings-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * Weekly Catalysts earnings harvest for S&P Composite 1500.
 *
 * 1. FMP earnings calendar → `corporate_events` (primary `next_earnings_date` source).
 * 2. Schwab batch `/quotes` → `last_earnings_date` (reference; always stored when present).
 * 3. Merge forward `corporate_events` into `catalyst_earnings_dates`.
 */
export async function runCatalystEarningsHarvest(opts?: {
  delayBetweenBatchesMs?: number;
  skipFmpBackfill?: boolean;
  fmpWindowDays?: number;
}): Promise<CatalystEarningsHarvestReport> {
  const sweepId = newSweepId();
  const startedAt = new Date();
  const symbols = [...SP_COMPOSITE_1500_SYMBOL_STRINGS];
  const harvestedAt = new Date();

  let fmpBackfillSymbolsTouched = 0;
  if (!opts?.skipFmpBackfill) {
    const fmpDays = opts?.fmpWindowDays ?? CATALYSTS_WINDOW_CALENDAR_DAYS + 11;
    const backfill = await backfillEarningsCalendarForSp1500(fmpDays);
    fmpBackfillSymbolsTouched = backfill.symbolsTouched;
  }

  const quotes = await fetchSchwabEarningsDatesBestToken(symbols, {
    delayBetweenBatchesMs: opts?.delayBetweenBatchesMs ?? CATALYST_EARNINGS_BATCH_DELAY_MS,
  });

  const forward = await loadForwardEarningsFromCorporateEvents(symbols);

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
    symbols: symbols.length,
    written,
    withLastDate,
    withNextDate,
    fmpBackfillSymbolsTouched,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };

  logger.info(report, "Catalyst earnings harvest complete");
  return report;
}
