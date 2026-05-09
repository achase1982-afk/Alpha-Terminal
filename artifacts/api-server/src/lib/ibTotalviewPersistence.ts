import { randomUUID } from "node:crypto";
import { db, nasdaqTotalviewSummaryTable } from "@workspace/db";
import { desc, sql } from "@workspace/db";
import { logger } from "./logger.js";

export interface NasdaqTotalviewSummaryPayload {
  symbol: string;
  spotMid: number;
  bidDepth5pct: number;
  askDepth5pct: number;
  bidDepth1pct: number;
  askDepth1pct: number;
  bookImbalanceRatio: number;
  topBidSize: number;
  topAskSize: number;
  updatedAt: string;
}

const DEDUPE_MS = 5_000;
const FLUSH_MS = 500;
const MAX_BATCH = 50;

type Row = typeof nasdaqTotalviewSummaryTable.$inferInsert;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Row[] = [];
const lastPersistAt = new Map<string, number>();

function isNyWeekdayEt(d: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(d);
  return wd !== "Sat" && wd !== "Sun";
}

/** US equity regular hours 9:30–16:00 ET (weekdays). Holidays not modeled. */
export function isUsEquityRthEt(now = new Date()): boolean {
  if (!isNyWeekdayEt(now)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_MS);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await db.insert(nasdaqTotalviewSummaryTable).values(batch);
  } catch (err) {
    logger.error({ err, batchSize: batch.length }, "nasdaq_totalview_summary: insert failed");
  }
  if (queue.length > 0) void flushQueue();
}

export function enqueueTotalviewPersist(summary: NasdaqTotalviewSummaryPayload): void {
  if (!isUsEquityRthEt()) return;
  const sym = summary.symbol.toUpperCase();
  const now = Date.now();
  const last = lastPersistAt.get(sym) ?? 0;
  if (now - last < DEDUPE_MS) return;
  lastPersistAt.set(sym, now);

  queue.push({
    id: randomUUID(),
    underlyingSymbol: sym,
    summaryTimestamp: new Date(summary.updatedAt),
    spotMid: summary.spotMid,
    bidDepth5pct: summary.bidDepth5pct,
    askDepth5pct: summary.askDepth5pct,
    bidDepth1pct: summary.bidDepth1pct,
    askDepth1pct: summary.askDepth1pct,
    bookImbalanceRatio: summary.bookImbalanceRatio,
    topBidSize: summary.topBidSize,
    topAskSize: summary.topAskSize,
    source: "IBKR_NASDAQ",
  });
  scheduleFlush();
}

export type NasdaqTotalviewRow = typeof nasdaqTotalviewSummaryTable.$inferSelect;

export async function fetchRecentNasdaqTotalviewForTicker(
  ticker: string,
  windowMs = 60_000,
): Promise<{ row: NasdaqTotalviewRow | null; latencyMs: number }> {
  const upper = ticker.toUpperCase();
  const cutoff = new Date(Date.now() - windowMs);
  const t0 = Date.now();
  try {
    const rows = await db
      .select()
      .from(nasdaqTotalviewSummaryTable)
      .where(
        sql`${nasdaqTotalviewSummaryTable.underlyingSymbol} = ${upper} AND ${nasdaqTotalviewSummaryTable.summaryTimestamp} >= ${cutoff}`,
      )
      .orderBy(desc(nasdaqTotalviewSummaryTable.summaryTimestamp))
      .limit(1);
    return { row: rows[0] ?? null, latencyMs: Date.now() - t0 };
  } catch (err) {
    logger.warn({ err, ticker: upper }, "fetchRecentNasdaqTotalviewForTicker failed");
    return { row: null, latencyMs: Date.now() - t0 };
  }
}
