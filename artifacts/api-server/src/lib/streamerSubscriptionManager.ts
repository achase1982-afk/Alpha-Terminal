import { deskGetSchwabStreamerLimits } from "./desk/deskStreamerBudget.js";

export type StreamerSubTier = "desk_core" | "user_visible" | "background";
export type StreamerSubService =
  | "LEVELONE_EQUITIES"
  | "LEVELONE_OPTIONS"
  | "OPTIONS_BOOK";

export type StreamerSubHold = {
  holderId: string;
  tier: StreamerSubTier;
  service: StreamerSubService;
  keys: string[];
  lastTouchMs: number;
};

export const STREAMER_L1_OPTIONS_CAP = 3_000;
export const STREAMER_OPTIONS_BOOK_CAP = 100;

const holds = new Map<string, StreamerSubHold>();
const rejections: Array<{ atMs: number; service: StreamerSubService; key: string; reason: string }> = [];

let deskCoreOptionKeys = new Set<string>();
let deskCoreBookKeys = new Set<string>();

let planGeneration = 0;
type L1PlanCache = {
  generation: number;
  subscribed: string[];
  subscribedSet: Set<string>;
  capped: boolean;
  deskCoreCount: number;
  userVisibleCount: number;
  backgroundCount: number;
};
let l1PlanCache: L1PlanCache | null = null;

type BookPlanCache = {
  generation: number;
  subscribed: string[];
};
let bookPlanCache: BookPlanCache | null = null;

