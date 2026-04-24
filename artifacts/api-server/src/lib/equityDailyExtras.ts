import { db, equityDailyTable } from "@workspace/db";
import { desc, eq, sql, and, gte } from "drizzle-orm";
import { logger } from "./logger.js";

export interface EquityDailyExtras {
  asOfDate: string;
  iv30d: number | null;
  iv30dProxy: number | null;
  hv20d: number | null;
  hv30d: number | null;
  /** iv30d / hv20d, rounded to 2dp. Null when either input is null/zero. */
  ivHvRatio: number | null;
  /** Daily-snapshot scalar from equity_daily.put_call_ratio (distinct from
   *  the chain-derived and Polygon-flow-derived P/C ratios). May be null for
   *  many tickers — the dailySnapshot job populates it inconsistently. */
  putCallRatioDaily: number | null;
  sma20: number | null;
  atr20: number | null;
  /** Relative strength vs SPY = ticker.close / SPY.close (same date). */
  rsRatio: number | null;
  priceChangePct5d: number | null;
  priceChangePct10d: number | null;
  /** 252-day high / low computed from the equity_daily history for this
   *  symbol (max of high, min of low; falls back to close when high/low
   *  is null on a row). Null when no history rows exist in the window. */
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Latest close — useful for computing % distance from 52w levels. */
  close: number | null;
}

/**
 * Read the latest equity_daily snapshot row for a symbol plus a 252-day
 * (≈365 calendar days) high/low aggregate. Returns null when no rows exist
 * for the symbol. Best-effort: any DB exception is logged as a warning and
 * resolves to null so the validate path can degrade gracefully.
 *
 * Why a separate helper instead of inlining in the route: we want a single
 * place to coerce nulls / round / compute IV/HV ratio, so the data package
 * formatter can render uniformly without re-implementing those rules.
 */
export async function getEquityDailyExtras(symbol: string): Promise<EquityDailyExtras | null> {
  const sym = symbol.toUpperCase();
  try {
    const latestRows = await db
      .select()
      .from(equityDailyTable)
      .where(eq(equityDailyTable.symbol, sym))
      .orderBy(desc(equityDailyTable.date))
      .limit(1);
    if (latestRows.length === 0) return null;
    const latest = latestRows[0];

    // 52-week high/low: 365 calendar days ≈ 252 trading rows. Restrict to
    // the cutoff so we never let a 5-year-old all-time-high show up here.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const w52 = await db
      .select({
        max: sql<number | null>`max(coalesce(${equityDailyTable.high}, ${equityDailyTable.close}))`,
        min: sql<number | null>`min(coalesce(${equityDailyTable.low},  ${equityDailyTable.close}))`,
      })
      .from(equityDailyTable)
      .where(and(
        eq(equityDailyTable.symbol, sym),
        gte(equityDailyTable.date, cutoffStr),
      ));

    const fiftyTwoWeekHigh = w52[0]?.max ?? null;
    const fiftyTwoWeekLow  = w52[0]?.min ?? null;

    const iv30d = latest.iv30d ?? null;
    const hv20d = latest.hv20d ?? null;
    const ivHvRatio = (iv30d != null && hv20d != null && hv20d > 0)
      ? Math.round((iv30d / hv20d) * 100) / 100
      : null;

    return {
      asOfDate: latest.date,
      iv30d,
      iv30dProxy: latest.iv30dProxy ?? null,
      hv20d,
      hv30d: latest.hv30d ?? null,
      ivHvRatio,
      putCallRatioDaily: latest.putCallRatio ?? null,
      sma20: latest.sma20 ?? null,
      atr20: latest.atr20 ?? null,
      rsRatio: latest.rsRatio ?? null,
      priceChangePct5d: latest.priceChangePct5d ?? null,
      priceChangePct10d: latest.priceChangePct10d ?? null,
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow,
      close: latest.close ?? null,
    };
  } catch (err) {
    logger.warn({ err, symbol: sym }, "equityDailyExtras: lookup failed");
    return null;
  }
}
