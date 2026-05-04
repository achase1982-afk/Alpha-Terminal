/**
 * On-demand IBKR market data pools (TotalView depth, Cboe One quotes) with LRU + TTL eviction.
 * IB API calls are delegated via `registerIbDynamicPoolHandlers` from `ibStreamer.ts`.
 */

import { logger } from "./logger.js";

export type DynamicIbPoolName = "totalview" | "cboeOne";

export interface DynamicPoolConfig {
  name: DynamicIbPoolName;
  capacity: number;
  ttlMs: number;
  reqIdBase: number;
}

const TOTALVIEW_POOL: DynamicPoolConfig = {
  name: "totalview",
  capacity: 30,
  ttlMs: 10 * 60 * 1000,
  reqIdBase: 13_000,
};

const CBOE_ONE_POOL: DynamicPoolConfig = {
  name: "cboeOne",
  capacity: 50,
  ttlMs: 10 * 60 * 1000,
  reqIdBase: 15_000,
};

const CONFIGS: Record<DynamicIbPoolName, DynamicPoolConfig> = {
  totalview: TOTALVIEW_POOL,
  cboeOne: CBOE_ONE_POOL,
};

interface Slot {
  symbol: string;
  subscribeAt: number;
  lastAccessedAt: number;
}

export interface AcquireResult {
  /** True when a new IB subscription was started (new slot or replaced LRU). */
  wasColdStart: boolean;
}

export interface PoolStatusSlice {
  name: DynamicIbPoolName;
  size: number;
  capacity: number;
  oldestEntryAgeMs: number | null;
  ttlEvictions: number;
  lruEvictions: number;
}

export interface DynamicPoolsStatus {
  pools: PoolStatusSlice[];
}

type Handlers = {
  subscribeTotalview: (reqId: number, symbol: string) => void;
  unsubscribeTotalview: (reqId: number) => void;
  subscribeCboeOne: (reqId: number, symbol: string) => void;
  unsubscribeCboeOne: (reqId: number) => void;
  /** Called when a pool slot is cleared so streamer state (e.g. 101 skip set) can stay in sync with slot reuse. */
  onDynamicPoolSlotCleared?: (name: DynamicIbPoolName, reqId: number) => void;
};

let handlers: Handlers | null = null;

const slots: Record<DynamicIbPoolName, (Slot | null)[]> = {
  totalview: Array.from({ length: TOTALVIEW_POOL.capacity }, () => null),
  cboeOne: Array.from({ length: CBOE_ONE_POOL.capacity }, () => null),
};

const symbolToIndex: Record<DynamicIbPoolName, Map<string, number>> = {
  totalview: new Map(),
  cboeOne: new Map(),
};

const reqIdToSymbolDynamic: Record<DynamicIbPoolName, Map<number, string>> = {
  totalview: new Map(),
  cboeOne: new Map(),
};

const ttlEvictions: Record<DynamicIbPoolName, number> = { totalview: 0, cboeOne: 0 };
const lruEvictions: Record<DynamicIbPoolName, number> = { totalview: 0, cboeOne: 0 };

/** Slot indices that returned IB 101 — skip re-subscribe until process restart. */
const entitlementSkippedSlots: Record<DynamicIbPoolName, Set<number>> = {
  totalview: new Set(),
  cboeOne: new Set(),
};

let sweeperTimer: ReturnType<typeof setInterval> | null = null;
let poolLogTimer: ReturnType<typeof setInterval> | null = null;

function poolConfig(name: DynamicIbPoolName): DynamicPoolConfig {
  return CONFIGS[name];
}

function reqIdForSlot(name: DynamicIbPoolName, slotIndex: number): number {
  return poolConfig(name).reqIdBase + slotIndex;
}

function slotIndexFromReqId(name: DynamicIbPoolName, reqId: number): number {
  return reqId - poolConfig(name).reqIdBase;
}

function callSubscribe(name: DynamicIbPoolName, reqId: number, symbol: string): void {
  const slotIdx = slotIndexFromReqId(name, reqId);
  if (entitlementSkippedSlots[name].has(slotIdx)) return;
  if (!handlers) return;
  if (name === "totalview") handlers.subscribeTotalview(reqId, symbol);
  else handlers.subscribeCboeOne(reqId, symbol);
}