function bumpPlan(): void {
  planGeneration += 1;
  l1PlanCache = null;
  bookPlanCache = null;
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

export function streamerSubTouch(holderId: string): void {
  const h = holds.get(holderId);
  if (!h) return;
  h.lastTouchMs = Date.now();
  bumpPlan();
}

export function streamerSubKeysForHolder(holderId: string): string[] {
  return holds.get(holderId)?.keys ?? [];
}

export async function streamerSubRelease(holderId: string): Promise<boolean> {
  if (!holds.has(holderId)) return false;
  holds.delete(holderId);
  bumpPlan();
  await streamerSubApplyManagedOptionsSubscriptions();
  return true;
}

export function streamerSubKeysExclusiveToHolder(holderId: string): string[] {
  const h = holds.get(holderId);
  if (!h) return [];
  const others = new Set<string>();
  for (const [id, hold] of holds) {
    if (id === holderId || hold.service !== h.service) continue;
    for (const k of hold.keys) others.add(k);
  }
  if (h.service === "LEVELONE_OPTIONS") {
    return h.keys.filter((k) => !others.has(k) && !deskCoreOptionKeys.has(k));
  }
  return h.keys.filter((k) => !others.has(k) && !deskCoreBookKeys.has(k));
}

export function streamerSubRecordRejection(
  service: StreamerSubService,
  key: string,
  reason: string,
): void {
  rejections.push({ atMs: Date.now(), service, key, reason });
  if (rejections.length > 40) rejections.shift();
}

function tierForKey(
  key: string,
  userHolds: StreamerSubHold[],
  bgHolds: StreamerSubHold[],
): StreamerSubTier | null {
  for (const h of userHolds) {
    if (h.keys.includes(key)) return "user_visible";
  }
  for (const h of bgHolds) {
    if (h.keys.includes(key)) return "background";
  }
  return null;
}

function buildL1Plan(): L1PlanCache {
  const desk = deskCoreOptionKeys;
  const ordered: string[] = [];
  const inPlan = new Set<string>();
  for (const k of desk) {
    inPlan.add(k);
    ordered.push(k);
  }

  const userHolds = [...holds.values()]
    .filter((h) => h.service === "LEVELONE_OPTIONS" && h.tier === "user_visible")
    .sort((a, b) => b.lastTouchMs - a.lastTouchMs);
  let userVisibleCount = 0;
  for (const h of userHolds) {
    for (const k of h.keys) {
      if (desk.has(k) || inPlan.has(k)) continue;
      inPlan.add(k);
      ordered.push(k);
      userVisibleCount += 1;
    }
  }

  const bgHolds = [...holds.values()]
    .filter((h) => h.service === "LEVELONE_OPTIONS" && h.tier === "background")
    .sort((a, b) => a.lastTouchMs - b.lastTouchMs);
  let backgroundCount = 0;
  for (const h of bgHolds) {
    for (const k of h.keys) {
      if (desk.has(k) || inPlan.has(k)) continue;
      inPlan.add(k);
      ordered.push(k);
      backgroundCount += 1;
    }
  }

  if (ordered.length > STREAMER_L1_OPTIONS_CAP) {
    const lruDropOrder: string[] = [];
    const seenDrop = new Set<string>();
    for (const h of bgHolds) {
      for (const k of h.keys) {
        if (desk.has(k) || seenDrop.has(k) || !inPlan.has(k)) continue;
        seenDrop.add(k);
        lruDropOrder.push(k);
      }
    }
    for (const h of [...userHolds].reverse()) {
      for (const k of h.keys) {
        if (desk.has(k) || seenDrop.has(k) || !inPlan.has(k)) continue;
        seenDrop.add(k);
        lruDropOrder.push(k);
      }
    }
    const drop = new Set(lruDropOrder.slice(0, ordered.length - STREAMER_L1_OPTIONS_CAP));
    const trimmed = ordered.filter((k) => !drop.has(k));
    ordered.length = 0;
    ordered.push(...trimmed);
    for (const k of drop) inPlan.delete(k);
    backgroundCount = 0;
    userVisibleCount = 0;
    for (const k of ordered) {
      if (desk.has(k)) continue;
      if (tierForKey(k, userHolds, bgHolds) === "user_visible") userVisibleCount += 1;
      else if (tierForKey(k, userHolds, bgHolds) === "background") backgroundCount += 1;
    }
  }

  return {
    generation: planGeneration,
    subscribed: ordered,
    subscribedSet: new Set(ordered),
    capped: ordered.length >= STREAMER_L1_OPTIONS_CAP,
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
  const ordered: string[] = [...deskCoreBookKeys];
  const seen = new Set(ordered);
  for (const h of holds.values()) {
    if (h.service !== "OPTIONS_BOOK") continue;
    for (const k of h.keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      ordered.push(k);
    }
  }
  return {
    generation: planGeneration,
    subscribed: ordered.slice(0, STREAMER_OPTIONS_BOOK_CAP),
  };
}

function getBookPlanCache(): BookPlanCache {
  if (bookPlanCache?.generation === planGeneration) return bookPlanCache;
  bookPlanCache = buildBookPlan();
  return bookPlanCache;
}

export function streamerSubPlanLevelOneOptions(): {
  subscribed: string[];
  capped: boolean;
  budget: number;
  deskCoreCount: number;
} {
  const c = getL1PlanCache();
  return {
    subscribed: c.subscribed,
    capped: c.capped,
    budget: STREAMER_L1_OPTIONS_CAP,
    deskCoreCount: c.deskCoreCount,
  };
}

export function streamerSubPlanOptionsBook(): { subscribed: string[]; budget: number } {
  const c = getBookPlanCache();
  return { subscribed: c.subscribed, budget: STREAMER_OPTIONS_BOOK_CAP };
}

/** Max desk-owned L1 option keys before user/background holds consume the cap. */
export function streamerSubMaxDeskOptionKeys(): number {
  const heldNonDesk = new Set<string>();
  for (const h of holds.values()) {
    if (h.service !== "LEVELONE_OPTIONS" || h.tier === "desk_core") continue;
    for (const k of h.keys) {
      if (!deskCoreOptionKeys.has(k)) heldNonDesk.add(k);
    }
  }
  return Math.max(0, STREAMER_L1_OPTIONS_CAP - heldNonDesk.size);
}

export function streamerSubMaxDeskBookKeys(): number {
  const held = new Set<string>();
  for (const h of holds.values()) {
    if (h.service !== "OPTIONS_BOOK") continue;
    for (const k of h.keys) if (!deskCoreBookKeys.has(k)) held.add(k);
  }
  return Math.max(0, STREAMER_OPTIONS_BOOK_CAP - held.size);
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
      planned: l1.subscribed.length,
      capped: l1.capped,
    },
    options_book: {
      cap: STREAMER_OPTIONS_BOOK_CAP,
      desk_core: deskCoreBookKeys.size,
      planned: book.subscribed.length,
    },
    streamer_add_rejections: rejections.slice(-20),
  };
}

export async function streamerSubApplyManagedOptionsSubscriptions(): Promise<void> {
  const plan = getL1PlanCache().subscribed;
  const { replaceManagedLevelOneOptionSubscriptions } = await import("./schwabStreamer.js");
  replaceManagedLevelOneOptionSubscriptions(plan);
}

export function streamerSubResetForTests(): void {
  holds.clear();
  rejections.length = 0;
  deskCoreOptionKeys = new Set();
  deskCoreBookKeys = new Set();
  bumpPlan();
}

/** Test hook: seed many holds without apply. */
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

/** Perf tests: seed many holds with a single plan invalidation. */
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