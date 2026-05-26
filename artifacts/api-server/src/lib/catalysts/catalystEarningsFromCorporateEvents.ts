import { and, gte, lte } from "drizzle-orm";
import { corporateEventsTable, db } from "@workspace/db";

export type ForwardEarningsFromDb = {
  nextEarningsDate: string;
  /** FMP calendar rows are treated as estimated until a confirmed source exists. */
  earningsConfirmed: boolean;
};

function horizonEndYmd(horizonDays: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + horizonDays);
  return end.toISOString().slice(0, 10);
}

/**
 * Forward next earnings from FMP-backed `corporate_events` for all symbols in horizon.
 * No index filter — tradeability gate runs at feed build time.
 */
export async function loadAllForwardEarningsInHorizon(
  horizonDays: number,
): Promise<Map<string, ForwardEarningsFromDb>> {
  const out = new Map<string, ForwardEarningsFromDb>();
  const today = new Date().toISOString().slice(0, 10);
  const endYmd = horizonEndYmd(horizonDays);

  const rows = await db
    .select({
      symbol: corporateEventsTable.symbol,
      earningsDate: corporateEventsTable.earningsDate,
    })
    .from(corporateEventsTable)
    .where(
      and(
        gte(corporateEventsTable.earningsDate, today),
        lte(corporateEventsTable.earningsDate, endYmd),
      ),
    );

  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    const ymd = r.earningsDate ? String(r.earningsDate).slice(0, 10) : null;
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    const prev = out.get(sym);
    if (!prev || ymd < prev.nextEarningsDate) {
      out.set(sym, { nextEarningsDate: ymd, earningsConfirmed: false });
    }
  }

  return out;
}

/** @deprecated Use {@link loadAllForwardEarningsInHorizon} — scoped queries removed. */
export async function loadForwardEarningsFromCorporateEvents(
  symbols: string[],
  opts?: { horizonDays?: number },
): Promise<Map<string, ForwardEarningsFromDb>> {
  const all = await loadAllForwardEarningsInHorizon(opts?.horizonDays ?? 16);
  if (symbols.length === 0) return all;
  const want = new Set(symbols.map((s) => s.toUpperCase()));
  const out = new Map<string, ForwardEarningsFromDb>();
  for (const [sym, v] of all) {
    if (want.has(sym)) out.set(sym, v);
  }
  return out;
}
