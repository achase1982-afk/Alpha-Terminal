import { deskEnvTruthyDefault } from "./deskEnv.js";
import { deskFetchSchwabChain, type DeskChainNormalized } from "./deskSchwabChains.js";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";
import { deskResolveSpxSpot } from "./deskSpxSpot.js";
import {
  deskStreamerAddEquity,
  deskStreamerAddOptions,
  deskStreamerAddOptionsBook,
  deskStreamerReplayDeskAdds,
  getDeskStreamerAddCounts,
} from "../schwabStreamer.js";

const DESK_EQUITIES = ["$SPX", "SPY", "$VIX"] as const;
const STRIKES_PER_SIDE_TARGET = 1000;
const MAX_LEVELONE_OPTION_KEYS = 2000;
const TARGET_OPTIONS_BOOK = 500;
const SPOT_REFRESH_PCT = 0.003;
const SPOT_REFRESH_POINTS = 5;
const REFRESH_POLL_MS = 45_000;
const SPOT_RETRY_MS = 10_000;

let lastSpot: number | null = null;
let lastExpiry: string | null = null;
let lastRefreshMs = 0;
let refreshInFlight: Promise<void> | null = null;
let cappedLevelone = false;
let cappedBook = false;
let leveloneCapReason: string | null = null;
let lastError: string | undefined;
let universeEnabled = false;

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
  last_expiry: string | null;
  last_refresh_ms: number | null;
  error?: string;
} {
  const counts = getDeskStreamerAddCounts();
  return {
    enabled: universeEnabled,
    levelone_equities: counts.levelone_equities,
    levelone_options: counts.levelone_options,
    options_book: counts.options_book,
    capped_levelone: cappedLevelone,
    capped_book: cappedBook,
    levelone_cap_reason: leveloneCapReason,
    last_spot: lastSpot,
    last_expiry: lastExpiry,
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

function pickLeveloneAroundSpot(
  contracts: DeskChainNormalized[],
  spot: number,
  chainContractCount: number,
): { keys: string[]; capReason: string | null; capped: boolean } {
  const byStrike = new Map<number, DeskChainNormalized[]>();
  for (const c of contracts) {
    const bucket = byStrike.get(c.strike) ?? [];
    bucket.push(c);
    byStrike.set(c.strike, bucket);
  }

  const strikes = [...byStrike.keys()].sort(
    (a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b,
  );

  const keys: string[] = [];
  let strikeSlots = 0;
  for (const strike of strikes) {
    for (const c of byStrike.get(strike) ?? []) {
      if (c.symbol) keys.push(c.symbol);
      if (keys.length >= MAX_LEVELONE_OPTION_KEYS) break;
    }
    strikeSlots += 1;
    if (keys.length >= MAX_LEVELONE_OPTION_KEYS) break;
    if (strikeSlots >= STRIKES_PER_SIDE_TARGET) break;
  }

  let capReason: string | null = null;
  let capped = false;
  if (chainContractCount <= MAX_LEVELONE_OPTION_KEYS) {
    capReason = `schwab_0dte_chain_${chainContractCount}_contracts`;
    capped = keys.length < MAX_LEVELONE_OPTION_KEYS;
  } else if (keys.length >= MAX_LEVELONE_OPTION_KEYS) {
    capReason = "desk_cap_2000_option_keys";
    capped = true;
  } else if (strikeSlots >= STRIKES_PER_SIDE_TARGET) {
    capReason = `desk_cap_${STRIKES_PER_SIDE_TARGET}_strikes_per_side`;
    capped = true;
  }

  return { keys, capReason, capped };
}

function spotMovedEnough(prev: number | null, next: number): boolean {
  if (prev == null || !Number.isFinite(prev)) return true;
  if (Math.abs(next - prev) >= SPOT_REFRESH_POINTS) return true;
  const denom = Math.max(Math.abs(prev), 1);
  return Math.abs(next - prev) / denom >= SPOT_REFRESH_PCT;
}

async function buildUniverseKeys(
  expiry: string,
  spot: number,
): Promise<{ levelone: string[]; book: string[] }> {
  const chain = await deskFetchSchwabChain("SPX", expiry);
  const picked = pickLeveloneAroundSpot(chain.normalized, spot, chain.contract_count);
  leveloneCapReason = picked.capReason;
  cappedLevelone = picked.capped;
  const levelone = picked.keys;
  const book = pickBySpot(chain.normalized, spot, TARGET_OPTIONS_BOOK);
  cappedBook =
    chain.normalized.length > book.length || chain.contract_count > TARGET_OPTIONS_BOOK;
  return { levelone, book };
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
      const expiry = deskSessionDateEt();
      deskStreamerAddEquity([...DESK_EQUITIES]);

      const spot = (await deskResolveSpxSpot()) ?? lastSpot;
      if (spot == null || !Number.isFinite(spot)) {
        lastError = "no_spx_spot";
        return;
      }

      const expiryChanged = lastExpiry != null && lastExpiry !== expiry;
      const spotMoved = spotMovedEnough(lastSpot, spot);
      const counts = getDeskStreamerAddCounts();
      const needsOptions = counts.levelone_options === 0;
      if (!force && !expiryChanged && !spotMoved && !needsOptions && lastRefreshMs > 0) return;
      const { levelone, book } = await buildUniverseKeys(expiry, spot);
      deskStreamerAddOptions(levelone);
      deskStreamerAddOptionsBook(book);

      lastSpot = spot;
      lastExpiry = expiry;
      lastRefreshMs = Date.now();
      lastError = undefined;
      logger.info(
        {
          spot,
          expiry,
          levelone: levelone.length,
          book: book.length,
          cappedLevelone,
          cappedBook,
          leveloneCapReason,
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

export function deskTapeUniverseOnStreamerLogin(): void {
  if (!deskTapeUniverseEnabled()) return;
  deskStreamerReplayDeskAdds();
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