/**
 * Recompute IVR for Liquid Core 130 + sector ETFs (same union as historical backfill).
 * Usage: ./node_modules/.bin/tsx scripts/run-recompute-ivr-lc130.ts
 */
import { recomputeAllIVR } from "../src/lib/ivNormalize";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../src/data/liquidCore130";

const SECTOR_ETFS = ["XLE", "XLF", "XLK", "XLU", "XLV", "XLI", "XLP", "XLY", "XLB"];

async function main() {
  const symbols = [...new Set([...LIQUID_CORE_SYMBOL_STRINGS.map((s) => s.toUpperCase()), ...SECTOR_ETFS])];
  console.log(JSON.stringify({ event: "recompute_ivr_start", symbols: symbols.length }));
  const result = await recomputeAllIVR(symbols);
  console.log(JSON.stringify({ event: "recompute_ivr_done", result }));
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "recompute_ivr_fatal", error: (e as Error).message }));
  process.exit(1);
});
