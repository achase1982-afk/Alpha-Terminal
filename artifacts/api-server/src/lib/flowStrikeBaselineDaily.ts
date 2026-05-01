/**
 * Item 3: persist per-OCC 20d rolling volume baselines into
 * `options_flow_strike_baseline_daily` for reuse by tape + re-classify jobs.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, optionsFlowStrikeBaselineDailyTable } from "@workspace/db";
import { getContracts20dBaselineBatch } from "./optionsBaselines.js";
import { logger } from "./logger.js";

export async function upsertStrikeVolumeBaselinesForSymbols(args: {
  ticker: string;
  baselineDate: string;
  optionSymbols: string[];
  referenceDate?: Date;
}): Promise<number> {
  const sym = args.ticker.toUpperCase();
  const uniq = [...new Set(args.optionSymbols.map((s) => s.trim()).filter(Boolean))];
  if (uniq.length === 0) return 0;
  const ref =
    args.referenceDate
    ?? new Date(`${args.baselineDate}T17:00:00-04:00`);
  const map = await getContracts20dBaselineBatch(uniq, { referenceDate: ref });
  if (map.size === 0) return 0;
  let n = 0;
  for (const [optionSymbol, row] of map) {
    await db
      .insert(optionsFlowStrikeBaselineDailyTable)
      .values({
        ticker: sym,
        optionSymbol,
        baselineDate: args.baselineDate,
        avgVolume20d: row.avgVolume,
        daysObserved: row.daysObserved,
      })
      .onConflictDoUpdate({
        target: [
          optionsFlowStrikeBaselineDailyTable.optionSymbol,
          optionsFlowStrikeBaselineDailyTable.baselineDate,
        ],
        set: {
          avgVolume20d: row.avgVolume,
          daysObserved: row.daysObserved,
          ticker: sym,
          updatedAt: new Date(),
        },
      });
    n++;
  }
  logger.info(
    { op: "flowStrikeBaseline.upsert", ticker: sym, baselineDate: args.baselineDate, rows: n },
    "options_flow_strike_baseline_daily upserted",
  );
  return n;
}

/** Upsert when baseline was already computed (avoids duplicate history query). */
export async function upsertStrikeVolumeBaselineFromContractBaseline(args: {
  ticker: string;
  baselineDate: string;
  optionSymbol: string;
  avgVolume20d: number;
  daysObserved: number;
}): Promise<void> {
  const sym = args.ticker.toUpperCase();
  await db
    .insert(optionsFlowStrikeBaselineDailyTable)
    .values({
      ticker: sym,
      optionSymbol: args.optionSymbol,
      baselineDate: args.baselineDate,
      avgVolume20d: args.avgVolume20d,
      daysObserved: args.daysObserved,
    })
    .onConflictDoUpdate({
      target: [
        optionsFlowStrikeBaselineDailyTable.optionSymbol,
        optionsFlowStrikeBaselineDailyTable.baselineDate,
      ],
      set: {
        avgVolume20d: args.avgVolume20d,
        daysObserved: args.daysObserved,
        ticker: sym,
        updatedAt: new Date(),
      },
    });
}

export async function fetchStrikeVolumeBaselinesForDate(
  optionSymbols: string[],
  baselineDate: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(optionSymbols.map((s) => s.trim()).filter(Boolean))];
  if (uniq.length === 0) return out;
  const rows = await db
    .select({
      optionSymbol: optionsFlowStrikeBaselineDailyTable.optionSymbol,
      avgVolume20d: optionsFlowStrikeBaselineDailyTable.avgVolume20d,
    })
    .from(optionsFlowStrikeBaselineDailyTable)
    .where(
      and(
        inArray(optionsFlowStrikeBaselineDailyTable.optionSymbol, uniq),
        eq(optionsFlowStrikeBaselineDailyTable.baselineDate, baselineDate),
      ),
    );
  for (const r of rows) {
    if (r.avgVolume20d > 0) out.set(r.optionSymbol, r.avgVolume20d);
  }
  return out;
}
