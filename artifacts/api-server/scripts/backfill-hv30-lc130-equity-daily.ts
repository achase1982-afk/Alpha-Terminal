/**
 * One-shot: recompute hv_30d on equity_daily for Liquid Core 130 from existing closes.
 *
 * Run from the api HTTP service package root (where this scripts/ folder lives):
 *   ./node_modules/.bin/tsx scripts/backfill-hv30-lc130-equity-daily.ts
 *
 * Requires DATABASE_URL. No external market APIs.
 */
import "../src/loadEnv.js";
import { db, equityDailyTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../src/data/liquidCore130";
import { computeHV30 } from "../src/lib/dailySnapshot";

async function main() {
  const symbols = [...LIQUID_CORE_SYMBOL_STRINGS.map((s) => s.toUpperCase())];
  console.log(JSON.stringify({ event: "hv30_backfill_start", symbols: symbols.length }));

  const rows = await db
    .select({
      symbol: equityDailyTable.symbol,
      date: equityDailyTable.date,
      close: equityDailyTable.close,
    })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, symbols))
    .orderBy(equityDailyTable.symbol, equityDailyTable.date);

  const bySym = new Map<string, Array<{ date: string; close: number }>>();
  for (const r of rows) {
    const c = r.close;
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const d = typeof r.date === "string" ? r.date : (r.date as Date).toISOString().slice(0, 10);
    const sym = String(r.symbol).toUpperCase();
    if (!bySym.has(sym)) bySym.set(sym, []);
    bySym.get(sym)!.push({ date: d, close: c });
  }

  let updates = 0;
  for (const [sym, series] of bySym) {
    const closes = series.map((x) => x.close);
    for (let i = 0; i < series.length; i++) {
      const hv30 = computeHV30(closes.slice(0, i + 1));
      if (hv30 == null) continue;
      await db
        .update(equityDailyTable)
        .set({ hv30d: hv30 })
        .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, series[i]!.date)));
      updates++;
    }
  }

  console.log(JSON.stringify({
    event: "hv30_backfill_done",
    equityRowsRead: rows.length,
    hv30Updates: updates,
  }));
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "hv30_backfill_fatal", error: (e as Error).message }));
  process.exit(1);
});
