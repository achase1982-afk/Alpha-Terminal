import type { FilteredName, MoversFeed } from "@workspace/movers-types";
import type { FmpMoverRow } from "./fmpMoversClient.js";
import { fetchFmpCompanyProfiles } from "./fmpCompanyProfile.js";
import { clusterEnrichedMovers } from "./clusterMovers.js";
import { applyDeterministicCatalystToSituations } from "./moversDeterministicCatalyst.js";
import { stripMover } from "./stripMover.js";
import { stripMicroCap } from "./stripMicroCap.js";

function toFiltered(row: FmpMoverRow, reason: FilteredName["reason"]): FilteredName {
  return {
    symbol: row.symbol,
    name: row.name,
    price: row.price,
    changePct: row.changesPercentage,
    reason,
  };
}

export function applyStage1Strip(rows: FmpMoverRow[]): {
  survivors: FmpMoverRow[];
  filtered: FilteredName[];
} {
  const filtered: FilteredName[] = [];
  const survivors: FmpMoverRow[] = [];

  for (const row of rows) {
    const verdict = stripMover({ name: row.name, price: row.price });
    if (verdict.keep) {
      survivors.push(row);
    } else if (verdict.reason) {
      filtered.push(toFiltered(row, verdict.reason));
    }
  }

  return { survivors, filtered };
}

export async function buildMoversFeedFromRows(
  rows: FmpMoverRow[],
  capturedAt = new Date(),
): Promise<MoversFeed> {
  const detected = rows.length;
  const { survivors: stage1Survivors, filtered: stage1Filtered } = applyStage1Strip(rows);

  const profiles = await fetchFmpCompanyProfiles(stage1Survivors.map((r) => r.symbol));
  const { tradeable, filtered: microFiltered } = stripMicroCap(stage1Survivors, profiles);

  const filtered = [...stage1Filtered, ...microFiltered];

  const enriched = tradeable.map((row) => ({ row, profile: profiles.get(row.symbol) }));
  const clustered = clusterEnrichedMovers(enriched);
  const { situations, flagged } = await applyDeterministicCatalystToSituations(clustered);

  return {
    capturedAt: capturedAt.toISOString(),
    funnel: {
      detected,
      filtered: filtered.length,
      tradeable: tradeable.length,
      situations: situations.length,
    },
    situations,
    flagged,
    filtered,
  };
}

/** Placeholder when no poll has been persisted yet (`capturedAt` is empty). */
export function emptyMoversFeed(): MoversFeed {
  return {
    capturedAt: "",
    funnel: { detected: 0, filtered: 0, tradeable: 0, situations: 0 },
    situations: [],
    flagged: [],
    filtered: [],
  };
}
