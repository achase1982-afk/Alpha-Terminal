import {
  APP_L1_OPTIONS_MAX,
  deskAppLevelOneOptionsCap,
  deskAppOptionsBookCap,
  deskComputeDeskLevelOneOptionsBudget,
  deskComputeDeskOptionsBookBudget,
  deskGetSchwabStreamerLimits,
} from "./desk/deskStreamerBudget.js";
import {
  parseOccOptionStrike,
  sortChainKeysNearTheMoneyInterleaved,
  sortOptionKeysNearTheMoney,
} from "./streamerSubPlanSort.js";
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
export const STREAM_HOLDER_ID_MAX_LEN = 220;
export const STREAMER_WIRE_DEBOUNCE_MS = 400;
export const STREAMER_WIRE_DEBOUNCE_MAX_MS = 1_500;

const DEFAULT_HOLD_TTL_MS = 30 * 60_000;

const holds = new Map<string, StreamerSubHold>();
const rejections: Array<{ atMs: number; service: StreamerSubService; key: string; reason: string }> = [];

let deskCoreOptionKeys = new Set<string>();
let deskCoreBookKeys = new Set<string>();
let chainSortSpot: number | null = null;
let underlyingSpotResolver: ((root: string) => number | null) | null = null;
const chainUnderlyingPriceByRoot = new Map<string, number>();

export function streamerSubSetUnderlyingSpotResolver(
  fn: ((root: string) => number | null) | null,
): void {
  underlyingSpotResolver = fn;
}

function streamPurposeFromHolderId(holderId: string): string | null {
  if (!holderId.startsWith("stream:")) return null;
  const parts = holderId.split(":");
  return parts[2] ?? null;
}

export function streamerSubInferHoldTier(holderId: string): StreamerSubTier {
  if (holderId.startsWith("ticket:")) return "user_visible";
  if (holderId.startsWith("chain:")) return "user_visible";
  if (holderId.startsWith("portfolio:positions:")) return "user_visible";
  if (holderId.startsWith("stream:")) {
    const purpose = streamPurposeFromHolderId(holderId);
    if (purpose === "chain" || purpose === "ticket") return "user_visible";
  }
  return "background";
}

function chainRootFromHolder(holderId: string): string | null {
  if (holderId.startsWith("chain:")) {
    const root = holderId.split(":")[1];
    return root ? root.toUpperCase() : null;
  }
  if (holderId.startsWith("stream:")) {
    const purpose = streamPurposeFromHolderId(holderId);
    if (purpose !== "chain") return null;
    const viewId = holderId.split(":").slice(3).join(":");
    const vp = viewId.split(":");
    if (vp[0] === "chain" && vp[1]) return vp[1].toUpperCase();
    if (vp[0]) return vp[0].replace(/^\$/, "").toUpperCase();
  }
  return null;
}

export function streamerSubSetChainUnderlyingPrice(root: string, price: number | null): void {
  const r = root.replace(/^\$/, "").toUpperCase();
  if (price != null && Number.isFinite(price)) chainUnderlyingPriceByRoot.set(r, price);
  else chainUnderlyingPriceByRoot.delete(r);
}

function medianStrikeFromKeys(keys: string[]): number | null {
  const strikes = keys.map(parseOccOptionStrike).filter((s): s is number => s != null && Number.isFinite(s));
  if (!strikes.length) return null;
  strikes.sort((a, b) => a - b);
  return strikes[Math.floor(strikes.length / 2)]!;
}

export function spotForChainHolder(holderId: string, keys: string[]): number | null {
  const root = chainRootFromHolder(holderId);
  if (root) {
    const cached = chainUnderlyingPriceByRoot.get(root);
    if (cached != null && Number.isFinite(cached)) return cached;
    if (underlyingSpotResolver) {
      const s = underlyingSpotResolver(root);
      if (s != null && Number.isFinite(s)) return s;
    }
    const med = medianStrikeFromKeys(keys);
    if (med != null) return med;
    if (root === "SPX" && chainSortSpot != null && Number.isFinite(chainSortSpot)) {
      return chainSortSpot;
    }
    return null;
  }
  if (chainSortSpot != null && Number.isFinite(chainSortSpot)) return chainSortSpot;
  return medianStrikeFromKeys(keys);
}

