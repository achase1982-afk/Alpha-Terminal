import { and, desc, inArray, isNotNull, lt } from "drizzle-orm";
import { corporateEventsTable, db } from "@workspace/db";
import type { EarningsTiming } from "@workspace/catalysts-types";

const MIN_CONSISTENT_REPORTS = 3;
const LOOKBACK_ROWS = 8;

function inferFromRows(timings: string[]): EarningsTiming {
  const bmo = timings.filter((t) => t === "BMO").length;
  const amc = timings.filter((t) => t === "AMC").length;
  if (bmo >= MIN_CONSISTENT_REPORTS && bmo > amc) return "BMO";
  if (amc >= MIN_CONSISTENT_REPORTS && amc > bmo) return "AMC";
  return null;
}

/**
 * Batch-load BMO/AMC hints for Catalysts cards (one DB round-trip).
 * Infers from historical `corporate_events.earnings_timing` when ≥3 of last 8 reports agree.
 */
export async function loadEarningsTimingHints(symbols: string[]): Promise<Map<string, EarningsTiming>> {
  const out = new Map<string, EarningsTiming>();
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(Boolean);
  if (uniq.length === 0) return out;

  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      symbol: corporateEventsTable.symbol,
      timing: corporateEventsTable.earningsTiming,
      earningsDate: corporateEventsTable.earningsDate,
    })
    .from(corporateEventsTable)
    .where(
      and(
        inArray(corporateEventsTable.symbol, uniq),
        lt(corporateEventsTable.earningsDate, today),
        isNotNull(corporateEventsTable.earningsTiming),
      ),
    )
    .orderBy(desc(corporateEventsTable.earningsDate));

  const bySym = new Map<string, string[]>();
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    const list = bySym.get(sym) ?? [];
    if (list.length >= LOOKBACK_ROWS) continue;
    if (r.timing === "BMO" || r.timing === "AMC") list.push(r.timing);
    bySym.set(sym, list);
  }

  for (const sym of uniq) {
    out.set(sym, inferFromRows(bySym.get(sym) ?? []));
  }
  return out;
}
