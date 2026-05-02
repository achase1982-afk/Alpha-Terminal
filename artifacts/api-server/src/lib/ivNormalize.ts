import { db, equityDailyTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const IV_MIN_VALID = 0.01;
const IV_MAX_VALID = 5;
const IVR_MIN_HISTORY = 60;
const IVR_LOOKBACK = 252;
const HV_WINDOW = 30;
const ANNUALIZE = Math.sqrt(252);
const IVR_MAX_STALENESS_DAYS = 10;

const BROAD_INDEX = new Set(["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO"]);
const SECTOR_ETF_SET = new Set(["XLE", "XLF", "XLK", "XLU", "XLV", "XLI", "XLP", "XLY", "XLB", "XLC", "XLRE"]);

function vrpMultiplier(symbol: string): number {
  const s = symbol.toUpperCase();
  if (BROAD_INDEX.has(s)) return 1.08;
  if (SECTOR_ETF_SET.has(s)) return 1.12;
  return 1.20;
}

export function normalizeIV(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  if (!Number.isFinite(raw)) return null;
  if (raw <= -100) return null;
  let v = raw;
  if (v > IV_MAX_VALID) v = v / 100;
  if (v < IV_MIN_VALID || v > IV_MAX_VALID) return null;
  return v;
}

export function clampIVR(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Read the most recent fresh IVR for a symbol from equity_daily.
 * Prefer canonical real-IV history once available; otherwise use a fresh
 * stored proxy rank. If null is returned the caller MUST hide the field.
 */
export type IvrSource = "chain" | "flow" | "hv_proxy" | "canonical" | "real_iv" | null;

function daysOld(date: string): number {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function shouldUseProxyIvSeries(realHistoryCount: number, proxyHistoryCount: number): boolean {
  return realHistoryCount < IVR_MIN_HISTORY && proxyHistoryCount >= IVR_MIN_HISTORY;
}

async function countValidIvRows(
  symbol: string,
  date: string,
  column: typeof equityDailyTable.iv30d | typeof equityDailyTable.iv30dProxy,
): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symbol),
      sql`${equityDailyTable.date} <= ${date}`,
      sql`${column} IS NOT NULL`,
      sql`${column} >= ${IV_MIN_VALID}`,
      sql`${column} <= ${IV_MAX_VALID}`,
    ));
  return rows[0]?.c ?? 0;
}


export async function getStoredIVR(
  symbol: string,
): Promise<{ ivr: number; asOfDate: string; source: IvrSource } | null> {
  const symU = symbol.toUpperCase().trim();
  if (!symU) return null;
  const latestRealIvRows = await db
    .select({
      date: equityDailyTable.date,
      iv30d: equityDailyTable.iv30d,
    })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symU),
      sql`${equityDailyTable.iv30d} IS NOT NULL`,
    ))
    .orderBy(desc(equityDailyTable.date))
    .limit(1);

  const realIvRow = latestRealIvRows[0];
  if (realIvRow && daysOld(realIvRow.date) <= IVR_MAX_STALENESS_DAYS) {
    const realHistoryCount = await countValidIvRows(symU, realIvRow.date, equityDailyTable.iv30d);
    // No todayIvOverride: computeIVRForSymbol reads equity_daily.iv30d for both
    // the current value and the historical distribution. Apples-to-apples — both
    // come from the same path-B BSM methodology. The chain snapshot override was
    // removed because it mixed chain-derived IV (live mid-market quotes) against
    // an equity_daily history computed via a different BSM/ATM selection path,
    // producing systematically inflated IVR percentiles (e.g. COST 74% vs ToS 47%).
    const ivr = realHistoryCount >= IVR_MIN_HISTORY
      ? await computeIVRForSymbol(symU, realIvRow.date)
      : null;
    if (ivr != null) {
      const sourceRows = await db
        .select({ src: equityDailyTable.ivrSource })
        .from(equityDailyTable)
        .where(and(eq(equityDailyTable.symbol, symU), eq(equityDailyTable.date, realIvRow.date)))
        .limit(1);
      const rowSource = (sourceRows[0]?.src ?? null) as IvrSource;
      const source: IvrSource = rowSource === "real_iv" ? "real_iv" : "canonical";
      return { ivr, asOfDate: realIvRow.date, source };
    }
  }

  const storedRows = await db
    .select({
      ivr: equityDailyTable.ivr,
      date: equityDailyTable.date,
      source: equityDailyTable.ivrSource,
    })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symU),
      sql`${equityDailyTable.ivr} IS NOT NULL`,
    ))
    .orderBy(desc(equityDailyTable.date))
    .limit(1);
  const storedRow = storedRows[0];
  if (!storedRow || daysOld(storedRow.date) > IVR_MAX_STALENESS_DAYS) return null;

  const storedIvr = clampIVR(storedRow.ivr);
  if (storedIvr == null) return null;
  const storedSource = (storedRow.source ?? null) as IvrSource;
  if (!storedSource) return null;
  if (storedSource === "hv_proxy") {
    const proxyHistoryCount = await countValidIvRows(symU, storedRow.date, equityDailyTable.iv30dProxy);
    if (proxyHistoryCount < IVR_MIN_HISTORY) return null;
  }
  return { ivr: storedIvr, asOfDate: storedRow.date, source: storedSource };
}

