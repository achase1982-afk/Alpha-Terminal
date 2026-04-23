import { db, equityDailyTable, equityIvCanonicalTable, optionsChainDailyTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { validateIv30 } from "./ivSanityFloor";

/**
 * Path A canonical IV accumulator.
 *
 * Once per day after market close, picks the ATM 30-DTE contract from
 * the Schwab full-chain snapshot (already collected into options_chain_daily)
 * and writes it to equity_iv_canonical. After ~60 trading days of coverage
 * we cut IVR computation over to this table — a uniform single-source
 * series with no DTE-coverage bias.
 *
 * Selection rule: among contracts within ±5% of spot, pick the one whose
 * DTE is closest to 30. Prefer call when both call/put exist at same strike
 * (puts often print elevated IV due to skew bid).
 */

interface ChainRow {
  optionType: string;
  strike: number;
  dte: number | null;
  iv: number | null;
  spot: number | null;
}

export interface AccumulatorRunReport {
  date: string;
  symbolsConsidered: number;
  rowsWritten: number;
  rowsSkipped: number;
  reasons: Record<string, number>;
}

export async function accumulateCanonicalIvForDate(date: string): Promise<AccumulatorRunReport> {
  const report: AccumulatorRunReport = {
    date, symbolsConsidered: 0, rowsWritten: 0, rowsSkipped: 0, reasons: {},
  };

  const symRows = await db
    .selectDistinct({ sym: optionsChainDailyTable.underlyingSymbol })
    .from(optionsChainDailyTable)
    .where(eq(optionsChainDailyTable.date, date));

  for (const { sym } of symRows) {
    report.symbolsConsidered++;
    try {
      // Spot price comes from equity_daily.close (the chain table doesn't store underlying price).
      const eqRows = await db
        .select({ close: equityDailyTable.close })
        .from(equityDailyTable)
        .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, date)))
        .limit(1);
      const spot = eqRows[0]?.close ?? null;
      if (spot == null || spot <= 0) {
        report.rowsSkipped++;
        report.reasons["no_spot"] = (report.reasons["no_spot"] ?? 0) + 1;
        continue;
      }

      const rows = await db
        .select({
          optionType: optionsChainDailyTable.optionType,
          strike: optionsChainDailyTable.strike,
          dte: optionsChainDailyTable.dte,
          iv: optionsChainDailyTable.impliedVolatility,
        })
        .from(optionsChainDailyTable)
        .where(and(
          eq(optionsChainDailyTable.underlyingSymbol, sym),
          eq(optionsChainDailyTable.date, date),
          sql`${optionsChainDailyTable.impliedVolatility} IS NOT NULL`,
          sql`${optionsChainDailyTable.dte} IS NOT NULL`,
        ));

      if (rows.length === 0) {
        report.rowsSkipped++;
        report.reasons["no_chain"] = (report.reasons["no_chain"] ?? 0) + 1;
        continue;
      }
      const candidates: ChainRow[] = rows
        .filter(r => Math.abs(r.strike - spot) / spot <= 0.05)
        .map(r => ({ optionType: r.optionType, strike: r.strike, dte: r.dte, iv: r.iv, spot }));
      if (candidates.length === 0) {
        report.rowsSkipped++;
        report.reasons["no_atm_window"] = (report.reasons["no_atm_window"] ?? 0) + 1;
        continue;
      }
      candidates.sort((a, b) => {
        const da = Math.abs((a.dte ?? 9999) - 30);
        const db_ = Math.abs((b.dte ?? 9999) - 30);
        if (da !== db_) return da - db_;
        const sa = Math.abs(a.strike - spot);
        const sb = Math.abs(b.strike - spot);
        if (sa !== sb) return sa - sb;
        if (a.optionType !== b.optionType) return a.optionType === "call" ? -1 : 1;
        return 0;
      });
      const pick = candidates[0];
      const validated = validateIv30(sym, pick.iv, "canonicalAccumulator");
      if (validated == null) {
        report.rowsSkipped++;
        report.reasons["floor_rejected"] = (report.reasons["floor_rejected"] ?? 0) + 1;
        continue;
      }

      await db.insert(equityIvCanonicalTable)
        .values({
          symbol: sym,
          date,
          iv30d: validated,
          dteActual: pick.dte ?? 0,
          strike: pick.strike,
          spot,
          source: "chain",
        })
        .onConflictDoUpdate({
          target: [equityIvCanonicalTable.symbol, equityIvCanonicalTable.date],
          set: {
            iv30d: validated,
            dteActual: pick.dte ?? 0,
            strike: pick.strike,
            spot,
          },
        });
      report.rowsWritten++;
    } catch (e) {
      report.rowsSkipped++;
      const key = `error:${(e as Error).message.slice(0, 40)}`;
      report.reasons[key] = (report.reasons[key] ?? 0) + 1;
      logger.warn({ sym, date, err: (e as Error).message }, "canonicalIv: symbol failed");
    }
  }

  logger.info(report, "canonicalIvAccumulator: run complete");
  return report;
}
