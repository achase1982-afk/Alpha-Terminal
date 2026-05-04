import { randomUUID } from "node:crypto";
import { db, cmeEsDepthSummaryTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { logger } from "./logger.js";

export interface EsDepthSummaryPayload {
  symbol: "ES";
  contractMonth: string;
  midPrice: number;
  bidDepth5ticks: number;
  askDepth5ticks: number;
  bidDepth1tick: number;
  askDepth1tick: number;
  bookImbalanceRatio: number;
  topBidSize: number;
  topAskSize: number;
  updatedAt: string;
}

const DEDUPE_MS = 5_000;
const FLUSH_MS = 500;
const MAX_BATCH = 20;

type Row = typeof cmeEsDepthSummaryTable.$inferInsert;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Row[] = [];
let lastPersistAt = 0;

function isNyWeekdayEt(d: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(d);
  return wd !== "Sat" && wd !== "Sun";
}

/** RTH 9:30–16:00 ET plus first hour after close 16:00–17:00 ET (weekdays). */
export function isEsDepthPersistWindowEt(now = new Date()): boolean {
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
  return mins >= 9 * 60 + 30 && mins < 17 * 60;
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
    await db.insert(cmeEsDepthSummaryTable).values(batch);
  } catch (err) {
    logger.error({ err }, "cme_es_depth_summary: insert failed");
  }
  if (queue.length > 0) void flushQueue();
}

export function enqueueEsDepthPersist(summary: EsDepthSummaryPayload): void {
  if (!isEsDepthPersistWindowEt()) return;
  const now = Date.now();
  if (now - lastPersistAt < DEDUPE_MS) return;
  lastPersistAt = now;

  queue.push({
    id: randomUUID(),
    underlyingSymbol: "ES",
    contractMonth: summary.contractMonth,
    summaryTimestamp: new Date(summary.updatedAt),
    midPrice: summary.midPrice,
    bidDepth5ticks: summary.bidDepth5ticks,
    askDepth5ticks: summary.askDepth5ticks,
    bidDepth1tick: summary.bidDepth1tick,
    askDepth1tick: summary.askDepth1tick,
    bookImbalanceRatio: summary.bookImbalanceRatio,
    topBidSize: summary.topBidSize,
    topAskSize: summary.topAskSize,
    source: "IBKR_CME",
  });
  scheduleFlush();
}

export type EsDepthRow = typeof cmeEsDepthSummaryTable.$inferSelect;

export async function fetchRecentEsDepthSummary(
  windowMs = 60_000,
): Promise<{ row: EsDepthRow | null; latencyMs: number }> {
  const cutoff = new Date(Date.now() - windowMs);
  const t0 = Date.now();
  try {
    const rows = await db
      .select()
      .from(cmeEsDepthSummaryTable)
      .where(sql`${cmeEsDepthSummaryTable.summaryTimestamp} >= ${cutoff}`)
      .orderBy(desc(cmeEsDepthSummaryTable.summaryTimestamp))
      .limit(1);
    return { row: rows[0] ?? null, latencyMs: Date.now() - t0 };
  } catch (err) {
    logger.warn({ err }, "fetchRecentEsDepthSummary failed");
    return { row: null, latencyMs: Date.now() - t0 };
  }
}
