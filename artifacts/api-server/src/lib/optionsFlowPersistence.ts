import { randomUUID } from "node:crypto";
import { db, optionsFlowRawTradesTable } from "@workspace/db";
import { logger } from "./logger.js";
import { logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";

// Batched async writer for classified options trade events streaming
// from the live watcher. Avoids per-trade DB round-trips by buffering
// and flushing on a fixed cadence or when the buffer crosses a size cap.

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_MAX = 1_000;

interface PendingTrade {
  underlyingSymbol: string;
  date: string;
  timestamp: Date;
  optionSymbol: string;
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  tradePrice: number;
  size: number;
  notional: number;
  /** ask | bid | mid — NBBO aggressor; null when NBBO unavailable */
  side: string | null;
  isBlock: boolean;
  isSweep: boolean;
  /** Stable id for dedup (live uses ws:uuid, REST backfill uses rest:… ) */
  sourceTradeId: string;
  exchangeId?: number | null;
  venueClass?: string | null;
  dteDays?: number | null;
  sessionPhase?: string | null;
  volOiRatio?: number | null;
  openInterestSnapshot?: number | null;
  volumeVsBaseline20d?: number | null;
  marketCapUsd?: number | null;
  marketCapTier?: string | null;
  notionalThresholdUsd?: number | null;
  aggressorConfidence?: string | null;
}

const buffer: PendingTrade[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let totalQueued = 0;
let totalWritten = 0;
let totalFailed = 0;            // rows in dropped batches
let batchesAttempted = 0;       // total flush attempts that had rows
let batchesFailed = 0;          // attempts that errored
let lastFlushTs: number | null = null;
let lastFailureTs: number | null = null;
let lastFailureMessage: string | null = null;
let highFailureRateWarned = false;
const HIGH_FAILURE_THRESHOLD = 0.05; // 5%
const HIGH_FAILURE_MIN_BATCHES = 20; // don't alarm before we have a sample

export function startFlowPersistence(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
  logger.info({ op: "flowPersist.start", flushMs: FLUSH_INTERVAL_MS }, "Options flow persistence started");
}

export function stopFlowPersistence(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  void flush();
}

/** Wait for queued live trades to hit the database (call before rollup). */
export async function flushFlowPersistenceNow(): Promise<void> {
  await flush();
}

export function getFlowPersistenceStats() {
  const failureRate = batchesAttempted > 0
    ? +(batchesFailed / batchesAttempted).toFixed(4)
    : 0;
  return {
    queued: buffer.length,
    totalQueued,
    totalWritten,
    totalFailed,
    batchesAttempted,
    batchesFailed,
    failureRate,
    failureRateThreshold: HIGH_FAILURE_THRESHOLD,
    overThreshold: failureRate > HIGH_FAILURE_THRESHOLD && batchesAttempted >= HIGH_FAILURE_MIN_BATCHES,
    lastFlushTs,
    lastFailureTs,
    lastFailureMessage,
  };
}

// OCC symbol format: O:AAPL250620C00150000
// underlying (var) + YYMMDD (6) + C/P (1) + strike*1000 (8 digits)
export function parseOcc(occ: string): { underlying: string; expiration: string; type: "call" | "put"; strike: number } | null {
  if (!occ.startsWith("O:")) return null;
  const body = occ.slice(2);
  const m = body.match(/^([A-Z0-9.]+?)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, yymmdd, cp, strikeRaw] = m;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const yyyy = 2000 + yy;
  const expiration = `${yyyy}-${mm}-${dd}`;
  const strike = Number(strikeRaw) / 1000;
  return { underlying, expiration, type: cp === "C" ? "call" : "put", strike };
}

export function enqueueClassifiedTrade(args: {
  occ: string;
  ticker: string;
  ts: number;
  price: number;
  size: number;
  notional: number;
  isSweep: boolean;
  isBlock: boolean;
  side?: string | null;
  /** When omitted, generates a unique id so live rows never collide on partial unique */
  sourceTradeId?: string;
  exchangeId?: number | null;
  venueClass?: string | null;
  dteDays?: number | null;
  sessionPhase?: string | null;
  volOiRatio?: number | null;
  openInterestSnapshot?: number | null;
  volumeVsBaseline20d?: number | null;
  marketCapUsd?: number | null;
  marketCapTier?: string | null;
  notionalThresholdUsd?: number | null;
  aggressorConfidence?: string | null;
}): void {
  const parsed = parseOcc(args.occ);
  if (!parsed) return;
  const date = new Date(args.ts).toISOString().slice(0, 10);
  buffer.push({
    underlyingSymbol: args.ticker,
    date,
    timestamp: new Date(args.ts),
    optionSymbol: args.occ,
    optionType: parsed.type,
    strike: parsed.strike,
    expiration: parsed.expiration,
    tradePrice: args.price,
    size: args.size,
    notional: args.notional,
    side: args.side ?? null,
    isBlock: args.isBlock,
    isSweep: args.isSweep,
    sourceTradeId: args.sourceTradeId ?? `ws:${randomUUID()}`,
    exchangeId: args.exchangeId ?? null,
    venueClass: args.venueClass ?? null,
    dteDays: args.dteDays ?? null,
    sessionPhase: args.sessionPhase ?? null,
    volOiRatio: args.volOiRatio ?? null,
    openInterestSnapshot: args.openInterestSnapshot ?? null,
    volumeVsBaseline20d: args.volumeVsBaseline20d ?? null,
    marketCapUsd: args.marketCapUsd ?? null,
    marketCapTier: args.marketCapTier ?? null,
    notionalThresholdUsd: args.notionalThresholdUsd ?? null,
    aggressorConfidence: args.aggressorConfidence ?? null,
  });
  totalQueued++;
  if (buffer.length >= FLUSH_BATCH_MAX) void flush();
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  batchesAttempted++;
  try {
    await db.insert(optionsFlowRawTradesTable).values(batch).onConflictDoNothing({
      target: [
        optionsFlowRawTradesTable.underlyingSymbol,
        optionsFlowRawTradesTable.date,
        optionsFlowRawTradesTable.sourceTradeId,
      ],
    });
    totalWritten += batch.length;
    lastFlushTs = Date.now();
  } catch (err) {
    totalFailed += batch.length;
    batchesFailed++;
    lastFailureTs = Date.now();
    lastFailureMessage = err instanceof Error ? err.message : String(err);
    logFlowPipelineWarn(
      "persistence_flush",
      "Failed to flush options flow batch",
      { err, count: batch.length, batchesAttempted, batchesFailed },
    );

    // Loud one-shot warning when failure rate climbs above 5% on a
    // non-trivial sample. Re-armed only after the rate recovers below
    // threshold so a healing run can re-trigger if it degrades again.
    const rate = batchesFailed / batchesAttempted;
    if (rate > HIGH_FAILURE_THRESHOLD && batchesAttempted >= HIGH_FAILURE_MIN_BATCHES) {
      if (!highFailureRateWarned) {
        highFailureRateWarned = true;
        logger.warn({
          op: "flowPersist.failureRate.high",
          failureRate: +rate.toFixed(4),
          batchesAttempted,
          batchesFailed,
          threshold: HIGH_FAILURE_THRESHOLD,
        }, `Options flow persistence failure rate ${(rate * 100).toFixed(1)}% exceeds ${(HIGH_FAILURE_THRESHOLD * 100)}% threshold`);
      }
    } else if (rate <= HIGH_FAILURE_THRESHOLD && highFailureRateWarned) {
      highFailureRateWarned = false;
    }
  }
}