/**
 * Compute today's HV-based IV proxy from the last HV_WINDOW closes already
 * in equity_daily. Used as a fallback when the daily snapshot writes a fresh
 * row with iv_30d but iv_30d_proxy hasn't been refreshed yet.
 */
async function computeTodayHvProxy(symbol: string, asOfDate: string): Promise<number | null> {
  const rows = await db
    .select({ close: equityDailyTable.close, date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symbol),
      sql`${equityDailyTable.date} <= ${asOfDate}`,
      sql`${equityDailyTable.close} IS NOT NULL`,
    ))
    .orderBy(desc(equityDailyTable.date))
    .limit(HV_WINDOW + 1);
  if (rows.length < HV_WINDOW + 1) return null;
  const closes = rows.map(r => r.close).reverse();
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev <= 0 || cur <= 0) return null;
    returns.push(Math.log(cur / prev));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const hv = Math.sqrt(variance) * ANNUALIZE;
  return hv * vrpMultiplier(symbol);
}

export async function computeIVRForSymbol(
  sym: string,
  date: string,
  todayIvOverride?: number | null,
): Promise<number | null> {
  const symU = sym.toUpperCase();

  // Decide which column to use as the IV history source. The two columns
  // are NOT comparable: iv_30d is real (chain/flow) IV; iv_30d_proxy is
  // realized-vol × VRP. Mixing them produces meaningless IVR. So we pick
  // ONE column and use it for both today and history (apples-to-apples).
  //
  // Rule: prefer the real IV column once it has enough history. Use the
  // HV proxy only while real chain/flow history is still insufficient.
  const realHistoryCount = await countValidIvRows(symU, date, equityDailyTable.iv30d);
  const proxyHistoryCount = await countValidIvRows(symU, date, equityDailyTable.iv30dProxy);
  const useProxyColumn = shouldUseProxyIvSeries(realHistoryCount, proxyHistoryCount);

  // When the 252-day rank uses `iv_30d_proxy` (HV×VRP), today's value MUST come
  // from the same column. `todayIvOverride` is always chain/flow IV from
  // `iv_30d` (see dailySnapshot.computeIVFromFlow / historical backfill). Mixing
  // chain IV against a proxy history pegs almost every name at IVR≈100 after
  // migration when proxy backfill crossed 60 days first — a silent data bug.
  let effectiveOverride = todayIvOverride ?? null;
  if (useProxyColumn && effectiveOverride != null) {
    logger.warn(
      { sym: symU, date },
      "computeIVRForSymbol: ignoring todayIvOverride — IVR history uses iv_30d_proxy; override was chain/flow IV (incompatible series)",
    );
    effectiveOverride = null;
  }

  let currentIv = effectiveOverride ?? null;
  if (currentIv == null) {
    const rows = await db
      .select({ iv: equityDailyTable.iv30d, ivProxy: equityDailyTable.iv30dProxy })
      .from(equityDailyTable)
      .where(and(eq(equityDailyTable.symbol, symU), eq(equityDailyTable.date, date)))
      .limit(1);
    if (useProxyColumn) {
      currentIv = rows[0]?.ivProxy ?? null;
      // Fallback: today's proxy not yet computed (e.g. snapshot didn't fill
      // it). Back-solve from the last HV_WINDOW closes already in equity_daily.
      if (currentIv == null) {
        currentIv = await computeTodayHvProxy(symU, date);
      }
    } else {
      currentIv = rows[0]?.iv ?? null;
    }
  }
  currentIv = normalizeIV(currentIv);
  if (currentIv == null) return null;

  const ivCol = useProxyColumn ? equityDailyTable.iv30dProxy : equityDailyTable.iv30d;
  const history = await db
    .select({ iv: ivCol })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symU),
      sql`${equityDailyTable.date} < ${date}`,
      sql`${ivCol} IS NOT NULL`,
      sql`${ivCol} >= ${IV_MIN_VALID}`,
      sql`${ivCol} <= ${IV_MAX_VALID}`,
    ))
    .orderBy(desc(equityDailyTable.date))
    .limit(IVR_LOOKBACK);

  if (history.length < IVR_MIN_HISTORY) return null;

  const ivValues = history.map(r => r.iv!).filter(v => v != null);
  if (ivValues.length < IVR_MIN_HISTORY) return null;

  const ivMin = Math.min(...ivValues);
  const ivMax = Math.max(...ivValues);
  if (ivMax <= ivMin) return null;

  const raw = ((currentIv - ivMin) / (ivMax - ivMin)) * 100;
  return clampIVR(raw);
}