function callUnsubscribe(name: DynamicIbPoolName, reqId: number): void {
  if (!handlers) return;
  if (name === "totalview") handlers.unsubscribeTotalview(reqId);
  else handlers.unsubscribeCboeOne(reqId);
}

function clearSlot(name: DynamicIbPoolName, slotIndex: number): void {
  const row = slots[name];
  const s = row[slotIndex];
  if (!s) return;
  const reqId = reqIdForSlot(name, slotIndex);
  symbolToIndex[name].delete(s.symbol);
  reqIdToSymbolDynamic[name].delete(reqId);
  row[slotIndex] = null;
  callUnsubscribe(name, reqId);
  handlers?.onDynamicPoolSlotCleared?.(name, reqId);
}

export function registerIbDynamicPoolHandlers(h: Handlers): void {
  handlers = h;
}

export function startIbDynamicPoolSweeper(): void {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => {
    runTtlSweep();
  }, 60_000);
}

export function startIbDynamicPoolUtilizationLogger(): void {
  if (poolLogTimer) return;
  poolLogTimer = setInterval(() => {
    const st = getDynamicIbPoolsStatus();
    logger.info(
      {
        dynamicIbPools: st.pools.map((p) => ({
          pool: p.name,
          size: p.size,
          capacity: p.capacity,
          oldestEntryAgeMs: p.oldestEntryAgeMs,
          ttlEvictions: p.ttlEvictions,
          lruEvictions: p.lruEvictions,
        })),
      },
      "IB: dynamic subscription pool utilization (5m)",
    );
  }, 5 * 60_000);
}

export function stopIbDynamicPoolTimers(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
  if (poolLogTimer) {
    clearInterval(poolLogTimer);
    poolLogTimer = null;
  }
}

function runTtlSweep(): void {
  const now = Date.now();
  for (const name of ["totalview", "cboeOne"] as const) {
    const ttl = poolConfig(name).ttlMs;
    const row = slots[name];
    for (let i = 0; i < row.length; i++) {
      const s = row[i];
      if (!s) continue;
      if (now - s.lastAccessedAt > ttl) {
        clearSlot(name, i);
        ttlEvictions[name]++;
      }
    }
  }
}

function findLruSlotIndex(name: DynamicIbPoolName): number {
  const row = slots[name];
  let best = -1;
  let bestTs = Infinity;
  for (let i = 0; i < row.length; i++) {
    const s = row[i];
    if (!s) continue;
    if (s.lastAccessedAt < bestTs) {
      bestTs = s.lastAccessedAt;
      best = i;
    }
  }
  return best;
}

function findFreeSlotIndex(name: DynamicIbPoolName): number {
  const row = slots[name];
  for (let i = 0; i < row.length; i++) {
    if (row[i] == null) return i;
  }
  return -1;
}

/**
 * Ensure `symbol` is subscribed in the named pool. LRU-evicts when full; refreshes TTL touch on hit.
 */
export function acquireDynamicIbPool(name: DynamicIbPoolName, symbol: string): AcquireResult {
  const upper = symbol.toUpperCase().trim();
  if (!upper) return { wasColdStart: false };

  const idxExisting = symbolToIndex[name].get(upper);
  const now = Date.now();
  if (idxExisting !== undefined) {
    const s = slots[name][idxExisting];
    if (s) s.lastAccessedAt = now;
    return { wasColdStart: false };
  }

  const free = findFreeSlotIndex(name);
  let slotIndex: number;
  let wasColdStart = true;

  if (free >= 0) {
    slotIndex = free;
  } else {
    slotIndex = findLruSlotIndex(name);
    if (slotIndex < 0) return { wasColdStart: false };
    lruEvictions[name]++;
    clearSlot(name, slotIndex);
  }

  const reqId = reqIdForSlot(name, slotIndex);
  entitlementSkippedSlots[name].delete(slotIndex);
  slots[name][slotIndex] = { symbol: upper, subscribeAt: now, lastAccessedAt: now };
  symbolToIndex[name].set(upper, slotIndex);
  reqIdToSymbolDynamic[name].set(reqId, upper);
  callSubscribe(name, reqId, upper);
  return { wasColdStart };
}

