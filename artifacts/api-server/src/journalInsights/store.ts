import {
  and,
  asc,
  db,
  eq,
  gte,
  lte,
  sql,
} from "@workspace/db";
import {
  equityDailyTable,
  journalActivitiesTable,
  journalEquitySnapshotsTable,
  journalLotsTable,
  journalMarksTable,
  journalOrdersTable,
  journalPositionsTable,
  journalSyncStateTable,
} from "@workspace/db/schema";
import { rebuildBook } from "./ledger.js";
import { buildInsights, type BenchmarkPoint, type EquityPoint } from "./metrics.js";
import type { BuiltLot, BuiltPosition, InsightsPayload, NormalizedActivity, NormalizedLeg, NormalizedOrder } from "./types.js";

const BATCH = 200;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function upsertActivities(rows: { activity: NormalizedActivity; payload: unknown }[]): Promise<void> {
  for (const batch of chunks(rows, BATCH)) {
    if (batch.length === 0) continue;
    await db
      .insert(journalActivitiesTable)
      .values(batch.map(({ activity, payload }) => ({
        id: activity.id,
        accountRef: activity.accountRef,
        occurredAt: new Date(activity.occurredAt),
        kind: activity.kind,
        netAmount: activity.netAmount,
        fees: activity.fees,
        orderRef: activity.orderRef,
        description: activity.description,
        legs: activity.legs,
        payload,
      })))
      .onConflictDoUpdate({
        target: journalActivitiesTable.id,
        set: {
          accountRef: sql`excluded.account_ref`,
          occurredAt: sql`excluded.occurred_at`,
          kind: sql`excluded.kind`,
          netAmount: sql`excluded.net_amount`,
          fees: sql`excluded.fees`,
          orderRef: sql`excluded.order_ref`,
          description: sql`excluded.description`,
          legs: sql`excluded.legs`,
          payload: sql`excluded.payload`,
        },
      });
  }
}

export async function upsertOrders(rows: { order: NormalizedOrder; payload: unknown }[]): Promise<void> {
  for (const batch of chunks(rows, BATCH)) {
    if (batch.length === 0) continue;
    await db
      .insert(journalOrdersTable)
      .values(batch.map(({ order, payload }) => ({
        id: order.id,
        accountRef: order.accountRef,
        enteredAt: new Date(order.enteredAt),
        closedAt: order.closedAt ? new Date(order.closedAt) : null,
        status: order.status,
        legs: order.legs,
        payload,
      })))
      .onConflictDoUpdate({
        target: journalOrdersTable.id,
        set: {
          accountRef: sql`excluded.account_ref`,
          enteredAt: sql`excluded.entered_at`,
          closedAt: sql`excluded.closed_at`,
          status: sql`excluded.status`,
          legs: sql`excluded.legs`,
          payload: sql`excluded.payload`,
        },
      });
  }
}

export async function writeSyncState(input: {
  accountRef: string;
  backfillComplete: boolean;
  syncedThrough: Date | null;
}): Promise<void> {
  await db
    .insert(journalSyncStateTable)
    .values({
      accountRef: input.accountRef,
      backfillComplete: input.backfillComplete,
      syncedThrough: input.syncedThrough,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: journalSyncStateTable.accountRef,
      set: {
        backfillComplete: input.backfillComplete,
        syncedThrough: input.syncedThrough,
        updatedAt: new Date(),
      },
    });
}

export async function readSyncState(accountRef: string): Promise<{ backfillComplete: boolean; syncedThrough: string | null }> {
  const [row] = await db.select().from(journalSyncStateTable).where(eq(journalSyncStateTable.accountRef, accountRef));
  return {
    backfillComplete: row?.backfillComplete ?? false,
    syncedThrough: row?.syncedThrough ? row.syncedThrough.toISOString() : null,
  };
}

export async function upsertSnapshot(accountRef: string, capturedOn: string, liquidationValue: number): Promise<void> {
  await db
    .insert(journalEquitySnapshotsTable)
    .values({ accountRef, capturedOn, liquidationValue })
    .onConflictDoUpdate({
      target: [journalEquitySnapshotsTable.accountRef, journalEquitySnapshotsTable.capturedOn],
      set: { liquidationValue },
    });
}

export async function replaceMarks(accountRef: string, marks: { instrumentKey: string; mid: number }[], capturedAt: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(journalMarksTable).where(eq(journalMarksTable.accountRef, accountRef));
    for (const batch of chunks(marks, BATCH)) {
      if (batch.length === 0) continue;
      await tx.insert(journalMarksTable).values(batch.map((mark) => ({
        accountRef,
        instrumentKey: mark.instrumentKey,
        mid: mark.mid,
        capturedAt,
      })));
    }
  });
}

