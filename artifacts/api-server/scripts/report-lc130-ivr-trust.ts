/**
 * Report how many Liquid Core 130 names have trusted stored IVR (non-proxy).
 * Run after Path B backfill + recompute-ivr. Usage: ./node_modules/.bin/tsx scripts/report-lc130-ivr-trust.ts
 */
import { getStoredIVR } from "../src/lib/ivNormalize";
import { LIQUID_CORE_SYMBOLS } from "../src/data/liquidCore130";

async function main() {
  const universe = [...LIQUID_CORE_SYMBOLS];
  const trusted: string[] = [];
  const failed: Array<{ symbol: string; reason: string }> = [];

  for (const sym of universe) {
    const row = await getStoredIVR(sym);
    if (!row) {
      failed.push({ symbol: sym, reason: "getStoredIVR returned null (stale, insufficient history, or no IVR)" });
      continue;
    }
    if (row.source === "hv_proxy") {
      failed.push({ symbol: sym, reason: `IVR still sourced from hv_proxy as of ${row.asOfDate}` });
      continue;
    }
    trusted.push(sym);
  }

  const out = {
    universeSize: universe.length,
    trustedCount: trusted.length,
    trusted,
    failed,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