export interface CleanupReport {
  equityRowsDividedBy100: number;
  equityRowsNulledGarbage: number;
  equityRowsNulledNegativeIvr: number;
  chainRowsDividedBy100: number;
  chainRowsNulledGarbage: number;
  flowRowsDividedBy100: number;
  flowRowsNulledGarbage: number;
}

export async function cleanupIVUnits(): Promise<CleanupReport> {
  const r1 = await db.execute(sql`
    UPDATE equity_daily SET iv_30d = iv_30d / 100
    WHERE iv_30d IS NOT NULL AND iv_30d > ${IV_MAX_VALID}
  `);
  const r2 = await db.execute(sql`
    UPDATE equity_daily SET iv_30d = NULL, ivr = NULL
    WHERE iv_30d IS NOT NULL AND (iv_30d < ${IV_MIN_VALID} OR iv_30d > ${IV_MAX_VALID})
  `);
  const r3 = await db.execute(sql`
    UPDATE equity_daily SET ivr = NULL
    WHERE ivr IS NOT NULL AND (ivr < 0 OR ivr > 100)
  `);
  const r4 = await db.execute(sql`
    UPDATE options_chain_daily SET implied_volatility = implied_volatility / 100
    WHERE implied_volatility IS NOT NULL AND implied_volatility > ${IV_MAX_VALID}
  `);
  const r5 = await db.execute(sql`
    UPDATE options_chain_daily SET implied_volatility = NULL
    WHERE implied_volatility IS NOT NULL
      AND (implied_volatility < ${IV_MIN_VALID} OR implied_volatility > ${IV_MAX_VALID} OR implied_volatility <= -100)
  `);
  const r6 = await db.execute(sql`
    UPDATE options_flow_per_strike SET implied_volatility = implied_volatility / 100
    WHERE implied_volatility IS NOT NULL AND implied_volatility > ${IV_MAX_VALID}
  `);
  const r7 = await db.execute(sql`
    UPDATE options_flow_per_strike SET implied_volatility = NULL
    WHERE implied_volatility IS NOT NULL
      AND (implied_volatility < ${IV_MIN_VALID} OR implied_volatility > ${IV_MAX_VALID} OR implied_volatility <= -100)
  `);

  const rc = (x: unknown) => (x as { rowCount?: number; count?: number })?.rowCount ?? (x as { count?: number })?.count ?? 0;
  const report: CleanupReport = {
    equityRowsDividedBy100: rc(r1),
    equityRowsNulledGarbage: rc(r2),
    equityRowsNulledNegativeIvr: rc(r3),
    chainRowsDividedBy100: rc(r4),
    chainRowsNulledGarbage: rc(r5),
    flowRowsDividedBy100: rc(r6),
    flowRowsNulledGarbage: rc(r7),
  };
  logger.info(report, "cleanupIVUnits complete");
  return report;
}

/** Count trading days with a valid close in equity_daily (for strategist vol context). */
export async function countEquityDailyCloses(symbol: string): Promise<number> {
  const symU = symbol.toUpperCase().trim();
  if (!symU) return 0;
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symU),
      sql`${equityDailyTable.close} IS NOT NULL`,
      sql`${equityDailyTable.close} > 0`,
    ));
  return rows[0]?.c ?? 0;
}

/**
 * Session dates (YYYY-MM-DD) whose closes participate in the last `nReturns`
 * close-to-close returns (calendar sessions touching those moves).
 */
function sessionDatesInLastNReturns(
  chronological: Array<{ date: string; close: number }>,
  nReturns: number,
): Set<string> {
  const dates = new Set<string>();
  const n = chronological.length;
  if (n < 2) return dates;
  const logRetLen = n - 1;
  if (logRetLen < nReturns) return dates;
  const startR = logRetLen - nReturns;
  for (let r = startR; r <= logRetLen - 1; r++) {
    dates.add(chronological[r]!.date);
    dates.add(chronological[r + 1]!.date);
  }
  return dates;
}

/**
 * HV20 / HV30 from close-to-close log returns (annualized sqrt(252)).
 * Requires at least 31 closes (30 return observations) for HV30; returns null otherwise.
 */
