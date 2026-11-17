import {
  APP_L1_OPTIONS_MAX,
  deskAppLevelOneOptionsCap,
  deskAppOptionsBookCap,
  deskComputeDeskLevelOneOptionsBudget,
  deskComputeDeskOptionsBookBudget,
  deskGetSchwabStreamerLimits,
} from "./desk/deskStreamerBudget.js";
import { sortOptionKeysNearTheMoney } from "./streamerSubPlanSort.js";
import {
  streamerWireSimulatorLiveAppLevelOneCount,
  streamerWireSimulatorLiveDeskLevelOneCount,
  streamerWireSimulatorLiveLevelOneOptionsCount,
} from "./streamerWireSimulator.js";

export type StreamerSubTier = "desk_core" | "user_visible" | "background";
export type StreamerSubService = "LEVELONE_OPTIONS" | "OPTIONS_BOOK";

export type StreamerSubHold = {
  holderId: string;
  tier: StreamerSubTier;
  service: StreamerSubService;
  keys: string[];
  lastTouchMs: number;
};

export const STREAMER_L1_OPTIONS_CAP = 3_000;
export const STREAMER_OPTIONS_BOOK_CAP = 100;

const DEFAULT_HOLD_TTL_MS = 30 * 60_000;

const holds = new Map<string, StreamerSubHold>();
const rejections: Array<{ atMs: number; service: StreamerSubService; key: string; reason: string }> = [];

let deskCoreOptionKeys = new Set<string>();
let deskCoreBookKeys = new Set<string>();
let chainSortSpot: number | null = null;

export function streamerSubSetChainSortSpot(spot: number | null): void {
  chainSortSpot = spot;
}

export function streamerSubGetChainSortSpot(): number | null {
  return chainSortSpot;
}

function holdPriority(holderId: string): number {
  if (holderId.startsWith("ticket:")) return 0;
  if (holderId.startsWith("portfolio:positions:")) return 1;
  if (holderId.startsWith("chain:")) return 2;
  return 3;
}

let planGeneration = 0;
type L1PlanCache = {
  generation: number;
  appSubscribed: string[];
  appSubscribedSet: Set<string>;
  capped: boolean;
  deskCoreCount: number;
  userVisibleCount: number;
  backgroundCount: number;
};
let l1PlanCache: L1PlanCache | null = null;

type BookPlanCache = {
  generation: number;
  appSubscribed: string[];
  appSubscribedSet: Set<string>;
};
let bookPlanCache: BookPlanCache | null = null;

function bumpPlan(): void {
  planGeneration += 1;
  l1PlanCache = null;
  bookPlanCache = null;
}

let holdPrunerStarted = false;

function pruneExpiredHolds(now = Date.now()): void {
  let removed = false;
  for (const [id, h] of holds) {
    if (now - h.lastTouchMs > DEFAULT_HOLD_TTL_MS) {
      holds.delete(id);
      removed = true;
    }
  }
  if (removed) {
    bumpPlan();
    void streamerSubApplyManagedOptionsSubscriptions();
    void streamerSubApplyManagedOptionsBookSubscriptions();
  }
}

export function streamerSubStartHoldPruner(): void {
  if (holdPrunerStarted) return;
  holdPrunerStarted = true;
  const t = setInterval(() => pruneExpiredHolds(), 60_000);
  t.unref?.();
}

export function streamerSubDeskCoreOptionKeysList(): string[] {
  return [...deskCoreOptionKeys];
}

export function streamerSubDeskCoreBookKeysList(): string[] {
  return [...deskCoreBookKeys];
}

export function streamerSubSetDeskCore(service: StreamerSubService, keys: Iterable<string>): void {
  const s = new Set([...keys].map((k) => k.trim()).filter(Boolean));
  if (service === "LEVELONE_OPTIONS") deskCoreOptionKeys = s;
  else if (service === "OPTIONS_BOOK") deskCoreBookKeys = s;
  bumpPlan();
}

