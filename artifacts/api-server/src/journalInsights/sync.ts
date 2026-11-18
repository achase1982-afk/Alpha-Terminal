import { fetchHistory, listLiveBooks } from "../lib/journalHistory.js";
import { logger } from "../lib/logger.js";
import { getValidAccessToken } from "../lib/tokenStore.js";
import { brokerEnvironment, isExcludedBook } from "./accounts.js";
import { normalizeActivity, normalizeOrder, parseOptionSymbol, type RawHistoryActivity, type RawHistoryOrder } from "./normalize.js";
import {
  readSyncState,
  rebuildAccount,
  replaceMarks,
  upsertActivities,
  upsertOrders,
  upsertSnapshot,
  writeSyncState,
} from "./store.js";
import type { NormalizedActivity, NormalizedOrder } from "./types.js";
import { activityWindows, orderWindows, syncRange, type TimeWindow } from "./windows.js";

export interface SyncResult {
  ok: boolean;
  reason?: "no_token" | "busy" | "failed";
  accounts: number;
}

let running = false;

export function marksFromPositions(positions: {
  symbol?: string | null;
  assetType?: string | null;
  longQuantity?: number | null;
  shortQuantity?: number | null;
  marketValue?: number | null;
}[]): { instrumentKey: string; mid: number }[] {
  const marks: { instrumentKey: string; mid: number }[] = [];
  for (const position of positions) {
    const symbol = position.symbol ?? "";
    if (!symbol) continue;
    const qty = (position.longQuantity ?? 0) - (position.shortQuantity ?? 0);
    if (!qty || position.marketValue == null || !Number.isFinite(position.marketValue)) continue;
    const asset = (position.assetType ?? "").toUpperCase();
    const parsed = asset.includes("OPTION") || asset === "" ? parseOptionSymbol(symbol) : null;
    const instrumentKey = parsed?.instrumentKey ?? (asset.includes("OPTION") ? null : symbol.toUpperCase());
    if (!instrumentKey || parsed == null && asset.includes("OPTION")) continue;
    const multiplier = parsed ? 100 : 1;
    const mid = position.marketValue / (qty * multiplier);
    if (!Number.isFinite(mid)) continue;
    marks.push({ instrumentKey, mid });
  }
  return marks;
}

function asList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.transactions)) return record.transactions;
    if (Array.isArray(record.orders)) return record.orders;
  }
  throw new Error("History response was not a list");
}

function capturedOn(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function scopeActivity(activity: NormalizedActivity, accountRef: string): NormalizedActivity {
  return {
    ...activity,
    id: `${accountRef}:${activity.id}`,
    orderRef: activity.orderRef ? `${accountRef}:${activity.orderRef}` : null,
  };
}

function scopeOrder(order: NormalizedOrder, accountRef: string): NormalizedOrder {
  return { ...order, id: `${accountRef}:${order.id}` };
}

async function pullOrders(hash: string, accountRef: string, token: string, window: TimeWindow): Promise<void> {
  const payload = await fetchHistory(token, hash, "orders", window);
  const rows = asList(payload).flatMap((raw) => {
    const order = normalizeOrder(raw as RawHistoryOrder, accountRef);
    if (!order) return [];
    return [{ order: scopeOrder(order, accountRef), payload: raw }];
  });
  await upsertOrders(rows);
}

async function pullActivities(hash: string, accountRef: string, token: string, window: TimeWindow): Promise<void> {
  const payload = await fetchHistory(token, hash, "activities", window);
  const rows = asList(payload).flatMap((raw) => {
    const activity = normalizeActivity(raw as RawHistoryActivity, accountRef);
    if (!activity) return [];
    return [{ activity: scopeActivity(activity, accountRef), payload: raw }];
  });
  await upsertActivities(rows);
}

async function syncAccount(input: {
  hash: string;
  accountRef: string;
  token: string;
  liquidation: number | null;
  marks: { instrumentKey: string; mid: number }[];
  now: Date;
}): Promise<boolean> {
  if (input.liquidation != null && Number.isFinite(input.liquidation)) {
    await upsertSnapshot(input.accountRef, capturedOn(input.now), input.liquidation);
  }
  await replaceMarks(input.accountRef, input.marks, input.now);
  const state = await readSyncState(input.accountRef);
  const range = syncRange({
    syncedThrough: state.syncedThrough,
    backfillComplete: state.backfillComplete,
    now: input.now,
  });
  let progressed = range.start;
  try {
    for (const window of orderWindows(range)) {
      await pullOrders(input.hash, input.accountRef, input.token, window);
      progressed = window.end;
      if (!state.backfillComplete) {
        await writeSyncState({ accountRef: input.accountRef, backfillComplete: false, syncedThrough: progressed });
      }
    }
    for (const window of activityWindows(range)) {
      await pullActivities(input.hash, input.accountRef, input.token, window);
      progressed = window.end;
      if (!state.backfillComplete) {
        await writeSyncState({ accountRef: input.accountRef, backfillComplete: false, syncedThrough: progressed });
      }
    }
    await writeSyncState({ accountRef: input.accountRef, backfillComplete: true, syncedThrough: input.now });
  } catch {
    logger.warn({ accountRef: input.accountRef }, "Journal history window failed");
    if (!state.backfillComplete) {
      await writeSyncState({ accountRef: input.accountRef, backfillComplete: false, syncedThrough: progressed });
    }
    await rebuildAccount(input.accountRef);
    return false;
  }
  await rebuildAccount(input.accountRef);
  return true;
}

export async function startJournalSync(): Promise<SyncResult> {
  if (running) return { ok: true, reason: "busy", accounts: 0 };
  const token = getValidAccessToken("trader");
  if (!token) return { ok: false, reason: "no_token", accounts: 0 };
  running = true;
  try {
    const accounts = await listLiveBooks(token);
    const environment = brokerEnvironment();
    let synced = 0;
    let failed = false;
    for (const account of accounts) {
      if (isExcludedBook({
        type: account.type,
        accountNumber: account.accountNumber,
        environment,
      })) {
        continue;
      }
      const ok = await syncAccount({
        hash: account.accountRef,
        accountRef: account.accountRef,
        token,
        liquidation: account.liquidation,
        marks: marksFromPositions(account.positions ?? []),
        now: new Date(),
      });
      if (ok) synced += 1;
      else failed = true;
    }
    return { ok: !failed, reason: failed ? "failed" : undefined, accounts: synced };
  } catch {
    logger.warn("Journal sync failed");
    return { ok: false, reason: "failed", accounts: 0 };
  } finally {
    running = false;
  }
}
