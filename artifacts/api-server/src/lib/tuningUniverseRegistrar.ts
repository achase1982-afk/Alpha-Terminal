/**
 * Single registration point for the tuning-universe symbol list used by live
 * refresh and widened LC130 backfill paths. Symbols are read only from
 * `tuningUniverse.ts` (no duplicated hardcoding).
 */
import { TUNING_SYMBOLS, TUNING_UNIVERSE } from "../data/tuningUniverse.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "tuningUniverseRegistrar" });

let cached: readonly string[] | null = null;

let cachedNyseTuning: readonly string[] | null = null;

/** Idempotent. Logs once on first call. */
export function registerTuningUniverseOnBoot(): void {
  if (cached) return;
  cached = Object.freeze(TUNING_SYMBOLS.map((s) => s.toUpperCase()));
  cachedNyseTuning = Object.freeze(
    TUNING_UNIVERSE.filter((e) => e.primaryListing === "NYSE").map((e) => e.symbol.toUpperCase()),
  );
  log.info({ symbolCount: cached.length }, "ENTER tuning_registrar");
}

export function getNyseListedTuningSymbols(): readonly string[] {
  if (!cached) registerTuningUniverseOnBoot();
  return cachedNyseTuning!;
}

export function getTuningUniverseSymbols(): readonly string[] {
  if (!cached) {
    registerTuningUniverseOnBoot();
  }
  return cached!;
}