export async function getRealizedVolFromEquityDaily(
  symbol: string,
  lastEarningsDate?: string | null,
): Promise<{
  hv20: number;
  hv30: number;
  asOfDate: string;
  hv20EarningsContaminated: boolean;
  hv30EarningsContaminated: boolean;
} | null> {
  const symU = symbol.toUpperCase().trim();
  if (!symU) return null;
  const rows = await db
    .select({ close: equityDailyTable.close, date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symU),
      sql`${equityDailyTable.close} IS NOT NULL`,
      sql`${equityDailyTable.close} > 0`,
    ))
    .orderBy(desc(equityDailyTable.date))
    .limit(400);
  if (rows.length < 31) return null;
  const chronological = [...rows].reverse();
  const closes = chronological.map(r => r.close as number);
  const asOfDate = chronological[chronological.length - 1]!.date;
  const logRet: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev <= 0 || cur <= 0) return null;
    logRet.push(Math.log(cur / prev));
  }
  if (logRet.length < 30) return null;

  const hvForLast = (nReturns: number): number | null => {
    const slice = logRet.slice(-nReturns);
    if (slice.length < nReturns) return null;
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
    if (!Number.isFinite(variance) || variance < 0) return null;
    return Math.round(Math.sqrt(variance) * ANNUALIZE * 10000) / 100;
  };

  const hv30 = hvForLast(30);
  const hv20 = hvForLast(20);
  if (hv30 == null || hv20 == null) return null;

  const earn = lastEarningsDate && /^\d{4}-\d{2}-\d{2}$/.test(lastEarningsDate) ? lastEarningsDate : null;
  const d20 = sessionDatesInLastNReturns(chronological, 20);
  const d30 = sessionDatesInLastNReturns(chronological, 30);
  const hv20EarningsContaminated = earn != null && d20.has(earn);
  const hv30EarningsContaminated = earn != null && d30.has(earn);

  return {
    hv20,
    hv30,
    asOfDate,
    hv20EarningsContaminated,
    hv30EarningsContaminated,
  };
}

/**
 * Valid iv_30d rows on or before the latest row that has iv30d (Path B BSM series depth).
 */
export async function countRealIvHistoryDays(symbol: string): Promise<{ count: number; asOfDate: string | null }> {
  const symU = symbol.toUpperCase().trim();
  if (!symU) return { count: 0, asOfDate: null };
  const latest = await db
    .select({ date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symU),
      sql`${equityDailyTable.iv30d} IS NOT NULL`,
      sql`${equityDailyTable.iv30d} >= ${IV_MIN_VALID}`,
      sql`${equityDailyTable.iv30d} <= ${IV_MAX_VALID}`,
    ))
    .orderBy(desc(equityDailyTable.date))
    .limit(1);
  const asOf = latest[0]?.date ?? null;
  if (!asOf) return { count: 0, asOfDate: null };
  const cnt = await countValidIvRows(symU, asOf, equityDailyTable.iv30d);
  return { count: cnt, asOfDate: asOf };
}

/** Valid iv_30d_proxy rows for HV-proxy IVR depth. */
export async function countProxyIvHistoryDays(symbol: string, asOfDate: string): Promise<number> {
  const symU = symbol.toUpperCase().trim();
  if (!symU) return 0;
  return countValidIvRows(symU, asOfDate, equityDailyTable.iv30dProxy);
}

export async function recomputeAllIVR(symbols?: string[]): Promise<{ symbols: number; rowsUpdated: number; rowsNulled: number }> {
  let symList: string[];
  if (symbols && symbols.length > 0) {
    symList = symbols.map(s => s.toUpperCase());
  } else {
    const rows = await db
      .selectDistinct({ sym: equityDailyTable.symbol })
      .from(equityDailyTable)
      .where(sql`${equityDailyTable.iv30d} IS NOT NULL`);
    symList = rows.map(r => r.sym);
  }

  let rowsUpdated = 0;
  let rowsNulled = 0;

  for (const sym of symList) {
    const dateRows = await db
      .select({ date: equityDailyTable.date, iv: equityDailyTable.iv30d })
      .from(equityDailyTable)
      .where(and(
        eq(equityDailyTable.symbol, sym),
        sql`${equityDailyTable.iv30d} IS NOT NULL`,
        sql`${equityDailyTable.iv30d} >= ${IV_MIN_VALID}`,
        sql`${equityDailyTable.iv30d} <= ${IV_MAX_VALID}`,
      ))
      .orderBy(equityDailyTable.date);

    for (const row of dateRows) {
      const ivr = await computeIVRForSymbol(sym, row.date, row.iv);
      if (ivr == null) {
        await db.update(equityDailyTable)
          .set({ ivr: null })
          .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, row.date)));
        rowsNulled++;
      } else {
        await db.update(equityDailyTable)
          .set({ ivr })
          .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, row.date)));
        rowsUpdated++;
      }
    }
  }

  return { symbols: symList.length, rowsUpdated, rowsNulled };
}
