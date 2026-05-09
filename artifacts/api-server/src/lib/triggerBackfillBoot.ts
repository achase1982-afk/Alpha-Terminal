import { db, equityDailyTable, optionsFlowPerStrikeTable } from "@workspace/db";
import { inArray, lte, sql } from "drizzle-orm";
import { backfillPolygonFlow, updateEquityDailyFromGroupedBars } from "./dailySnapshot.js";
import { liquidCoreUnionTuningSymbols } from "./liquidCoreUniverse.js";
import { logger } from "./logger.js";

const MIN_EQUITY_HISTORY_DAYS = 60;
const FLOW_DISTINCT_DATE_THRESHOLD = 20;
const FLOW_BACKFILL_DAYS_BACK = 30;

/** Walk calendar days backward until `target` weekdays collected (Sat/Sun skipped). */
function collectRecentCalendarDates(target: number, scanCap = 130): string[] {
  const tradingDates: string[] = [];
  const now = Date.now();
  for (let i = 1; i <= scanCap && tradingDates.length < target; i++) {
    const d = new Date(now - i * 86_400_000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      tradingDates.push(d.toISOString().slice(0, 10));
    }
  }
  return tradingDates;
}

/**
 * Per-symbol depth: symbols with &lt;60 distinct equity_daily dates get 90 sessions of grouped bars;
 * others get 5. Runs both cohorts in parallel when both non-empty.
 */
export async function runLiquidCoreEquityBackfillOnce(): Promise<void> {
  const symbols = liquidCoreUnionTuningSymbols();
  if (symbols.length === 0) return;

  const counts = await db
    .select({
      sym: equityDailyTable.symbol,
      cnt: sql<number>`count(distinct ${equityDailyTable.date})`,
    })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, symbols))
    .groupBy(equityDailyTable.symbol);

  const countMap = new Map(counts.map((r) => [String(r.sym).toUpperCase(), Number(r.cnt)]));
  const thin = symbols.filter((s) => (countMap.get(s.toUpperCase()) ?? 0) < MIN_EQUITY_HISTORY_DAYS);
  const thick = symbols.filter((s) => (countMap.get(s.toUpperCase()) ?? 0) >= MIN_EQUITY_HISTORY_DAYS);

  const ninetyDates = collectRecentCalendarDates(90);
  const fiveDates = collectRecentCalendarDates(5);

  logger.info(
    {
      universe: symbols.length,
      thin: thin.length,
      thick: thick.length,
      datesThin: ninetyDates.length,
      datesThick: fiveDates.length,
    },
    "Boot equity backfill: cohorts selected",
  );

  await Promise.all([
    thin.length > 0 ? updateEquityDailyFromGroupedBars(thin, ninetyDates) : Promise.resolve({ totalRows: 0, datesProcessed: 0 }),
    thick.length > 0 ? updateEquityDailyFromGroupedBars(thick, fiveDates) : Promise.resolve({ totalRows: 0, datesProcessed: 0 }),
  ]);

  const post = await db
    .select({
      sym: equityDailyTable.symbol,
      cnt: sql<number>`count(distinct ${equityDailyTable.date})`,
    })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, symbols))
    .groupBy(equityDailyTable.symbol);
  const postMin =
    post.length > 0 ? Math.min(...post.map((r) => Number(r.cnt))) : 0;
  logger.info(
    {
      symbolsChecked: post.length,
      minDaysAcrossUniverse: postMin,
      scannerRequirement: MIN_EQUITY_HISTORY_DAYS,
      ready: postMin >= MIN_EQUITY_HISTORY_DAYS,
    },
    "Equity backfill: post-backfill coverage check",
  );
}

/**
 * Per-symbol flow gap repair: distinct dates in options_flow_per_strike (≤2d ago) under 20 → 30d REST backfill.
 */
export async function runFlowBootstrapGapRepairOnce(): Promise<void> {
  if (!process.env.POLYGON_API_KEY) {
    logger.warn("Flow bootstrap: POLYGON_API_KEY missing — skipping");
    return;
  }

  const symbols = liquidCoreUnionTuningSymbols();
  const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

  const rows = await db
    .select({
      sym: optionsFlowPerStrikeTable.underlyingSymbol,
      dateCnt: sql<number>`count(distinct ${optionsFlowPerStrikeTable.date})`,
    })
    .from(optionsFlowPerStrikeTable)
    .where(lte(optionsFlowPerStrikeTable.date, cutoff))
    .groupBy(optionsFlowPerStrikeTable.underlyingSymbol);

  const dateCnt = new Map(rows.map((r) => [String(r.sym).toUpperCase(), Number(r.dateCnt)]));
  const needy = symbols.filter((s) => (dateCnt.get(s.toUpperCase()) ?? 0) < FLOW_DISTINCT_DATE_THRESHOLD);

  if (needy.length === 0) {
    logger.info({ universe: symbols.length }, "Flow bootstrap: all symbols meet flow date threshold — skipping");
    return;
  }

  logger.warn(
    { needy: needy.length, universe: symbols.length, daysBack: FLOW_BACKFILL_DAYS_BACK },
    "Flow bootstrap: repairing per-symbol Polygon flow gaps",
  );
  const result = await backfillPolygonFlow(needy, FLOW_BACKFILL_DAYS_BACK, false);
  logger.info(result, "Flow bootstrap: gap repair complete");
}