export function resubscribeAllDynamicIbPools(): void {
  if (!handlers) return;
  for (const name of ["totalview", "cboeOne"] as const) {
    const row = slots[name];
    for (let i = 0; i < row.length; i++) {
      const s = row[i];
      if (!s) continue;
      const reqId = reqIdForSlot(name, i);
      callSubscribe(name, reqId, s.symbol);
    }
  }
}

export function teardownDynamicIbPools(): void {
  for (const name of ["totalview", "cboeOne"] as const) {
    const row = slots[name];
    for (let i = 0; i < row.length; i++) {
      if (row[i]) clearSlot(name, i);
    }
    entitlementSkippedSlots[name].clear();
  }
  symbolToIndex.totalview.clear();
  symbolToIndex.cboeOne.clear();
}

/** IB error 101 on a pool reqId: release the slot and stop retrying that line until restart. */
export function markDynamicIbPoolSlotEntitlementFailed(name: DynamicIbPoolName, reqId: number): void {
  const idx = slotIndexFromReqId(name, reqId);
  if (idx < 0 || idx >= slots[name].length) return;
  entitlementSkippedSlots[name].add(idx);
  clearSlot(name, idx);
}

export function getDynamicIbPoolsStatus(): DynamicPoolsStatus {
  const now = Date.now();
  const pools: PoolStatusSlice[] = [];
  for (const name of ["totalview", "cboeOne"] as const) {
    const row = slots[name];
    let oldest: number | null = null;
    let size = 0;
    for (const s of row) {
      if (!s) continue;
      size++;
      const age = now - s.lastAccessedAt;
      oldest = oldest == null ? age : Math.max(oldest, age);
    }
    pools.push({
      name,
      size,
      capacity: poolConfig(name).capacity,
      oldestEntryAgeMs: oldest,
      ttlEvictions: ttlEvictions[name],
      lruEvictions: lruEvictions[name],
    });
  }
  return { pools };
}

export function getPoolSlice(name: DynamicIbPoolName): PoolStatusSlice {
  return getDynamicIbPoolsStatus().pools.find((p) => p.name === name)!;
}

export function listDynamicTotalviewReqMappings(): ReadonlyArray<{ reqId: number; symbol: string }> {
  const out: { reqId: number; symbol: string }[] = [];
  const row = slots.totalview;
  for (let i = 0; i < row.length; i++) {
    const s = row[i];
    if (s) out.push({ reqId: reqIdForSlot("totalview", i), symbol: s.symbol });
  }
  return out;
}

export function listDynamicCboeOneReqMappings(): ReadonlyArray<{ reqId: number; symbol: string }> {
  const out: { reqId: number; symbol: string }[] = [];
  const row = slots.cboeOne;
  for (let i = 0; i < row.length; i++) {
    const s = row[i];
    if (s) out.push({ reqId: reqIdForSlot("cboeOne", i), symbol: s.symbol });
  }
  return out;
}

export function totalviewReqIdForSymbol(symbol: string): number | null {
  const i = symbolToIndex.totalview.get(symbol.toUpperCase());
  return i === undefined ? null : reqIdForSlot("totalview", i);
}

export function cboeOneReqIdForSymbol(symbol: string): number | null {
  const i = symbolToIndex.cboeOne.get(symbol.toUpperCase());
  return i === undefined ? null : reqIdForSlot("cboeOne", i);
}

export function dynamicTotalviewSymbolForReqId(reqId: number): string | undefined {
  return reqIdToSymbolDynamic.totalview.get(reqId);
}

export function dynamicCboeOneSymbolForReqId(reqId: number): string | undefined {
  return reqIdToSymbolDynamic.cboeOne.get(reqId);
}

export function isDynamicTotalviewReqId(reqId: number): boolean {
  const base = TOTALVIEW_POOL.reqIdBase;
  return reqId >= base && reqId < base + TOTALVIEW_POOL.capacity;
}

export function isDynamicCboeOneReqId(reqId: number): boolean {
  const base = CBOE_ONE_POOL.reqIdBase;
  return reqId >= base && reqId < base + CBOE_ONE_POOL.capacity;
}
