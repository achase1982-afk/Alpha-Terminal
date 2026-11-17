import {
  deskComputeDeskLevelOneOptionsBudget,
  deskComputeDeskOptionsBookBudget,
  deskGetSchwabStreamerLimits,
} from "./desk/deskStreamerBudget.js";
import { getAppLevelOneOptionsCount, getAppOptionsBookCount, removeOptionSymbols } from "./schwabStreamer.js";

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

const holds = new Map<string, StreamerSubHold>();
const evictionLog: Array<{ atMs: number; service: StreamerSubService; key: string; reason: string }> = [];
const rejections: Array<{ atMs: number; service: StreamerSubService; key: string; reason: string }> = [];

const TIER_RANK: Record<StreamerSubTier, number> = {
  desk_core: 0,
  user_visible: 1,
  background: 2,
};

/** Desk-held keys (managed by tape universe); included in tier desk_core. */
let deskCoreOptionKeys = new Set<string>();
let deskCoreBookKeys = new Set<string>();

export function streamerSubSetDeskCore(service: StreamerSubService, keys: Iterable<string>): void {
  const s = new Set(keys);
  if (service === "LEVELONE_OPTIONS") deskCoreOptionKeys = s;
  else if (service === "OPTIONS_BOOK") deskCoreBookKeys = s;
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
}

export function streamerSubRelease(holderId: string): boolean {
  if (!holds.has(holderId)) return false;
  const orphan = streamerSubKeysExclusiveToHolder(holderId);
  holds.delete(holderId);
  if (orphan.length > 0) removeOptionSymbols(orphan);
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
  return h.keys.filter((k) => !others.has(k));
}

export function streamerSubRecordRejection(
  service: StreamerSubService,
  key: string,
  reason: string,
): void {
  rejections.push({ atMs: Date.now(), service, key, reason });
  if (rejections.length > 40) rejections.shift();
}

function keysForService(service: StreamerSubService): Map<string, StreamerSubTier> {
  const out = new Map<string, StreamerSubTier>();
  if (service === "LEVELONE_OPTIONS") {
    for (const k of deskCoreOptionKeys) out.set(k, "desk_core");
  } else if (service === "OPTIONS_BOOK") {
    for (const k of deskCoreBookKeys) out.set(k, "desk_core");
  }
  const tierHolds = [...holds.values()]
    .filter((h) => h.service === service)
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.lastTouchMs - a.lastTouchMs);
  for (const h of tierHolds) {
    for (const k of h.keys) {
      const prev = out.get(k);
      if (!prev || TIER_RANK[h.tier] < TIER_RANK[prev]) out.set(k, h.tier);
    }
  }
  return out;
}

export function streamerSubPlanLevelOneOptions(now = Date.now()): {
  subscribed: string[];
  evicted: string[];
  capped: boolean;
  budget: number;
} {
  const budget = deskComputeDeskLevelOneOptionsBudget(getAppLevelOneOptionsCount());
  const merged = keysForService("LEVELONE_OPTIONS");
  const desk = [...deskCoreOptionKeys];
  const appHeld = new Set<string>();
  for (const [k, tier] of merged) {
    if (tier !== "desk_core") appHeld.add(k);
  }
  const ordered: string[] = [...desk];
  const byTier: Array<{ tier: StreamerSubTier; keys: string[] }> = [
    { tier: "user_visible", keys: [] },
    { tier: "background", keys: [] },
  ];
  for (const h of holds.values()) {
    if (h.service !== "LEVELONE_OPTIONS") continue;
    const bucket = h.tier === "background" ? 1 : 0;
    if (h.tier === "user_visible" || h.tier === "background") {
      byTier[bucket].keys.push(...h.keys.filter((k) => !deskCoreOptionKeys.has(k)));
    }
  }
  const lruBg = [...holds.values()]
    .filter((h) => h.service === "LEVELONE_OPTIONS" && h.tier === "background")
    .sort((a, b) => a.lastTouchMs - b.lastTouchMs);
  const lruUser = [...holds.values()]
    .filter((h) => h.service === "LEVELONE_OPTIONS" && h.tier === "user_visible")
    .sort((a, b) => a.lastTouchMs - b.lastTouchMs);

  for (const h of lruUser) {
    for (const k of h.keys) {
      if (!ordered.includes(k) && !deskCoreOptionKeys.has(k)) ordered.push(k);
    }
  }
  for (const h of lruBg) {
    for (const k of h.keys) {
      if (!ordered.includes(k) && !deskCoreOptionKeys.has(k)) ordered.push(k);
    }
  }

  const evicted: string[] = [];
  if (ordered.length > budget) {
    while (ordered.length > budget) {
      const dropFromBg = lruBg.find((h) => h.keys.some((k) => ordered.includes(k) && !deskCoreOptionKeys.has(k)));
      let dropped: string | undefined;
      if (dropFromBg) {
        dropped = dropFromBg.keys.find((k) => ordered.includes(k) && !deskCoreOptionKeys.has(k));
      }
      if (!dropped) {
        const dropFromUser = lruUser.find((h) => h.keys.some((k) => ordered.includes(k) && !deskCoreOptionKeys.has(k)));
        dropped = dropFromUser?.keys.find((k) => ordered.includes(k) && !deskCoreOptionKeys.has(k));
      }
      if (!dropped) break;
      const idx = ordered.indexOf(dropped);
      if (idx >= 0) ordered.splice(idx, 1);
      evicted.push(dropped);
      evictionLog.push({ atMs: now, service: "LEVELONE_OPTIONS", key: dropped, reason: "lru_cap" });
    }
  }
  if (evictionLog.length > 80) evictionLog.splice(0, evictionLog.length - 80);

  return { subscribed: ordered, evicted, capped: ordered.length >= budget, budget };
}

export function streamerSubPlanOptionsBook(): {
  subscribed: string[];
  budget: number;
} {
  const budget = deskComputeDeskOptionsBookBudget(getAppOptionsBookCount());
  const ordered = [...deskCoreBookKeys];
  for (const h of holds.values()) {
    if (h.service !== "OPTIONS_BOOK") continue;
    for (const k of h.keys) {
      if (!ordered.includes(k)) ordered.push(k);
    }
  }
  const subscribed = ordered.slice(0, budget);
  return { subscribed, budget };
}

export function getStreamerSubscriptionHealth(now = Date.now()) {
  const limits = deskGetSchwabStreamerLimits();
  const l1Plan = streamerSubPlanLevelOneOptions(now);
  const bookPlan = streamerSubPlanOptionsBook();
  return {
    limits,
    levelone_options: {
      desk_core: deskCoreOptionKeys.size,
      app_subs: getAppLevelOneOptionsCount(),
      managed_holds: holds.size,
      budget: l1Plan.budget,
      planned: l1Plan.subscribed.length,
      capped: l1Plan.capped,
      recent_evictions: evictionLog.filter((e) => e.service === "LEVELONE_OPTIONS").slice(-10),
    },
    options_book: {
      desk_core: deskCoreBookKeys.size,
      app_subs: getAppOptionsBookCount(),
      budget: bookPlan.budget,
      planned: bookPlan.subscribed.length,
    },
    streamer_add_rejections: rejections.slice(-20),
  };
}

export function streamerSubResetForTests(): void {
  holds.clear();
  evictionLog.length = 0;
  rejections.length = 0;
  deskCoreOptionKeys = new Set();
  deskCoreBookKeys = new Set();
}
