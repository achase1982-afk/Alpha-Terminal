import { deskEnvTruthyDefault } from "./deskEnv.js";
import { deskFetchSchwabChain, type DeskChainNormalized } from "./deskSchwabChains.js";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";
import { deskResolveSpxSpot } from "./deskSpxSpot.js";
import {
  deskTapeOptionsExpiries,
  deskLoadExplicitOptionSymbols,
} from "./deskTapeOptionsConfig.js";
import {
  deskStrikeWindowForExpiry,
  filterDeskChainByStrikeWindow,
  trimDeskOptionsToBudget,
  type DeskOptionPick,
} from "./deskTapeStrikeWindows.js";
import {
  deskComputeDeskLevelOneOptionsBudget,
  deskGetSchwabStreamerLimits,
  DESK_LEVELONE_OPTIONS_TARGET,
} from "./deskStreamerBudget.js";
import {
  streamerSubApplyManagedOptionsBookSubscriptions,
  streamerSubApplyManagedOptionsSubscriptions,
  streamerSubMaxDeskBookKeys,
  streamerSubMaxDeskOptionKeys,
  streamerSubDeskCoreBookKeysList,
  streamerSubDeskCoreOptionKeysList,
  streamerSubSetChainSortSpot,
  streamerSubSetDeskCore,
} from "../streamerSubscriptionManager.js";
import { trimKeysFurthestFromMoney } from "../streamerSubPlanSort.js";
import {
  getAppLevelOneOptionSymbols,
  getAppLevelOneOptionsCount,
  getAppOptionsBookCount,
  deskStreamerAddEquity,
  deskStreamerSetDeskOptions,
  deskStreamerSetDeskOptionsBook,
  deskStreamerUnsubRemovedDeskOptions,
  getDeskAddedLevelOneOptionSymbols,
  getDeskStreamerAddCounts,
} from "../schwabStreamer.js";
import {
  deskLiveFlowOnContractsDropped,
  deskLiveFlowOnContractsRebaseline,
} from "./deskLiveFlowEngine.js";

const DESK_EQUITIES = ["$SPX", "SPY", "$VIX"] as const;
const TARGET_OPTIONS_BOOK = 100;
const SPOT_REFRESH_PCT = 0.003;
const SPOT_REFRESH_POINTS = 5;
const REFRESH_POLL_MS = 45_000;
const SPOT_RETRY_MS = 10_000;

let lastSpot: number | null = null;
let lastExpiryKey: string | null = null;
let lastRefreshMs = 0;
let refreshInFlight: Promise<void> | null = null;
let cappedLevelone = false;
let cappedBook = false;
let leveloneCapReason: string | null = null;
let lastError: string | undefined;
let universeEnabled = false;
const optionsByExpiry: Record<string, number> = {};
const streamerRejections: string[] = [];
let deskFullTargetLevelOneKeys: string[] = [];
let deskFullTargetBookKeys: string[] = [];

export function deskTapeUniverseSetFullTargetsForTests(levelone: string[], book: string[]): void {
  deskFullTargetLevelOneKeys = [...levelone];
  deskFullTargetBookKeys = [...book];
}

export function deskTapeUniverseFullTargetLevelOneCount(): number {
  return deskFullTargetLevelOneKeys.length;
}

export function deskRecordStreamerRejection(text: string): void {
  streamerRejections.push(text);
  if (streamerRejections.length > 40) streamerRejections.shift();
}

export function deskTapeUniverseEnabled(): boolean {
  return deskEnvTruthyDefault(true, "DESK_TAPE_UNIVERSE_ENABLED", "TAPE_UNIVERSE_ENABLED");
}

export function getDeskTapeUniverseHealth(): {
  enabled: boolean;
  levelone_equities: number;
  levelone_options: number;
  options_book: number;
  capped_levelone: boolean;
  capped_book: boolean;
  levelone_cap_reason: string | null;
  last_spot: number | null;
  target_expiries: string[];
  options_by_expiry: Record<string, number>;
  streamer_add_rejections: string[];
  streamer_limits: ReturnType<typeof deskGetSchwabStreamerLimits>;
  app_levelone_options: number;
  desk_levelone_options_budget: number;
  app_option_symbols_sample: string[];
  last_refresh_ms: number | null;
  error?: string;
} {
  const counts = getDeskStreamerAddCounts();
  const appCount = getAppLevelOneOptionsCount();
  return {
    enabled: universeEnabled,
    levelone_equities: counts.levelone_equities,
    levelone_options: counts.levelone_options,
    options_book: counts.options_book,
    capped_levelone: cappedLevelone,
    capped_book: cappedBook,
    levelone_cap_reason: leveloneCapReason,
    last_spot: lastSpot,
    target_expiries: deskTapeOptionsExpiries(),
    options_by_expiry: { ...optionsByExpiry },
    streamer_add_rejections: [...streamerRejections],
    streamer_limits: deskGetSchwabStreamerLimits(),
    app_levelone_options: appCount,
    desk_levelone_options_budget: streamerSubMaxDeskOptionKeys(),
    app_option_symbols_sample: getAppLevelOneOptionSymbols().slice(0, 8),
    last_refresh_ms: lastRefreshMs > 0 ? lastRefreshMs : null,
    ...(lastError ? { error: lastError } : {}),
  };
}

