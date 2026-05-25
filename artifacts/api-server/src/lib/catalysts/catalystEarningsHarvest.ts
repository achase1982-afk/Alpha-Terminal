import { sql } from "drizzle-orm";
import { catalystEarningsDatesTable, db } from "@workspace/db";
import { SP_COMPOSITE_1500_SYMBOL_STRINGS } from "../../data/spComposite1500Symbols.js";
import { logger } from "../logger.js";
import { fetchSchwabEarningsDatesBestToken } from "./schwabEarningsFromQuotes.js";

/** ~4s between 50-symbol batches → ~2 min for 1,500 names (rate-limit safe). */
export const CATALYST_EARNINGS_BATCH_DELAY_MS = 4_000;

export type CatalystEarningsHarvestReport = {
  sweepId: string;
  symbols: number;
  written: number;
  withDate: number;
  startedAt: string;
  finishedAt: string;
};

function newSweepId(): string {
  return `catalyst-earnings-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * Weekly paced sweep: harvest Schwab `nextEarningsDate` for every S&P Composite 1500 symbol.
 */
export async function runCatalystEarningsHarvest(opts?: {
  delayBetweenBatchesMs?: number;
}): Promise<CatalystEarningsHarvestReport> {
  const sweepId = newSweepId();
  const startedAt = new Date();
  const symbols = [...SP_COMPOSITE_1500_SYMBOL_STRINGS];
  const harvestedAt = new Date();

  const quotes = await fetchSchwabEarningsDatesBestToken(symbols, {
    delayBetweenBatchesMs: opts?.delayBetweenBatchesMs ?? CATALYST_EARNINGS_BATCH_DELAY_MS,
  });

  let written = 0;
  let withDate = 0;

  const rows = symbols.map((sym) => {
    const upper = sym.toUpperCase();
    const q = quotes.get(upper);
    const nextDate = q?.nextEarningsDate ?? null;
    if (nextDate) withDate += 1;
    return {
      symbol: upper,
      nextEarningsDate: nextDate,
      earningsConfirmed: q?.earningsConfirmed ?? null,
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
    withDate,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };

  logger.info(report, "Catalyst earnings harvest complete");
  return report;
}
