import type { FilteredName, MoversFeed, Situation, TickerStat } from "@workspace/movers-types";
import type { FmpMoverRow } from "./fmpMoversClient.js";
import type { FmpCompanyProfile } from "./fmpCompanyProfile.js";
import { fetchFmpCompanyProfiles } from "./fmpCompanyProfile.js";
import { stripMover } from "./stripMover.js";
import { stripMicroCap } from "./stripMicroCap.js";

function toTickerStat(row: FmpMoverRow, profile?: FmpCompanyProfile): TickerStat {
  return {
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    price: row.price,
    changePct: row.changesPercentage,
    ...(profile?.sector ? { sector: profile.sector } : {}),
    ...(profile?.industry ? { industry: profile.industry } : {}),
    ...(profile?.marketCap != null ? { marketCap: profile.marketCap } : {}),
  };
}

function toFiltered(row: FmpMoverRow, reason: FilteredName["reason"]): FilteredName {
  return {
    symbol: row.symbol,
    name: row.name,
    price: row.price,
    changePct: row.changesPercentage,
    reason,
  };
}

function singleSituation(row: FmpMoverRow, profile?: FmpCompanyProfile): Situation {
  return {
    kind: "single",
    id: row.symbol,
    label: row.symbol,
    tickers: [toTickerStat(row, profile)],
    catalystType: "PENDING",
    catalyst: null,
    read: null,
    posture: "PENDING",
    confidence: null,
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

  tradeable.sort((a, b) => Math.abs(b.changesPercentage) - Math.abs(a.changesPercentage));

  const situations = tradeable.map((row) => singleSituation(row, profiles.get(row.symbol)));

  return {
    capturedAt: capturedAt.toISOString(),
    funnel: {
      detected,
      filtered: filtered.length,
      tradeable: tradeable.length,
      situations: situations.length,
    },
    situations,
    flagged: [],
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