export function streamerSubHold(
  holderId: string,
  tier: StreamerSubTier,
  service: StreamerSubService,
  keys: string[],
): void {
  const uniq = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  holds.set(holderId, {
    holderId,
    tier,
    service,
    keys: uniq,
    lastTouchMs: Date.now(),
  });
  bumpPlan();
}

export function streamerSubReplaceHold(
  holderId: string,
  tier: StreamerSubTier,
  service: StreamerSubService,
  keys: string[],
): void {
  streamerSubHold(holderId, tier, service, keys);
}

export function streamerSubMergeHold(
  holderId: string,
  tier: StreamerSubTier,
  service: StreamerSubService,
  keys: string[],
): void {
  const prev = holds.get(holderId);
  const merged = new Set([...(prev?.keys ?? []), ...keys.map((k) => k.trim()).filter(Boolean)]);
  streamerSubHold(holderId, tier, service, [...merged]);
}

export function streamerSubTouch(holderId: string): void {
  const h = holds.get(holderId);
  if (!h) return;
  h.lastTouchMs = Date.now();
}

export function streamerSubKeysForHolder(holderId: string): string[] {
  return holds.get(holderId)?.keys ?? [];
}

export async function streamerSubRelease(holderId: string): Promise<boolean> {
  if (!holds.has(holderId)) return false;
  holds.delete(holderId);
  bumpPlan();
  await streamerSubApplyManagedOptionsSubscriptions();
  await streamerSubApplyManagedOptionsBookSubscriptions();
  return true;
}

export async function streamerSubReleaseByPrefix(holderPrefix: string): Promise<number> {
  let n = 0;
  for (const id of [...holds.keys()]) {
    if (id.startsWith(holderPrefix)) {
      holds.delete(id);
      n += 1;
    }
  }
  if (n > 0) {
    bumpPlan();
    await streamerSubApplyManagedOptionsSubscriptions();
    await streamerSubApplyManagedOptionsBookSubscriptions();
  }
  return n;
}

export function streamerSubRecordRejection(
  service: StreamerSubService,
  key: string,
  reason: string,
): void {
  rejections.push({ atMs: Date.now(), service, key, reason });
  if (rejections.length > 40) rejections.shift();
}

export function streamerSubParseRejectionKey(msgText: string | undefined): string {
  if (!msgText?.trim()) return "unknown";
  const occ = msgText.match(/\b[A-Z]{1,6}\s+\d{6}[CP]\d{8,}\b/);
  if (occ) return occ[0]!.replace(/\s+/g, "");
  const keysMatch = msgText.match(/keys=([^,\s]+)/i);
  if (keysMatch?.[1]) return keysMatch[1].split("|")[0] ?? keysMatch[1];
  const parts = msgText.split(",");
  if (parts.length > 1) return parts[1]!.trim().slice(0, 40) || parts[0]!.trim().slice(0, 40);
  return msgText.trim().slice(0, 40);
}

function buildTierMaps(
  userHolds: StreamerSubHold[],
  bgHolds: StreamerSubHold[],
  desk: Set<string>,
): { userKeys: Set<string>; bgKeys: Set<string> } {
  const userKeys = new Set<string>();
  const bgKeys = new Set<string>();
  for (const h of userHolds) {
    for (const k of h.keys) {
      if (!desk.has(k)) userKeys.add(k);
    }
  }
  for (const h of bgHolds) {
    for (const k of h.keys) {
      if (!desk.has(k) && !userKeys.has(k)) bgKeys.add(k);
    }
  }
  return { userKeys, bgKeys };
}

