/**
 * Single registration point for the tuning-universe symbol list used by live
 * refresh and widened LC130 backfill paths. Symbols are read only from
 * `tuningUniverse.ts` (no duplicated hardcoding).
 */
import { TUNING_SYMBOLS } from "../data/tuningUniverse.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "tuningUniverseRegistrar" });

let cached: readonly string[] | null = null;

/** Idempotent. Logs once on first call. */
export function registerTuningUniverseOnBoot(): void {
  if (cached) return;
  cached = Object.freeze(TUNING_SYMBOLS.map((s) => s.toUpperCase()));
  log.info({ symbolCount: cached.length }, "ENTER tuning_registrar");
}

export function getTuningUniverseSymbols(): readonly string[] {
  if (!cached) {
    registerTuningUniverseOnBoot();
  }
  return cached!;
}
