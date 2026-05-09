/**
 * Background pass: fill aggressor side on REST tape rows that stayed side=null when
 * quote backfill was incomplete. Schema has no persisted quote table — NBBO is replayed
 * from Polygon /v3/quotes via {@link fetchQuotesAroundTrade}.
 */
import { db, optionsFlowRawTradesTable } from "@workspace/db";
import { and, desc, eq, isNull, sql } from "@workspace/db";
import { logger } from "./logger.js";
import { fetchSchwabMarketSnapshot } from "./schwabMarketSnapshot.js";
import { buildMarketContextSnapshot } from "./flowMarketContext.js";
import { classifyForFlowPersistence } from "./optionsTradeClassifier.js";
import { getContract20dBaseline } from "./optionsBaselines.js";
import { fetchQuotesAroundTrade, nbboAtOrBefore } from "./optionsQuoteNbbo.js";

/** Only attempt rows whose trade timestamp is within this window (default 7 days). */
export const RECLASSIFY_LOOKBACK_MS = 7 * 86_400_000;

const DEFAULT_MAX_ROWS = 5000;
const DEFAULT_DEADLINE_MS = 30_000;

export async function reclassifyUnclassifiedTrades(
  ticker: string,
  opts?: { maxRows?: number; deadlineMs?: number },
): Promise<{ scanned: number; reclassified: number; stillUnclassified: number; durationMs: number }> {
  const sym = ticker.toUpperCase();
  const maxRows = opts?.maxRows ?? DEFAULT_MAX_ROWS;
  const deadlineMs = opts?.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const started = Date.now();
  const hardEnd = started + deadlineMs;

  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    const durationMs = Date.now() - started;
    logger.info(
      {
        ticker: sym,
        scanned: 0,
        reclassified: 0,
        stillUnclassified: 0,
        durationMs,
      },
      "optionsTradeReclassifier: completed",
    );
    return { scanned: 0, reclassified: 0, stillUnclassified: 0, durationMs };
  }

  const cutoff = new Date(Date.now() - RECLASSIFY_LOOKBACK_MS);

  const rows = await db
    .select({
      id: optionsFlowRawTradesTable.id,
      optionSymbol: optionsFlowRawTradesTable.optionSymbol,
      timestamp: optionsFlowRawTradesTable.timestamp,
      tradePrice: optionsFlowRawTradesTable.tradePrice,
      size: optionsFlowRawTradesTable.size,
      date: optionsFlowRawTradesTable.date,
      openInterestSnapshot: optionsFlowRawTradesTable.openInterestSnapshot,
      notionalThresholdUsd: optionsFlowRawTradesTable.notionalThresholdUsd,
    })
    .from(optionsFlowRawTradesTable)
    .where(
      and(
        eq(optionsFlowRawTradesTable.underlyingSymbol, sym),
        isNull(optionsFlowRawTradesTable.side),
        sql`${optionsFlowRawTradesTable.timestamp} >= ${cutoff}`,
      ),
    )
    .orderBy(desc(optionsFlowRawTradesTable.timestamp))
    .limit(maxRows);

  const schwabSnap = await fetchSchwabMarketSnapshot(sym);
  const marketCtx = buildMarketContextSnapshot({
    ticker: sym,
    marketCapUsd: schwabSnap?.marketCapUsd ?? null,
    assetType: schwabSnap?.assetType ?? null,
  });

  let scanned = 0;
  let reclassified = 0;
  let stillUnclassified = 0;

  for (const row of rows) {
    if (Date.now() >= hardEnd) break;
    scanned++;

    const occ = row.optionSymbol;
    const ts = row.timestamp;
    if (!occ || ts == null) {
      stillUnclassified++;
      continue;
    }
    const tsMs = ts instanceof Date ? ts.getTime() : new Date(String(ts)).getTime();
    if (!Number.isFinite(tsMs)) {
      stillUnclassified++;
      continue;
    }
    const price = Number(row.tradePrice ?? 0);
    const size = Number(row.size ?? 0);
    if (!Number.isFinite(price) || !Number.isFinite(size)) {
      stillUnclassified++;
      continue;
    }

    let baselineAvgVol: number | null = null;
    try {
      const bl = await getContract20dBaseline(occ, { referenceDate: new Date(`${String(row.date)}T12:00:00Z`) });
      baselineAvgVol = bl?.avgVolume ?? null;
    } catch {
      /* ignore */
    }

    const occDeadline = Math.min(hardEnd, Date.now() + 12_000);
    const { quotes } = await fetchQuotesAroundTrade(occ, apiKey, tsMs, occDeadline);
    const nb = nbboAtOrBefore(quotes, tsMs);

    const cl = classifyForFlowPersistence({
      price,
      size,
      conditions: [],
      nbbo: nb,
      largeNotionalThresholdUsd: row.notionalThresholdUsd ?? marketCtx.largeNotionalThresholdUsd,
      avgDailyContractVolume20d: baselineAvgVol,
      openInterest:
        typeof row.openInterestSnapshot === "number" && row.openInterestSnapshot > 0
          ? row.openInterestSnapshot
          : null,
    });

    if (cl.side == null) {
      stillUnclassified++;
      continue;
    }

    const updated = await db
      .update(optionsFlowRawTradesTable)
      .set({
        side: cl.side,
        aggressorConfidence: cl.aggressorConfidence,
      })
      .where(and(eq(optionsFlowRawTradesTable.id, row.id), isNull(optionsFlowRawTradesTable.side)))
      .returning({ id: optionsFlowRawTradesTable.id });

    if (updated.length > 0) {
      reclassified++;
    } else {
      stillUnclassified++;
    }
  }

  const durationMs = Date.now() - started;
  logger.info(
    {
      ticker: sym,
      scanned,
      reclassified,
      stillUnclassified,
      durationMs,
    },
    "optionsTradeReclassifier: completed",
  );

  return { scanned, reclassified, stillUnclassified, durationMs };
}
