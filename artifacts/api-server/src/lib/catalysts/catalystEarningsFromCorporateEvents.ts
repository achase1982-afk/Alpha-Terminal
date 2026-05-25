import { and, gte, inArray } from "drizzle-orm";
import { corporateEventsTable, db } from "@workspace/db";

export type ForwardEarningsFromDb = {
  nextEarningsDate: string;
  /** FMP calendar rows are treated as estimated until a confirmed source exists. */
  earningsConfirmed: boolean;
};

/** Forward next earnings from FMP-backed `corporate_events` (primary for Catalysts). */
export async function loadForwardEarningsFromCorporateEvents(
  symbols: string[],
  opts?: { horizonDays?: number },
): Promise<Map<string, ForwardEarningsFromDb>> {
  const out = new Map<string, ForwardEarningsFromDb>();
  const horizon = opts?.horizonDays ?? 120;
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + horizon);
  const endYmd = end.toISOString().slice(0, 10);

  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(Boolean);
  const chunkSize = 250;

  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const rows = await db
      .select({
        symbol: corporateEventsTable.symbol,
        earningsDate: corporateEventsTable.earningsDate,
      })
      .from(corporateEventsTable)
      .where(
        and(
          inArray(corporateEventsTable.symbol, chunk),
          gte(corporateEventsTable.earningsDate, today),
        ),
      );

    for (const r of rows) {
      const sym = r.symbol.toUpperCase();
      const ymd = r.earningsDate ? String(r.earningsDate).slice(0, 10) : null;
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd) || ymd > endYmd) continue;
      const prev = out.get(sym);
      if (!prev || ymd < prev.nextEarningsDate) {
        out.set(sym, { nextEarningsDate: ymd, earningsConfirmed: false });
      }
    }
  }

  return out;
}
