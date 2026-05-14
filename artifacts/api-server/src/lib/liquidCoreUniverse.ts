import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import { getTuningUniverseSymbols } from "./tuningUniverseRegistrar.js";

/** Liquid Core 130 ∪ tuning universe (deduped). Shared by boot backfills and coverage matrix. */
export function liquidCoreUnionTuningSymbols(): string[] {
  return [...new Set([...LIQUID_CORE_SYMBOL_STRINGS, ...getTuningUniverseSymbols()])];
}
