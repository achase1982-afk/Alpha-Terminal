import { db, optionsFlowRawTradesTable } from "@workspace/db";
import { logger } from "./logger.js";

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
  side: string | null;     // "BUY" | "SELL" | null  — Phase 2 (aggressor)
  isBlock: boolean;
  isSweep: boolean;
}

const buffer: PendingTrade[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let totalQueued = 0;
let totalWritten = 0;
let totalFailed = 0;
let lastFlushTs: number | null = null;

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

export function getFlowPersistenceStats() {
  return { queued: buffer.length, totalQueued, totalWritten, totalFailed, lastFlushTs };
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
    side: null, // Phase 2 — needs Q.O NBBO subscription
    isBlock: args.isBlock,
    isSweep: args.isSweep,
  });
  totalQueued++;
  if (buffer.length >= FLUSH_BATCH_MAX) void flush();
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await db.insert(optionsFlowRawTradesTable).values(batch);
    totalWritten += batch.length;
    lastFlushTs = Date.now();
  } catch (err) {
    totalFailed += batch.length;
    logger.warn({ err, op: "flowPersist.flush.failed", count: batch.length },
      "Failed to flush options flow batch");
  }
}
