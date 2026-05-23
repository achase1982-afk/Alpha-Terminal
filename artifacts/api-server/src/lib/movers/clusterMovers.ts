import type { Situation } from "@workspace/movers-types";
import { MOVERS_THEME_TICKER_MAP } from "@workspace/movers-types";
import type { FmpMoverRow } from "./fmpMoversClient.js";
import type { FmpCompanyProfile } from "./fmpCompanyProfile.js";

export interface EnrichedMover {
  row: FmpMoverRow;
  profile?: FmpCompanyProfile;
}

function toTickerStat(row: FmpMoverRow, profile?: FmpCompanyProfile) {
  return {
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    price: row.price,
    changePct: row.changesPercentage,
    ...(profile?.sector ? { sector: profile.sector } : {}),
    ...(profile?.industry ? { industry: profile.industry } : {}),
    ...(profile?.marketCap != null ? { marketCap: profile.marketCap } : {}),
    ...(profile?.description ? { description: profile.description } : {}),
  };
}

const PLACEHOLDER_SITUATION = {
  catalystType: "NONE" as const,
  catalyst: "",
  read: "",
  posture: "WAIT" as const,
  confidence: "LOW" as const,
};

function makeClusterId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `cluster-${slug || "group"}`;
}

function singleSituation(item: EnrichedMover): Situation {
  return {
    kind: "single",
    id: item.row.symbol,
    label: item.row.symbol,
    tickers: [toTickerStat(item.row, item.profile)],
    ...PLACEHOLDER_SITUATION,
  };
}

function clusterSituation(label: string, items: EnrichedMover[]): Situation {
  const sorted = [...items].sort(
    (a, b) => Math.abs(b.row.changesPercentage) - Math.abs(a.row.changesPercentage),
  );
  return {
    kind: "cluster",
    id: makeClusterId(label),
    label,
    tickers: sorted.map((i) => toTickerStat(i.row, i.profile)),
    ...PLACEHOLDER_SITUATION,
  };
}

/**
 * Group tradeable movers by curated theme ticker map only. Industry/sector are never
 * clustering axes. A theme cluster includes only symbols present in this poll's feed.
 */
export function clusterEnrichedMovers(items: EnrichedMover[]): Situation[] {
  const feedBySymbol = new Map(items.map((i) => [i.row.symbol, i]));
  const assigned = new Set<string>();
  const situations: Situation[] = [];

  for (const { label, tickers } of MOVERS_THEME_TICKER_MAP) {
    const members: EnrichedMover[] = [];
    for (const sym of tickers) {
      const upper = sym.toUpperCase();
      const item = feedBySymbol.get(upper);
      if (item) members.push(item);
    }

    if (members.length >= 2) {
      situations.push(clusterSituation(label, members));
      for (const m of members) assigned.add(m.row.symbol);
    }
  }

  for (const item of items) {
    if (assigned.has(item.row.symbol)) continue;
    situations.push(singleSituation(item));
    assigned.add(item.row.symbol);
  }

  situations.sort((a, b) => {
    const aPct = Math.max(...a.tickers.map((t) => Math.abs(t.changePct)));
    const bPct = Math.max(...b.tickers.map((t) => Math.abs(t.changePct)));
    return bPct - aPct;
  });

  return situations;
}