export async function replaceBook(accountRef: string, positions: BuiltPosition[], lots: BuiltLot[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(journalLotsTable).where(eq(journalLotsTable.accountRef, accountRef));
    await tx.delete(journalPositionsTable).where(eq(journalPositionsTable.accountRef, accountRef));
    for (const batch of chunks(positions, BATCH)) {
      if (batch.length === 0) continue;
      await tx.insert(journalPositionsTable).values(batch.map((position) => ({
        id: position.id,
        accountRef: position.accountRef,
        strategy: position.strategy,
        assetClass: position.assetClass,
        underlying: position.underlying,
        label: position.label,
        status: position.status,
        openedAt: new Date(position.openedAt),
        closedAt: position.closedAt ? new Date(position.closedAt) : null,
        ticketAt: new Date(position.ticketAt),
        quantity: position.quantity,
        remainingQty: position.remainingQty,
        netPnl: position.netPnl,
        grossPnl: position.grossPnl,
        fees: position.fees,
        unrealizedPnl: position.unrealizedPnl,
        rolledFromId: position.rolledFromId,
        legs: position.legs,
      })));
    }
    for (const batch of chunks(lots, BATCH)) {
      if (batch.length === 0) continue;
      await tx.insert(journalLotsTable).values(batch.map((lot) => ({
        id: lot.id,
        accountRef: lot.accountRef,
        positionId: lot.positionId,
        instrumentKey: lot.instrumentKey,
        side: lot.side,
        openedAt: new Date(lot.openedAt),
        closedAt: lot.closedAt ? new Date(lot.closedAt) : null,
        openQty: lot.openQty,
        remainingQty: lot.remainingQty,
        openPrice: lot.openPrice,
        multiplier: lot.multiplier,
        fees: lot.fees,
        realizedPnl: lot.realizedPnl,
      })));
    }
  });
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function loadActivities(): Promise<NormalizedActivity[]> {
  const rows = await db.select().from(journalActivitiesTable).orderBy(asc(journalActivitiesTable.occurredAt));
  return rows.map((row) => ({
    id: row.id,
    accountRef: row.accountRef,
    occurredAt: iso(row.occurredAt) ?? new Date(0).toISOString(),
    kind: row.kind as NormalizedActivity["kind"],
    netAmount: row.netAmount,
    fees: row.fees,
    orderRef: row.orderRef,
    description: row.description,
    legs: (row.legs as NormalizedLeg[]) ?? [],
  }));
}

export async function loadOrders(): Promise<NormalizedOrder[]> {
  const rows = await db.select().from(journalOrdersTable).orderBy(asc(journalOrdersTable.enteredAt));
  return rows.map((row) => ({
    id: row.id,
    accountRef: row.accountRef,
    enteredAt: iso(row.enteredAt) ?? new Date(0).toISOString(),
    closedAt: iso(row.closedAt),
    status: row.status,
    legs: (row.legs as NormalizedLeg[]) ?? [],
  }));
}

export async function loadSnapshots(): Promise<EquityPoint[]> {
  const rows = await db.select().from(journalEquitySnapshotsTable).orderBy(asc(journalEquitySnapshotsTable.capturedOn));
  return rows.map((row) => ({
    at: `${row.capturedOn}T21:00:00.000Z`,
    value: row.liquidationValue,
  }));
}

export async function loadMarks(): Promise<Record<string, number>> {
  const rows = await db.select().from(journalMarksTable);
  const marks: Record<string, number> = {};
  for (const row of rows) marks[row.instrumentKey] = row.mid;
  return marks;
}

export async function loadAdjustedBenchmark(startDate: string, endDate: string): Promise<BenchmarkPoint[]> {
  const rows = await db
    .select({
      date: equityDailyTable.date,
      adjustedClose: equityDailyTable.adjustedClose,
    })
    .from(equityDailyTable)
    .where(and(
      eq(equityDailyTable.symbol, "SPY"),
      gte(equityDailyTable.date, startDate),
      lte(equityDailyTable.date, endDate),
    ))
    .orderBy(asc(equityDailyTable.date));
  return rows
    .filter((row): row is { date: string; adjustedClose: number } => typeof row.adjustedClose === "number" && row.adjustedClose > 0)
    .map((row) => ({ date: row.date, adjustedClose: row.adjustedClose }));
}

export async function readInsights(period: "ytd" | "lifetime", asOf = new Date()): Promise<InsightsPayload> {
  const [activities, orders, snapshots, marks] = await Promise.all([
    loadActivities(),
    loadOrders(),
    loadSnapshots(),
    loadMarks(),
  ]);
  const endDate = asOf.toISOString().slice(0, 10);
  let benchmark: BenchmarkPoint[] = [];
  try {
    benchmark = await loadAdjustedBenchmark("1993-01-01", endDate);
  } catch {
    benchmark = [];
  }
  const { positions } = rebuildBook({ activities, orders, marks });
  return buildInsights({
    positions,
    activities,
    period,
    asOf: asOf.toISOString(),
    snapshots,
    benchmark,
  });
}

export async function rebuildAccount(accountRef: string): Promise<void> {
  const [activities, orders, marks] = await Promise.all([loadActivities(), loadOrders(), loadMarks()]);
  const mineActivities = activities.filter((activity) => activity.accountRef === accountRef);
  const mineOrders = orders.filter((order) => order.accountRef === accountRef);
  const { positions, lots } = rebuildBook({
    activities: mineActivities,
    orders: mineOrders,
    marks,
  });
  await replaceBook(accountRef, positions.filter((position) => position.accountRef === accountRef), lots.filter((lot) => lot.accountRef === accountRef));
}