function pickBySpot(contracts: DeskChainNormalized[], spot: number, limit: number): string[] {
  const sorted = [...contracts].sort(
    (a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot) || a.strike - b.strike,
  );
  const keys: string[] = [];
  for (const c of sorted) {
    if (!c.symbol) continue;
    keys.push(c.symbol);
    if (keys.length >= limit) break;
  }
  return keys;
}

function spotMovedEnough(prev: number | null, next: number): boolean {
  if (prev == null || !Number.isFinite(prev)) return true;
  if (Math.abs(next - prev) >= SPOT_REFRESH_POINTS) return true;
  const denom = Math.max(Math.abs(prev), 1);
  return Math.abs(next - prev) / denom >= SPOT_REFRESH_PCT;
}

async function buildUniverseKeys(
  expiries: string[],
  spot: number,
): Promise<{ levelone: string[]; book: string[] }> {
  const sessionToday = deskSessionDateEt();
  const explicit = await deskLoadExplicitOptionSymbols().catch(() => [] as string[]);

  if (explicit.length > 0) {
    const fullBudget = deskComputeDeskLevelOneOptionsBudget(0);
    deskFullTargetLevelOneKeys = explicit.slice(0, Math.min(DESK_LEVELONE_OPTIONS_TARGET, fullBudget));
    const budget = streamerSubMaxDeskOptionKeys();
    const levelone = trimKeysFurthestFromMoney(deskFullTargetLevelOneKeys, budget, spot);
    cappedLevelone = deskFullTargetLevelOneKeys.length > budget;
    leveloneCapReason = cappedLevelone ? `schwab_levelone_options_budget_${budget}` : null;
    for (const exp of expiries) optionsByExpiry[exp] = 0;
    optionsByExpiry.explicit = levelone.length;
    const bookBudget = streamerSubMaxDeskBookKeys();
    const book = pickBySpot([], spot, Math.max(0, bookBudget));
    cappedBook = false;
    return { levelone, book };
  }

  const picks: DeskOptionPick[] = [];
  Object.keys(optionsByExpiry).forEach((k) => delete optionsByExpiry[k]);

  for (const expiry of expiries) {
    const chain = await deskFetchSchwabChain("SPX", expiry);
    const window = deskStrikeWindowForExpiry(expiry, chain.normalized, sessionToday);
    const filtered = filterDeskChainByStrikeWindow(chain.normalized, window);
    for (const c of filtered) {
      if (!c.symbol) continue;
      picks.push({ expiry, symbol: c.symbol, strike: c.strike });
    }
  }

  const fullBudget = deskComputeDeskLevelOneOptionsBudget(0);
  const trimmedFull = trimDeskOptionsToBudget(picks, Math.min(DESK_LEVELONE_OPTIONS_TARGET, fullBudget), spot);
  deskFullTargetLevelOneKeys = [...trimmedFull.symbols];
  const budget = streamerSubMaxDeskOptionKeys();
  const leveloneForWire = trimKeysFurthestFromMoney(deskFullTargetLevelOneKeys, budget, spot);
  const trimmed = {
    symbols: leveloneForWire,
    perExpiry: trimmedFull.perExpiry,
    capReason: trimmedFull.symbols.length > budget ? `schwab_levelone_options_budget_${budget}` : trimmedFull.capReason,
  };
  Object.assign(optionsByExpiry, trimmed.perExpiry);
  cappedLevelone = trimmed.capReason != null;
  leveloneCapReason = trimmed.capReason;

  const allForBook: DeskChainNormalized[] = [];
  for (const expiry of expiries) {
    const chain = await deskFetchSchwabChain("SPX", expiry);
    const window = deskStrikeWindowForExpiry(expiry, chain.normalized, sessionToday);
    allForBook.push(...filterDeskChainByStrikeWindow(chain.normalized, window));
  }
  const bookBudget = streamerSubMaxDeskBookKeys();
  const bookLimit = Math.min(TARGET_OPTIONS_BOOK, Math.max(0, bookBudget));
  const book = pickBySpot(allForBook, spot, bookLimit);
  cappedBook = allForBook.length > book.length;

  deskFullTargetBookKeys = [...book];
  return { levelone: trimmed.symbols, book };
}

