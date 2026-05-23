import type { FilteredName } from "@workspace/movers-types";
import { MARKET_CAP_FLOOR } from "./moversConfig.js";
import type { FmpMoverRow } from "./fmpMoversClient.js";
import type { FmpCompanyProfile } from "./fmpCompanyProfile.js";

export function isBelowMarketCapFloor(marketCap: number | null | undefined): boolean {
  if (marketCap == null || !Number.isFinite(marketCap)) return true;
  return marketCap < MARKET_CAP_FLOOR;
}

export function stripMicroCap(
  survivors: FmpMoverRow[],
  profiles: Map<string, FmpCompanyProfile>,
): { tradeable: FmpMoverRow[]; filtered: FilteredName[] } {
  const tradeable: FmpMoverRow[] = [];
  const filtered: FilteredName[] = [];

  for (const row of survivors) {
    const profile = profiles.get(row.symbol);
    const marketCap = profile?.marketCap ?? null;
    if (isBelowMarketCapFloor(marketCap)) {
      filtered.push({
        symbol: row.symbol,
        name: row.name,
        price: row.price,
        changePct: row.changesPercentage,
        reason: "MICRO_CAP",
      });
    } else {
      tradeable.push(row);
    }
  }

  return { tradeable, filtered };
}
