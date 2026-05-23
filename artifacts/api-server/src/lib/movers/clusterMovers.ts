import type { Situation } from "@workspace/movers-types";
import type { FmpMoverRow } from "./fmpMoversClient.js";
import type { FmpCompanyProfile } from "./fmpCompanyProfile.js";
import { MOVERS_THEME_KEYWORDS } from "./moversThemeKeywords.js";

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
  };
}

function themeLabelFor(item: EnrichedMover): string | null {
  const haystack = `${item.row.name} ${item.profile?.industry ?? ""} ${item.profile?.sector ?? ""}`;
  for (const { label, pattern } of MOVERS_THEME_KEYWORDS) {
    if (pattern.test(haystack)) return label;
  }
  return null;
}

function clusterKey(item: EnrichedMover): string {
  const theme = themeLabelFor(item);
  if (theme) return `theme:${theme}`;
  const industry = item.profile?.industry?.trim();
  if (industry) return `industry:${industry}`;
  return `single:${item.row.symbol}`;
}

function clusterLabel(key: string, items: EnrichedMover[]): string {
  if (key.startsWith("theme:")) return key.slice("theme:".length);
  if (key.startsWith("industry:")) return key.slice("industry:".length);
  return items[0]?.row.symbol ?? "Mover";
}

function makeClusterId(key: string): string {
  const slug = key
    .replace(/^theme:|^industry:|^single:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `cluster-${slug || "group"}`;
}

function situationFromGroup(key: string, items: EnrichedMover[]): Situation {
  const sorted = [...items].sort(
    (a, b) => Math.abs(b.row.changesPercentage) - Math.abs(a.row.changesPercentage),
  );
  const tickers = sorted.map((i) => toTickerStat(i.row, i.profile));
  const label = clusterLabel(key, sorted);

  if (sorted.length === 1) {
    const only = sorted[0]!;
    return {
      kind: "single",
      id: only.row.symbol,
      label: only.row.symbol,
      tickers,
      catalystType: "PENDING",
      catalyst: null,
      read: null,
      posture: "PENDING",
      confidence: null,
    };
  }

  return {
    kind: "cluster",
    id: makeClusterId(key),
    label,
    tickers,
    catalystType: "PENDING",
    catalyst: null,
    read: null,
    posture: "PENDING",
    confidence: null,
  };
}

/**
 * Group tradeable movers by theme keyword (first) then industry. Groups of ≥2 become clusters.
 */
export function clusterEnrichedMovers(items: EnrichedMover[]): Situation[] {
  const groups = new Map<string, EnrichedMover[]>();

  for (const item of items) {
    const key = clusterKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const situations: Situation[] = [];
  for (const [key, group] of groups) {
    situations.push(situationFromGroup(key, group));
  }

  situations.sort((a, b) => {
    const aPct = Math.max(...a.tickers.map((t) => Math.abs(t.changePct)));
    const bPct = Math.max(...b.tickers.map((t) => Math.abs(t.changePct)));
    return bPct - aPct;
  });

  return situations;
}