export async function deskTapeUniverseRefresh(force = false): Promise<void> {
  if (!deskTapeUniverseEnabled()) return;
  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }

  refreshInFlight = (async () => {
    lastError = undefined;
    try {
      const expiries = deskTapeOptionsExpiries();
      const expiryKey = expiries.join(",");
      deskStreamerAddEquity([...DESK_EQUITIES]);

      const spot = (await deskResolveSpxSpot()) ?? lastSpot;
      if (spot == null || !Number.isFinite(spot)) {
        lastError = "no_spx_spot";
        return;
      }

      const expiryChanged = lastExpiryKey != null && lastExpiryKey !== expiryKey;
      const spotMoved = spotMovedEnough(lastSpot, spot);
      const counts = getDeskStreamerAddCounts();
      const needsOptions = counts.levelone_options === 0;
      if (!force && !expiryChanged && !spotMoved && !needsOptions && lastRefreshMs > 0) return;
      streamerSubSetChainSortSpot(spot);
      const { levelone, book } = await buildUniverseKeys(expiries, spot);
      const prevDesk = new Set(getDeskAddedLevelOneOptionSymbols());
      const nextDesk = new Set(levelone);
      const deskRemoved = [...prevDesk].filter((k) => !nextDesk.has(k));
      const deskAdded = [...nextDesk].filter((k) => !prevDesk.has(k));
      if (deskRemoved.length > 0) {
        deskStreamerUnsubRemovedDeskOptions(deskRemoved);
        deskLiveFlowOnContractsDropped(deskRemoved);
      }
      if (deskAdded.length > 0) deskLiveFlowOnContractsRebaseline(deskAdded);
      streamerSubSetDeskCore("LEVELONE_OPTIONS", levelone);
      streamerSubSetDeskCore("OPTIONS_BOOK", book);
      await streamerSubApplyManagedOptionsSubscriptions();
      await streamerSubApplyManagedOptionsBookSubscriptions();
      deskStreamerSetDeskOptions(levelone);
      if (book.length) deskStreamerSetDeskOptionsBook(book);

      lastSpot = spot;
      lastExpiryKey = expiryKey;
      lastRefreshMs = Date.now();
      lastError = undefined;
      streamerRejections.length = 0;
      logger.info(
        {
          spot,
          expiries,
          levelone: levelone.length,
          book: book.length,
          cappedLevelone,
          cappedBook,
          leveloneCapReason,
          optionsByExpiry,
          appOptions: getAppLevelOneOptionsCount(),
          deskBudget: streamerSubMaxDeskOptionKeys(),
          deskBookBudget: streamerSubMaxDeskBookKeys(),
        },
        "Desk tape universe refreshed",
      );
    } catch (err) {
      lastError = "universe_refresh_error";
      logger.warn({ err }, "Desk tape universe refresh failed");
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  await refreshInFlight;
}

/** Re-derive desk from full target for current app budget (grow back when app shrinks). */
export async function deskTapeUniverseAdjustToAppPlan(): Promise<void> {
  if (!deskTapeUniverseEnabled()) return;
  const budget = streamerSubMaxDeskOptionKeys();
  const full =
    deskFullTargetLevelOneKeys.length > 0
      ? deskFullTargetLevelOneKeys
      : streamerSubDeskCoreOptionKeysList();
  const trimmed = trimKeysFurthestFromMoney(full, budget, lastSpot);
  streamerSubSetDeskCore("LEVELONE_OPTIONS", trimmed);
  const bookBudget = streamerSubMaxDeskBookKeys();
  const bookFull = deskFullTargetBookKeys.length ? deskFullTargetBookKeys : streamerSubDeskCoreBookKeysList();
  const bookTrim = bookFull.slice(0, bookBudget);
  streamerSubSetDeskCore("OPTIONS_BOOK", bookTrim);
  const prevDesk = new Set(getDeskAddedLevelOneOptionSymbols());
  const nextDesk = new Set(trimmed);
  const deskRemoved = [...prevDesk].filter((k) => !nextDesk.has(k));
  const deskAdded = [...nextDesk].filter((k) => !prevDesk.has(k));
  if (deskRemoved.length > 0) {
    deskStreamerUnsubRemovedDeskOptions(deskRemoved);
    deskLiveFlowOnContractsDropped(deskRemoved);
  }
  if (deskAdded.length > 0) deskLiveFlowOnContractsRebaseline(deskAdded);
  await streamerSubApplyManagedOptionsSubscriptions();
  await streamerSubApplyManagedOptionsBookSubscriptions();
  deskStreamerSetDeskOptions(trimmed);
  if (bookTrim.length) deskStreamerSetDeskOptionsBook(bookTrim);
}

export function deskTapeUniverseOnAppSubscriptionsChanged(): void {
  if (!deskTapeUniverseEnabled()) return;
  void deskTapeUniverseAdjustToAppPlan();
}

export function deskTapeUniverseOnStreamerLogin(): void {
  if (!deskTapeUniverseEnabled()) return;
  void deskTapeUniverseRefresh(true);
}

function maybeScheduleSpotRetry(): void {
  setTimeout(() => {
    if (!universeEnabled) return;
    const counts = getDeskStreamerAddCounts();
    if (lastError === "no_spx_spot" || counts.levelone_options === 0) {
      void deskTapeUniverseRefresh(true).finally(maybeScheduleSpotRetry);
    }
  }, SPOT_RETRY_MS);
}

export function startDeskTapeUniverse(): void {
  universeEnabled = deskTapeUniverseEnabled();
  if (!universeEnabled) {
    logger.info("Desk tape universe disabled (DESK_TAPE_UNIVERSE_ENABLED)");
    return;
  }
  void deskTapeUniverseRefresh(true);
  maybeScheduleSpotRetry();
  const timer = setInterval(() => {
    void deskTapeUniverseRefresh(false);
  }, REFRESH_POLL_MS);
  timer.unref?.();
}
