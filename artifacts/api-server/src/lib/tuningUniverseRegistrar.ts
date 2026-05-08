/**
 * Single registration point for the tuning-universe symbol list used by live
 * refresh and widened LC130 backfill paths. Symbols are read only from
 * `tuningUniverse.ts` (no duplicated hardcoding).
 */
import { TUNING_SYMBOLS, TUNING_UNIVERSE } from "../data/tuningUniverse.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";
import {
  addSymbols as schwabAddLevelOneEquities,
  addTimesaleEquitySymbols,
  addNyseBookSymbols,
  addNasdaqBookSymbols,
} from "./schwabStreamer.js";
import { isIBConnected, onIBConnected } from "./ibStreamer.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "tuningUniverseRegistrar" });

let cached: readonly string[] | null = null;
let cachedNyseTuning: readonly string[] | null = null;
let cachedNasdaqTuning: readonly string[] | null = null;

let aggregateHookInstalled = false;
let aggregateLogged = false;
let pendingSchwabCounts: SchwabTuningPersistentCounts | null = null;

/** Idempotent. Logs once on first call. */
export function registerTuningUniverseOnBoot(): void {
  if (cached) return;
  cached = Object.freeze(TUNING_SYMBOLS.map((s) => s.toUpperCase()));
  cachedNyseTuning = Object.freeze(
    TUNING_UNIVERSE.filter((e) => e.primaryListing === "NYSE").map((e) => e.symbol),
  );
  cachedNasdaqTuning = Object.freeze(
    TUNING_UNIVERSE.filter((e) => e.primaryListing === "NASDAQ").map((e) => e.symbol),
  );
  log.info({ symbolCount: cached.length }, "ENTER tuning_registrar");
}

export function getTuningUniverseSymbols(): readonly string[] {
  if (!cached) {
    registerTuningUniverseOnBoot();
  }
  return cached!;
}

export function getNyseListedTuningSymbols(): readonly string[] {
  if (!cached) registerTuningUniverseOnBoot();
  return cachedNyseTuning!;
}

export function getNasdaqListedTuningSymbols(): readonly string[] {
  if (!cached) registerTuningUniverseOnBoot();
  return cachedNasdaqTuning!;
}

export interface SchwabTuningPersistentCounts {
  schwab_levelone_equities: number;
  schwab_timesale_equity: number;
  schwab_nyse_book: number;
  schwab_nasdaq_book: number;
}

function tuningNyseBeyondLcForImbalance(): number {
  const lcNyse = new Set(LIQUID_CORE_SYMBOLS.filter((e) => e.primaryListing === "NYSE").map((e) => e.symbol));
  let n = 0;
  for (const e of TUNING_UNIVERSE) {
    if (e.primaryListing === "NYSE" && !lcNyse.has(e.symbol)) n++;
  }
  return n;
}

function flushTuningUniverseAggregateLog(): void {
  if (aggregateLogged || !pendingSchwabCounts) return;
  if (!isIBConnected()) return;
  aggregateLogged = true;
  log.info(
    {
      event: "ENTER",
      tuning_universe_registered: {
        ...pendingSchwabCounts,
        ibkr_imbalance_added: tuningNyseBeyondLcForImbalance(),
        ibkr_l1_equity: getTuningUniverseSymbols().length,
      },
    },
    "tuning universe persistent streams registered (aggregate)",
  );
}

/**
 * Persistent Schwab subscriptions for the tuning universe (LEVELONE_EQUITY overlap,
 * TIMESALE_EQUITY, venue-split books). Full SUBS replacement follows existing streamer behavior.
 * IBKR aggregate log fires once Schwab counts are known and the gateway is connected.
 */
export function registerPersistentSchwabTuningStreaming(): SchwabTuningPersistentCounts {
  const levelOne = [...getTuningUniverseSymbols()];
  const ts = [...getTuningUniverseSymbols()];
  const nyse = [...getNyseListedTuningSymbols()];
  const nasdaq = [...getNasdaqListedTuningSymbols()];

  schwabAddLevelOneEquities(levelOne);
  log.info(
    {
      event: "ENTER",
      phase: "tuning_streamer_registration",
      service: "LEVELONE_EQUITIES",
      symbol_count: levelOne.length,
      symbols: levelOne,
    },
    "Schwab streamer: tuning persistent subscriptions",
  );

  addTimesaleEquitySymbols(ts);
  log.info(
    {
      event: "ENTER",
      phase: "tuning_streamer_registration",
      service: "TIMESALE_EQUITY",
      symbol_count: ts.length,
      symbols: ts,
    },
    "Schwab streamer: tuning persistent subscriptions",
  );

  addNyseBookSymbols(nyse);
  log.info(
    {
      event: "ENTER",
      phase: "tuning_streamer_registration",
      service: "NYSE_BOOK",
      symbol_count: nyse.length,
      symbols: nyse,
    },
    "Schwab streamer: tuning persistent subscriptions",
  );

  addNasdaqBookSymbols(nasdaq);
  log.info(
    {
      event: "ENTER",
      phase: "tuning_streamer_registration",
      service: "NASDAQ_BOOK",
      symbol_count: nasdaq.length,
      symbols: nasdaq,
    },
    "Schwab streamer: tuning persistent subscriptions",
  );

  const counts: SchwabTuningPersistentCounts = {
    schwab_levelone_equities: levelOne.length,
    schwab_timesale_equity: ts.length,
    schwab_nyse_book: nyse.length,
    schwab_nasdaq_book: nasdaq.length,
  };

  pendingSchwabCounts = counts;

  if (!aggregateHookInstalled) {
    aggregateHookInstalled = true;
    onIBConnected(flushTuningUniverseAggregateLog);
  }
  flushTuningUniverseAggregateLog();

  return counts;
}