function buildL1Plan(): L1PlanCache {
  const desk = deskCoreOptionKeys;
  const appCap = Math.min(APP_L1_OPTIONS_MAX, deskAppLevelOneOptionsCap());
  const ordered: string[] = [];
  const inPlan = new Set<string>();

  const userHolds: StreamerSubHold[] = [];
  const bgHolds: StreamerSubHold[] = [];
  for (const h of holds.values()) {
    if (h.service !== "LEVELONE_OPTIONS") continue;
    if (h.tier === "user_visible") userHolds.push(h);
    else if (h.tier === "background") bgHolds.push(h);
  }
  userHolds.sort((a, b) => holdPriority(a.holderId) - holdPriority(b.holderId) || b.lastTouchMs - a.lastTouchMs);
  bgHolds.sort((a, b) => a.lastTouchMs - b.lastTouchMs);

  let userVisibleCount = 0;
  let backgroundCount = 0;

  const addKeys = (keys: string[], tier: "user_visible" | "background") => {
    for (const k of keys) {
      if (desk.has(k) || inPlan.has(k)) continue;
      if (ordered.length >= appCap) return;
      inPlan.add(k);
      ordered.push(k);
      if (tier === "user_visible") userVisibleCount += 1;
      else backgroundCount += 1;
    }
  };

  for (const h of userHolds) {
    if (ordered.length >= appCap) break;
    const keys =
      h.holderId.startsWith("chain:")
        ? sortOptionKeysNearTheMoney(h.keys, chainSortSpot)
        : h.keys;
    addKeys(keys, "user_visible");
  }

  for (const h of bgHolds) {
    if (ordered.length >= appCap) break;
    addKeys(h.keys, "background");
  }

  return {
    generation: planGeneration,
    appSubscribed: ordered,
    appSubscribedSet: new Set(ordered),
    capped: ordered.length >= appCap,
    deskCoreCount: desk.size,
    userVisibleCount,
    backgroundCount,
  };
}

function getL1PlanCache(): L1PlanCache {
  if (l1PlanCache?.generation === planGeneration) return l1PlanCache;
  l1PlanCache = buildL1Plan();
  return l1PlanCache;
}

function buildBookPlan(): BookPlanCache {
  const desk = deskCoreBookKeys;
  const appCap = deskAppOptionsBookCap();
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const h of holds.values()) {
    if (h.service !== "OPTIONS_BOOK") continue;
    for (const k of h.keys) {
      if (desk.has(k) || seen.has(k)) continue;
      if (ordered.length >= appCap) break;
      seen.add(k);
      ordered.push(k);
    }
  }
  return {
    generation: planGeneration,
    appSubscribed: ordered,
    appSubscribedSet: new Set(ordered),
  };
}

function getBookPlanCache(): BookPlanCache {
  if (bookPlanCache?.generation === planGeneration) return bookPlanCache;
  bookPlanCache = buildBookPlan();
  return bookPlanCache;
}

export function streamerSubPlanLevelOneOptions(): {
  subscribed: string[];
  appSubscribed: string[];
  capped: boolean;
  budget: number;
  deskCoreCount: number;
} {
  const c = getL1PlanCache();
  return {
    subscribed: c.appSubscribed,
    appSubscribed: c.appSubscribed,
    capped: c.capped,
    budget: STREAMER_L1_OPTIONS_CAP,
    deskCoreCount: c.deskCoreCount,
  };
}

export function streamerSubPlanOptionsBook(): { subscribed: string[]; budget: number } {
  const c = getBookPlanCache();
  return { subscribed: c.appSubscribed, budget: STREAMER_OPTIONS_BOOK_CAP };
}

export function streamerSubMaxDeskOptionKeys(): number {
  return deskComputeDeskLevelOneOptionsBudget(getL1PlanCache().appSubscribed.length);
}

export function streamerSubMaxDeskBookKeys(): number {
  return deskComputeDeskOptionsBookBudget(getBookPlanCache().appSubscribed.length);
}

export function streamerSubHoldCount(): number {
  return holds.size;
}

