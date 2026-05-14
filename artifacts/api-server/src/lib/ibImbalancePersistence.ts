import { randomUUID } from "node:crypto";
import { db, nyseOrderImbalancesTable } from "@workspace/db";
import { desc, sql } from "@workspace/db";
import { logger } from "./logger.js";
import type { IbImbalanceState } from "./ibStreamer.js";

const DEDUPE_WINDOW_MS = 1_000;
const FLUSH_INTERVAL_MS = 500;
const MAX_BATCH = 100;

/** Absolute notional threshold for strategist "balanced" side (USD). */
export const CLOSING_IMBALANCE_BALANCED_THRESHOLD_USD = 5_000_000;

type PendingRow = typeof nyseOrderImbalancesTable.$inferInsert;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const queue: PendingRow[] = [];
const recentDedupe = new Map<string, number>();

function dedupeKey(sym: string, shares: bigint, price: number): string {
  return `${sym}|${shares}|${price}`;
}

function isNyWeekdayEt(d: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(d);
  return wd !== "Sat" && wd !== "Sun";
}

/**
 * Regular-session closing imbalance persistence window: 3:30 PM – 4:00 PM Eastern.
 * Weekends excluded; US exchange holidays are not modeled (same limitation as other schedulers).
 */
export function isClosingImbalancePersistWindowEt(now = new Date()): boolean {
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
  const start = 15 * 60 + 30; // 15:30
  const end = 16 * 60; // 16:00 exclusive of full hour? spec says through 4:00 PM — include 15:59
  return mins >= start && mins < end + 1;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_INTERVAL_MS);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await db.insert(nyseOrderImbalancesTable).values(batch);
  } catch (err) {
    logger.error({ err, batchSize: batch.length }, "nyse_order_imbalances: batch insert failed");
  }
  if (queue.length > 0) void flushQueue();
}

export type NyseImbalanceRow = typeof nyseOrderImbalancesTable.$inferSelect;

export async function fetchRecentNyseImbalanceForTicker(
  ticker: string,
  windowMs = 5 * 60 * 1000,
): Promise<{ row: NyseImbalanceRow | null; latencyMs: number }> {
  const upper = ticker.toUpperCase();
  const cutoff = new Date(Date.now() - windowMs);
  const t0 = Date.now();
  try {
    const rows = await db
      .select()
      .from(nyseOrderImbalancesTable)
      .where(
        sql`${nyseOrderImbalancesTable.underlyingSymbol} = ${upper} AND ${nyseOrderImbalancesTable.imbalanceTimestamp} >= ${cutoff}`,
      )
      .orderBy(desc(nyseOrderImbalancesTable.imbalanceTimestamp))
      .limit(1);
    const latencyMs = Date.now() - t0;
    if (rows.length === 0) return { row: null, latencyMs };
    return { row: rows[0]!, latencyMs };
  } catch (err) {
    logger.warn({ err, ticker: upper }, "fetchRecentNyseImbalanceForTicker: query failed");
    return { row: null, latencyMs: Date.now() - t0 };
  }
}

export function enqueueImbalancePersist(symbol: string, state: IbImbalanceState): void {
  if (!isClosingImbalancePersistWindowEt()) return;

  const shares = state.imbalanceShares;
  const price = state.indicativePrice;
  if (shares === null || price === null) return;

  const key = dedupeKey(symbol, shares, price);
  const now = Date.now();
  const last = recentDedupe.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
  recentDedupe.set(key, now);
  if (recentDedupe.size > 10_000) {
    for (const [k, t] of recentDedupe) {
      if (now - t > DEDUPE_WINDOW_MS * 10) recentDedupe.delete(k);
    }
  }

  const notional = Number(shares) * price;
  queue.push({
    id: randomUUID(),
    underlyingSymbol: symbol.toUpperCase(),
    imbalanceTimestamp: new Date(state.timestamp),
    imbalanceShares: shares,
    imbalanceNotionalUsd: notional,
    indicativePrice: price,
    pairedShares: state.pairedShares,
    regulatoryImbalance: state.regulatoryImbalance,
    auctionType: "closing",
    source: "IBKR_NYSE",
  });
  scheduleFlush();
}