export function streamerSubSetChainSortSpot(spot: number | null): void {
  chainSortSpot = spot;
}

export function streamerSubGetChainSortSpot(): number | null {
  return chainSortSpot;
}

function holdPriority(holderId: string): number {
  if (holderId.startsWith("ticket:")) return 0;
  if (holderId.startsWith("stream:")) {
    const purpose = streamPurposeFromHolderId(holderId);
    if (purpose === "ticket") return 0;
    if (purpose === "chain") return 2;
  }
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
    streamerSubScheduleManagedOptionsWire();
    streamerSubScheduleManagedOptionsBookWire();
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
  streamerSubScheduleManagedOptionsWire();
  streamerSubScheduleManagedOptionsBookWire();
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
    streamerSubScheduleManagedOptionsWire();
    streamerSubScheduleManagedOptionsBookWire();
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

/** Canonical key for OCC matching (padded root or compact 6+6+CP+strike). */
export function normalizeStreamerOccKey(key: string): string {
  const trimmed = key.trim().toUpperCase();
  const compact = trimmed.replace(/\s+/g, "");
  const padded = trimmed.match(/^([A-Z.$]{1,6})\s+(\d{6})([CP])(\d{8,})$/);
  if (padded) {
    const root = padded[1]!.replace(/\./g, "").replace(/^\$/, "");
    return `${root}${padded[2]}${padded[3]}${padded[4]}`;
  }
  const tight = compact.match(/^([A-Z.$]{1,6})(\d{6})([CP])(\d+)$/);
  if (tight) {
    const root = tight[1]!.replace(/\./g, "").replace(/^\$/, "");
    const strike = tight[4]!.padStart(8, "0");
    return `${root}${tight[2]}${tight[3]}${strike}`;
  }
  return compact;
}

export type StreamerRejectionParse =
  | { kind: "symbol"; symbol: string }
  | { kind: "cap"; service: StreamerSubService; discarded: number }
  | { kind: "unknown" };

export function streamerSubParseRejection(msgText: string | undefined): StreamerRejectionParse {
  if (!msgText?.trim()) return { kind: "unknown" };
  const l1Cap = msgText.match(/LEVELONE_OPTIONS=(\d+)[^]*DISCARDED=(\d+)/i);
  if (l1Cap) {
    return {
      kind: "cap",
      service: "LEVELONE_OPTIONS",
      discarded: parseInt(l1Cap[2]!, 10) || 0,
    };
  }
  const bookCap = msgText.match(/OPTIONS_BOOK=(\d+)[^]*DISCARDED=(\d+)/i);
  if (bookCap) {
    return {
      kind: "cap",
      service: "OPTIONS_BOOK",
      discarded: parseInt(bookCap[2]!, 10) || 0,
    };
  }
  const occ = msgText.match(/\b([A-Z]{1,6}\s+\d{6}[CP]\d{8,})\b/);
  if (occ?.[1]) return { kind: "symbol", symbol: occ[1] };
  const keysMatch = msgText.match(/keys=([^,\s]+)/i);
  if (keysMatch?.[1]) return { kind: "symbol", symbol: keysMatch[1].split("|")[0] ?? keysMatch[1] };
  return { kind: "unknown" };
}

/** @deprecated use streamerSubParseRejection */
export function streamerSubParseRejectionKey(msgText: string | undefined): string {
  const p = streamerSubParseRejection(msgText);
  if (p.kind === "symbol") return p.symbol;
  return "unknown";
}

export function streamerSubResolveLiveKey(
  raw: string,
  liveKeys: Iterable<string>,
): string | null {
  const set = liveKeys instanceof Set ? liveKeys : new Set(liveKeys);
  if (set.has(raw)) return raw;
  const norm = normalizeStreamerOccKey(raw);
  for (const k of set) {
    if (normalizeStreamerOccKey(k) === norm) return k;
  }
  return null;
}

/** Droppable keys only, lowest priority first (never desk core or ticket). */
export function streamerSubLowestPriorityWireDropOrder(): string[] {
  const ticketKeys = new Set<string>();
  const ordered: string[] = [];

  for (const h of holds.values()) {
    if (h.service !== "LEVELONE_OPTIONS") continue;
    const isTicket =
      h.holderId.startsWith("ticket:") ||
      (h.holderId.startsWith("stream:") && streamPurposeFromHolderId(h.holderId) === "ticket");
    if (isTicket) {
      for (const k of h.keys) ticketKeys.add(k);
    }
  }

  for (const h of holds.values()) {
    if (h.service !== "LEVELONE_OPTIONS" || h.tier !== "background") continue;
    ordered.push(...h.keys);
  }

  for (const h of holds.values()) {
    if (h.service !== "LEVELONE_OPTIONS" || h.tier !== "user_visible") continue;
    const isTicket =
      h.holderId.startsWith("ticket:") ||
      (h.holderId.startsWith("stream:") && streamPurposeFromHolderId(h.holderId) === "ticket");
    if (isTicket) continue;
    const isChain =
      h.holderId.startsWith("chain:") ||
      (h.holderId.startsWith("stream:") && streamPurposeFromHolderId(h.holderId) === "chain");
    if (isChain) {
      const spot = spotForChainHolder(h.holderId, h.keys);
      const ntm = sortChainKeysNearTheMoneyInterleaved(h.keys, spot);
      const farthestFirst = [...ntm].reverse();
      ordered.push(...farthestFirst);
    } else {
      ordered.push(...h.keys);
    }
  }

  const seen = new Set<string>();
  const droppable: string[] = [];
  for (const k of ordered) {
    if (deskCoreOptionKeys.has(k) || ticketKeys.has(k) || seen.has(k)) continue;
    seen.add(k);
    droppable.push(k);
  }
  return droppable;
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
    const isChain =
      h.holderId.startsWith("chain:") ||
      (h.holderId.startsWith("stream:") && streamPurposeFromHolderId(h.holderId) === "chain");
    const spot = spotForChainHolder(h.holderId, h.keys);
    const keys = isChain
      ? sortChainKeysNearTheMoneyInterleaved(h.keys, spot)
      : h.holderId.startsWith("ticket:") ||
          (h.holderId.startsWith("stream:") && streamPurposeFromHolderId(h.holderId) === "ticket")
        ? h.keys
        : sortOptionKeysNearTheMoney(h.keys, spot);
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
  const deskBudget = deskComputeDeskLevelOneOptionsBudget(l1.appSubscribed.length);
  const plannedDesk = Math.min(l1.deskCoreCount, deskBudget);
  const bookDeskBudget = deskComputeDeskOptionsBookBudget(book.appSubscribed.length);
  const plannedBookDesk = Math.min(deskCoreBookKeys.size, bookDeskBudget);
  return {
    limits,
    levelone_options: {
      cap: STREAMER_L1_OPTIONS_CAP,
      desk_core: plannedDesk,
      desk_core_full: l1.deskCoreCount,
      user_visible: l1.userVisibleCount,
      background: l1.backgroundCount,
      managed_holds: holds.size,
      planned_app: l1.appSubscribed.length,
      live_app: streamerWireSimulatorLiveAppLevelOneCount(),
      live_desk: streamerWireSimulatorLiveDeskLevelOneCount(),
      live_total: streamerWireSimulatorLiveLevelOneOptionsCount(),
      planned: Math.min(STREAMER_L1_OPTIONS_CAP, plannedDesk + l1.appSubscribed.length),
      capped: l1.capped,
      wire_degraded: rejections.some((r) => r.reason === "cap_discard"),
    },
    options_book: {
      cap: STREAMER_OPTIONS_BOOK_CAP,
      desk_core: plannedBookDesk,
      planned_app: book.appSubscribed.length,
      planned: Math.min(STREAMER_OPTIONS_BOOK_CAP, plannedBookDesk + book.appSubscribed.length),
    },
    streamer_add_rejections: rejections.slice(-20),
  };
}

let wireL1Debounce: ReturnType<typeof setTimeout> | null = null;
let wireL1MaxWait: ReturnType<typeof setTimeout> | null = null;
let wireBookDebounce: ReturnType<typeof setTimeout> | null = null;
let wireBookMaxWait: ReturnType<typeof setTimeout> | null = null;

function clearWireL1Timers(): void {
  if (wireL1Debounce) clearTimeout(wireL1Debounce);
  if (wireL1MaxWait) clearTimeout(wireL1MaxWait);
  wireL1Debounce = null;
  wireL1MaxWait = null;
}

function clearWireBookTimers(): void {
  if (wireBookDebounce) clearTimeout(wireBookDebounce);
  if (wireBookMaxWait) clearTimeout(wireBookMaxWait);
  wireBookDebounce = null;
  wireBookMaxWait = null;
}

export async function streamerSubFlushWireForTests(): Promise<void> {
  clearWireL1Timers();
  clearWireBookTimers();
  await streamerSubApplyManagedOptionsSubscriptionsNow();
  await streamerSubApplyManagedOptionsBookSubscriptionsNow();
}

export function streamerSubScheduleManagedOptionsWire(): void {
  if (!wireL1MaxWait) {
    wireL1MaxWait = setTimeout(() => {
      wireL1MaxWait = null;
      if (wireL1Debounce) clearTimeout(wireL1Debounce);
      wireL1Debounce = null;
      void streamerSubApplyManagedOptionsSubscriptionsNow();
    }, STREAMER_WIRE_DEBOUNCE_MAX_MS);
    wireL1MaxWait.unref?.();
  }
  if (wireL1Debounce) clearTimeout(wireL1Debounce);
  wireL1Debounce = setTimeout(() => {
    wireL1Debounce = null;
    if (wireL1MaxWait) clearTimeout(wireL1MaxWait);
    wireL1MaxWait = null;
    void streamerSubApplyManagedOptionsSubscriptionsNow();
  }, STREAMER_WIRE_DEBOUNCE_MS);
  wireL1Debounce.unref?.();
}

export function streamerSubScheduleManagedOptionsBookWire(): void {
  if (!wireBookMaxWait) {
    wireBookMaxWait = setTimeout(() => {
      wireBookMaxWait = null;
      if (wireBookDebounce) clearTimeout(wireBookDebounce);
      wireBookDebounce = null;
      void streamerSubApplyManagedOptionsBookSubscriptionsNow();
    }, STREAMER_WIRE_DEBOUNCE_MAX_MS);
    wireBookMaxWait.unref?.();
  }
  if (wireBookDebounce) clearTimeout(wireBookDebounce);
  wireBookDebounce = setTimeout(() => {
    wireBookDebounce = null;
    if (wireBookMaxWait) clearTimeout(wireBookMaxWait);
    wireBookMaxWait = null;
    void streamerSubApplyManagedOptionsBookSubscriptionsNow();
  }, STREAMER_WIRE_DEBOUNCE_MS);
  wireBookDebounce.unref?.();
}

export async function streamerSubApplyManagedOptionsSubscriptions(): Promise<void> {
  streamerSubScheduleManagedOptionsWire();
}

/** @deprecated use streamerSubApplyManagedOptionsSubscriptions */
export const streamerSubApplyManagedSubscriptions = streamerSubApplyManagedOptionsSubscriptions;

export async function streamerSubApplyManagedOptionsSubscriptionsNow(): Promise<void> {
  const appPlan = getL1PlanCache().appSubscribed;
  const { replaceManagedLevelOneOptionSubscriptions } = await import("./schwabStreamer.js");
  replaceManagedLevelOneOptionSubscriptions(appPlan);
}

export async function streamerSubApplyManagedOptionsBookSubscriptions(): Promise<void> {
  streamerSubScheduleManagedOptionsBookWire();
}

export async function streamerSubApplyManagedOptionsBookSubscriptionsNow(): Promise<void> {
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
  clearWireL1Timers();
  clearWireBookTimers();
  chainUnderlyingPriceByRoot.clear();
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