export function getStreamerSubscriptionHealth(_now = Date.now()) {
  const limits = deskGetSchwabStreamerLimits();
  const l1 = getL1PlanCache();
  const book = getBookPlanCache();
  return {
    limits,
    levelone_options: {
      cap: STREAMER_L1_OPTIONS_CAP,
      desk_core: l1.deskCoreCount,
      user_visible: l1.userVisibleCount,
      background: l1.backgroundCount,
      managed_holds: holds.size,
      planned_app: l1.appSubscribed.length,
      live_app: streamerWireSimulatorLiveAppLevelOneCount(),
      live_desk: streamerWireSimulatorLiveDeskLevelOneCount(),
      live_total: streamerWireSimulatorLiveLevelOneOptionsCount(),
      planned: l1.deskCoreCount + l1.appSubscribed.length,
      capped: l1.capped,
    },
    options_book: {
      cap: STREAMER_OPTIONS_BOOK_CAP,
      desk_core: deskCoreBookKeys.size,
      planned_app: book.appSubscribed.length,
      planned: deskCoreBookKeys.size + book.appSubscribed.length,
    },
    streamer_add_rejections: rejections.slice(-20),
  };
}

export async function streamerSubApplyManagedOptionsSubscriptions(): Promise<void> {
  const appPlan = getL1PlanCache().appSubscribed;
  const { replaceManagedLevelOneOptionSubscriptions } = await import("./schwabStreamer.js");
  replaceManagedLevelOneOptionSubscriptions(appPlan);
}

/** @deprecated use streamerSubApplyManagedOptionsSubscriptions */
export const streamerSubApplyManagedSubscriptions = streamerSubApplyManagedOptionsSubscriptions;

export async function streamerSubApplyManagedOptionsBookSubscriptions(): Promise<void> {
  const appPlan = getBookPlanCache().appSubscribed;
  const { replaceManagedOptionsBookSubscriptions } = await import("./schwabStreamer.js");
  replaceManagedOptionsBookSubscriptions(appPlan);
}

export function streamerSubResetForTests(): void {
  holds.clear();
  rejections.length = 0;
  deskCoreOptionKeys = new Set();
  deskCoreBookKeys = new Set();
  chainSortSpot = null;
  streamerSubResetWiredAppPlanSigForTests();
  bumpPlan();
}

export function streamerSubSeedHoldForTests(
  holderId: string,
  tier: StreamerSubTier,
  keys: string[],
): void {
  holds.set(holderId, {
    holderId,
    tier,
    service: "LEVELONE_OPTIONS",
    keys,
    lastTouchMs: Date.now(),
  });
  bumpPlan();
}

export function streamerSubBulkSeedHoldsForTests(
  rows: Array<{ holderId: string; tier: StreamerSubTier; keys: string[] }>,
): void {
  for (const row of rows) {
    holds.set(row.holderId, {
      holderId: row.holderId,
      tier: row.tier,
      service: "LEVELONE_OPTIONS",
      keys: row.keys,
      lastTouchMs: Date.now(),
    });
  }
  bumpPlan();
}

export function streamerSubPlanGeneration(): number {
  return planGeneration;
}

let lastWiredAppPlanSig = "";
let deskTrimDebounce: ReturnType<typeof setTimeout> | null = null;

export function streamerSubNotifyAppPlanWired(appKeys: string[]): void {
  const sig = [...appKeys].sort().join("\0");
  if (sig === lastWiredAppPlanSig) return;
  lastWiredAppPlanSig = sig;
  if (deskTrimDebounce) clearTimeout(deskTrimDebounce);
  deskTrimDebounce = setTimeout(() => {
    deskTrimDebounce = null;
    void import("./desk/deskTapeUniverse.js").then((m) => m.deskTapeUniverseAdjustToAppPlan());
  }, 2_000);
  deskTrimDebounce.unref?.();
}

export function streamerSubResetWiredAppPlanSigForTests(): void {
  lastWiredAppPlanSig = "";
  if (deskTrimDebounce) clearTimeout(deskTrimDebounce);
  deskTrimDebounce = null;
}
