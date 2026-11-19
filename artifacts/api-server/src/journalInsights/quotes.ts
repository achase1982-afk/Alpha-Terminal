import { and, asc, db, eq, lt, sql } from "@workspace/db";
import {
  journalBooksTable,
  journalPositionQuoteTable,
  journalPositionWatchTable,
  journalPositionsTable,
} from "@workspace/db/schema";
import { excursionFromSamples, type QuoteSample } from "./excursion.js";
import type { ExcursionView, JournalBook } from "./types.js";

export interface WatchLeg {
  instrumentKey: string;
  side: "long" | "short";
  qty: number;
  openPrice: number;
  multiplier: number;
}

export async function loadBooks(): Promise<JournalBook[]> {
  try {
    const rows = await db.select().from(journalBooksTable);
    return rows.map((row) => ({ id: row.accountRef, label: row.label, paper: row.paper }));
  } catch {
    return [];
  }
}

export async function upsertBook(input: { accountRef: string; label: string; paper: boolean }): Promise<void> {
  try {
    await db.insert(journalBooksTable).values({
      accountRef: input.accountRef,
      label: input.label,
      paper: input.paper,
    }).onConflictDoUpdate({
      target: journalBooksTable.accountRef,
      set: { label: sql`excluded.label`, paper: sql`excluded.paper` },
    });
  } catch {
    /* The book table arrives with the quote migration. */
  }
}

export async function loadOpenPositions(): Promise<{
  id: string;
  accountRef: string;
  openedAt: Date;
  status: string;
  legs: unknown;
}[]> {
  const rows = await db.select({
    id: journalPositionsTable.id,
    accountRef: journalPositionsTable.accountRef,
    openedAt: journalPositionsTable.openedAt,
    status: journalPositionsTable.status,
    legs: journalPositionsTable.legs,
  }).from(journalPositionsTable);
  return rows.filter((row) => row.status === "open" || row.status === "partial");
}

export async function ensureWatch(input: {
  positionId: string;
  accountRef: string;
  openedAt: Date;
  legs: WatchLeg[];
  now: Date;
}): Promise<void> {
  const startedLate = input.now.getTime() - input.openedAt.getTime() > 3 * 60_000;
  await db.insert(journalPositionWatchTable).values({
    positionId: input.positionId,
    accountRef: input.accountRef,
    openedAt: input.openedAt,
    status: "open",
    startedLate,
    legs: input.legs,
  }).onConflictDoNothing();
}

export async function writeQuote(input: {
  positionId: string;
  ts: Date;
  valid: boolean;
  unrealized: number | null;
  legs: unknown;
  source: string;
}): Promise<void> {
  const id = `${input.positionId}:${input.ts.toISOString().slice(0, 16)}`;
  await db.insert(journalPositionQuoteTable).values({
    id,
    positionId: input.positionId,
    ts: input.ts,
    valid: input.valid,
    unrealized: input.unrealized,
    legs: input.legs,
    source: input.source,
  }).onConflictDoNothing();
}

export async function closeWatch(positionId: string, closedAt: Date, metrics: ExcursionView): Promise<void> {
  await db.update(journalPositionWatchTable).set({
    status: "closed",
    closedAt,
    metrics,
  }).where(eq(journalPositionWatchTable.positionId, positionId));
}

export async function openWatches(): Promise<{
  positionId: string;
  accountRef: string;
  openedAt: Date;
  startedLate: boolean;
  legs: WatchLeg[];
}[]> {
  const rows = await db.select().from(journalPositionWatchTable).where(eq(journalPositionWatchTable.status, "open"));
  return rows.map((row) => ({
    positionId: row.positionId,
    accountRef: row.accountRef,
    openedAt: row.openedAt,
    startedLate: row.startedLate,
    legs: (row.legs as WatchLeg[]) ?? [],
  }));
}

export async function quotesFor(positionId: string): Promise<QuoteSample[]> {
  const rows = await db.select().from(journalPositionQuoteTable)
    .where(eq(journalPositionQuoteTable.positionId, positionId))
    .orderBy(asc(journalPositionQuoteTable.ts));
  return rows.map((row) => ({
    ts: row.ts.toISOString(),
    valid: row.valid,
    unrealized: row.unrealized,
  }));
}

export async function excursionMap(positionIds: string[]): Promise<Record<string, ExcursionView>> {
  if (positionIds.length === 0) return {};
  try {
    const watches = await db.select().from(journalPositionWatchTable);
    const out: Record<string, ExcursionView> = {};
    for (const watch of watches) {
      if (!positionIds.includes(watch.positionId)) continue;
      const stored = watch.metrics as ExcursionView | null;
      if (stored && stored.label) {
        out[watch.positionId] = stored;
        continue;
      }
      const samples = await quotesFor(watch.positionId);
      if (samples.length === 0 && watch.status === "open") continue;
      out[watch.positionId] = excursionFromSamples({
        openedAt: watch.openedAt.toISOString(),
        closedAt: watch.closedAt ? watch.closedAt.toISOString() : null,
        exitPnl: null,
        startedLate: watch.startedLate,
        samples,
      });
    }
    return out;
  } catch {
    return {};
  }
}

export async function pruneQuotes(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  await db.delete(journalPositionQuoteTable).where(lt(journalPositionQuoteTable.ts, cutoff));
}

export function unrealizedAtMid(legs: WatchLeg[], mids: Record<string, number>): { unrealized: number | null; quotes: { instrumentKey: string; bid: number; ask: number }[]; valid: boolean } {
  const quotes: { instrumentKey: string; bid: number; ask: number }[] = [];
  let unrealized = 0;
  for (const leg of legs) {
    const mid = mids[leg.instrumentKey];
    if (mid == null || !Number.isFinite(mid)) return { unrealized: null, quotes, valid: false };
    const bid = mid;
    const ask = mid;
    if (!((bid > 0 || ask > 0) && ask >= bid)) return { unrealized: null, quotes, valid: false };
    quotes.push({ instrumentKey: leg.instrumentKey, bid, ask });
    const signed = leg.side === "short" ? leg.openPrice - mid : mid - leg.openPrice;
    unrealized += signed * leg.qty * leg.multiplier;
  }
  return { unrealized, quotes, valid: legs.length > 0 };
}

export async function flatPosition(positionId: string): Promise<{ closedAt: Date; grossPnl: number } | null> {
  const [row] = await db.select({
    status: journalPositionsTable.status,
    closedAt: journalPositionsTable.closedAt,
    grossPnl: journalPositionsTable.grossPnl,
  }).from(journalPositionsTable).where(and(eq(journalPositionsTable.id, positionId)));
  if (!row || row.status === "open" || row.status === "partial" || !row.closedAt) return null;
  return { closedAt: row.closedAt, grossPnl: row.grossPnl };
}
