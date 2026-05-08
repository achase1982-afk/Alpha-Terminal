/**
 * One-shot: options_daily backfill only (tuning universe). Idempotent upserts.
 * Optional: TUNING_OPTIONS_SYMBOLS=ORCL,ADBE (comma-separated) to limit symbols.
 */
import "../loadEnv.js";
import { TUNING_SYMBOLS } from "../data/tuningUniverse.js";
import { backfillOptionsDailyForSymbol } from "./backfill/optionsDailyBackfill.js";

async function main(): Promise<void> {
  const raw = process.env["TUNING_OPTIONS_SYMBOLS"]?.trim();
  const only = raw
    ? raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : null;
  const symbols = only?.length ? only : [...TUNING_SYMBOLS];

  for (const sym of symbols) {
    console.log(JSON.stringify({ msg: "ENTER tuning_options_daily_only", symbol: sym }));
    const r = await backfillOptionsDailyForSymbol(sym);
    console.log(JSON.stringify({ msg: "EXIT tuning_options_daily_only", symbol: sym, ...r }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
