import { deskEnvTruthyDefault } from "./deskEnv.js";
import { deskFetchSchwabChain, type DeskChainNormalized } from "./deskSchwabChains.js";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";
import { deskResolveSpxSpot } from "./deskSpxSpot.js";
import {
  deskTapeOptionsExpiries,
  deskTapeOptionsMax,
  deskLoadExplicitOptionSymbols,
} from "./deskTapeOptionsConfig.js";
import {
  deskStreamerAddEquity,
  deskStreamerAddOptions,
  deskStreamerAddOptionsBook,
  deskStreamerReplayDeskAdds,
  getDeskStreamerAddCounts,
} from "../schwabStreamer.js";

const DESK_EQUITIES = ["$SPX", "SPY", "$VIX"] as const;
const TARGET_OPTIONS_BOOK = 500;
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
  last_refresh_ms: number | null;
  max_options: number;
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
    target_expiries: deskTapeOptionsExpiries(),
    options_by_expiry: { ...optionsByExpiry },
    streamer_add_rejections: [...streamerRejections],
    last_refresh_ms: lastRefreshMs > 0 ? lastRefreshMs : null,
    max_options: deskTapeOptionsMax(),
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
  cap: number,
): string[] {
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
  for (const strike of strikes) {
    for (const c of byStrike.get(strike) ?? []) {
      if (c.symbol) keys.push(c.symbol);
      if (keys.length >= cap) break;
    }
    if (keys.length >= cap) break;
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
  const maxKeys = deskTapeOptionsMax();
  const explicit = await deskLoadExplicitOptionSymbols().catch(() => [] as string[]);

  if (explicit.length > 0) {
    const levelone = explicit.slice(0, maxKeys);
    cappedLevelone = explicit.length > maxKeys;
    leveloneCapReason = cappedLevelone ? `desk_cap_${maxKeys}_explicit_symbols` : null;
    for (const exp of expiries) optionsByExpiry[exp] = 0;
    optionsByExpiry["explicit"] = levelone.length;
    const book = pickBySpot([], spot, TARGET_OPTIONS_BOOK);
    cappedBook = false;
    return { levelone, book };
  }

  const allContracts: DeskChainNormalized[] = [];
  Object.keys(optionsByExpiry).forEach((k) => delete optionsByExpiry[k]);

  for (const expiry of expiries) {
    const chain = await deskFetchSchwabChain("SPX", expiry);
    const count = chain.contract_count;
    optionsByExpiry[expiry] = count;
    for (const c of chain.normalized) {
      allContracts.push(c);
      if (allContracts.length >= maxKeys * 2) break;
    }
    if (allContracts.length >= maxKeys * 2) break;
  }

  const totalContracts = allContracts.length;
  const levelone = pickLeveloneAroundSpot(allContracts, spot, maxKeys);
  cappedLevelone = totalContracts > maxKeys || levelone.length >= maxKeys;
  leveloneCapReason = cappedLevelone
    ? totalContracts <= maxKeys
      ? `desk_cap_${maxKeys}_option_keys`
      : `multi_expiry_chain_${totalContracts}_contracts`
    : null;

  const bookSource = allContracts.length ? allContracts : [];
  const book = pickBySpot(bookSource, spot, TARGET_OPTIONS_BOOK);
  cappedBook = bookSource.length > book.length;

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
      const { levelone, book } = await buildUniverseKeys(expiries, spot);
      deskStreamerAddOptions(levelone);
      if (book.length) deskStreamerAddOptionsBook(book);

      lastSpot = spot;
      lastExpiryKey = expiryKey;
      lastRefreshMs = Date.now();
      lastError = undefined;
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