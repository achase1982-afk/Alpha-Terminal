import type { Response } from "express";
import { db, deskSpxTapeTable, sql } from "@workspace/db";
import { addFuturesSymbols, addSymbols, getQuoteBySymbol } from "../schwabStreamer.js";
import { cacheKeyForSymbol, ensureLiveTapeSubscription } from "../chatLiveQuote.js";
import { deskTouchFeed } from "./deskFeedFreshness.js";
import { logger } from "../logger.js";
import { priorNyTradingSessionYmd, marketTradingDateNy, getMarketContext } from "../getMarketContext.js";

export type TapeTick = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  ts: string;
};

const TAPE_SYMBOLS = ["$SPX", "SPY", "/ES"] as const;
const TAPE_DISPLAY: Record<string, string> = {
  $SPX: "SPX",
  SPY: "SPY",
  "/ES": "ES",
};
const RING_MAX = 50_000;
const POLL_MS = 500;
const PERSIST_BATCH = 40;

const ring: TapeTick[] = [];
const sseClients = new Set<Response>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPersistedTs = new Map<string, number>();

function pushTick(tick: TapeTick): void {
  const prev = ring[ring.length - 1];
  if (prev && prev.symbol === tick.symbol && prev.ts === tick.ts && prev.last === tick.last) return;
  ring.push(tick);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);

  const payload = JSON.stringify(tick);
  for (const res of sseClients) {
    res.write(`data: ${payload}\n\n`);
  }
}

function quoteToTick(symbol: string): TapeTick | null {
  const key = cacheKeyForSymbol(symbol);
  const q = getQuoteBySymbol(key);
  if (!q) return null;
  const tsMs = q.ts || Date.now();
  const display = TAPE_DISPLAY[symbol] ?? symbol.replace(/^\$|^\//, "");
  return {
    symbol: display,
    last: q.last,
    bid: q.bid,
    ask: q.ask,
    ts: new Date(tsMs).toISOString(),
  };
}

async function persistTick(tick: TapeTick): Promise<void> {
  const tsMs = Date.parse(tick.ts);
  const last = lastPersistedTs.get(tick.symbol) ?? 0;
  if (tsMs <= last) return;
  lastPersistedTs.set(tick.symbol, tsMs);
  try {
    await db
      .insert(deskSpxTapeTable)
      .values({
        symbol: tick.symbol,
        ts: new Date(tick.ts),
        last: tick.last,
        bid: tick.bid,
        ask: tick.ask,
      })
      .onConflictDoNothing({ target: [deskSpxTapeTable.symbol, deskSpxTapeTable.ts] });
  } catch (err) {
    logger.debug({ err, symbol: tick.symbol }, "desk spx tape persist skipped");
  }
}

let persistQueue: TapeTick[] = [];

function schedulePersist(tick: TapeTick): void {
  persistQueue.push(tick);
  if (persistQueue.length >= PERSIST_BATCH) {
    const batch = persistQueue;
    persistQueue = [];
    void Promise.all(batch.map(persistTick));
  }
}

function pollTape(): void {
  let touched = false;
  for (const sym of TAPE_SYMBOLS) {
    const tick = quoteToTick(sym);
    if (!tick || tick.last == null && tick.bid == null) continue;
    pushTick(tick);
    schedulePersist(tick);
    touched = true;
  }
  if (touched) deskTouchFeed("spx_tape");
}

export function initDeskSpxTape(): void {
  if (pollTimer) return;
  ensureLiveTapeSubscription("SPX");
  ensureLiveTapeSubscription("SPY");
  addSymbols(["$SPX", "SPY"]);
  addFuturesSymbols(["/ES"]);
  pollTimer = setInterval(pollTape, POLL_MS);
  pollTape();
  void pruneOldTapeRows();
}

export function registerDeskSpxSse(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

export function getDeskTapeSince(sinceIso?: string): TapeTick[] {
  if (!sinceIso) return ring.slice(-500);
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return ring.slice(-500);
  return ring.filter((t) => Date.parse(t.ts) > since);
}

async function pruneOldTapeRows(): Promise<void> {
  const ctx = getMarketContext();
  const prior = priorNyTradingSessionYmd(ctx.tradingDate);
  const keepFrom = prior ?? marketTradingDateNy(new Date(Date.now() - 2 * 86_400_000));
  try {
    await db.execute(sql`
      DELETE FROM desk_spx_tape
      WHERE ts < ${keepFrom}::date
    `);
  } catch (err) {
    logger.debug({ err }, "desk spx tape prune skipped");
  }
}

export function deskTapeRingSizeForTests(): number {
  return ring.length;
}

export function deskResetTapeForTests(): void {
  ring.length = 0;
  persistQueue = [];
  lastPersistedTs.clear();
}