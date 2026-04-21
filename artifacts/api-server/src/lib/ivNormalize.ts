import { db, equityDailyTable, optionsChainDailyTable, optionsFlowPerStrikeTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const IV_MIN_VALID = 0.01;
const IV_MAX_VALID = 5;
const IVR_MIN_HISTORY = 60;
const IVR_LOOKBACK = 252;

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

export async function computeIVRForSymbol(
  sym: string,
  date: string,
  todayIvOverride?: number | null,
): Promise<number | null> {
  const symU = sym.toUpperCase();

  let currentIv = todayIvOverride ?? null;
  if (currentIv == null) {
    const rows = await db
      .select({ iv: equityDailyTable.iv30d })
      .from(equityDailyTable)
      .where(and(eq(equityDailyTable.symbol, symU), eq(equityDailyTable.date, date)))
      .limit(1);
    currentIv = rows[0]?.iv ?? null;
  }
  currentIv = normalizeIV(currentIv);
  if (currentIv == null) return null;

  const history = await db
    .select({ iv: equityDailyTable.iv30d })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, symU),
      sql`${equityDailyTable.date} < ${date}`,
      sql`${equityDailyTable.iv30d} IS NOT NULL`,
      sql`${equityDailyTable.iv30d} >= ${IV_MIN_VALID}`,
      sql`${equityDailyTable.iv30d} <= ${IV_MAX_VALID}`,
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
