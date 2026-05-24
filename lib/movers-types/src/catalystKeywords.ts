type ClassifiableCatalystType = "GOV" | "ANALYST" | "CONTRACT" | "EARNINGS" | "MA" | "SECTOR";

/** Keyword groups for deterministic catalyst classification (first match wins). */
export const MOVERS_CATALYST_KEYWORD_GROUPS: ReadonlyArray<{
  type: ClassifiableCatalystType;
  keywords: readonly string[];
}> = [
  {
    type: "MA",
    keywords: [
      "merger",
      "acquisition",
      "acquire",
      "acquired",
      "buyout",
      "takeover",
      "spin-off",
      "spinoff",
      "divest",
      "deal to buy",
      "deal to sell",
      "m&a",
    ],
  },
  {
    type: "EARNINGS",
    keywords: [
      "earnings",
      "eps",
      "revenue beat",
      "revenue miss",
      "guidance",
      "quarterly results",
      "q1 ",
      "q2 ",
      "q3 ",
      "q4 ",
      "fiscal year",
      "profit warning",
      "beats estimates",
      "misses estimates",
    ],
  },
  {
    type: "CONTRACT",
    keywords: [
      "contract",
      "award",
      "order win",
      "wins contract",
      "secures contract",
      "partnership",
      "collaboration",
      "licensing deal",
      "supply agreement",
    ],
  },
  {
    type: "GOV",
    keywords: [
      "government",
      "federal",
      "pentagon",
      "department of defense",
      "dod",
      "congress",
      "regulatory approval",
      "fda approval",
      "tariff",
      "subsidy",
      "grant",
      "usda",
      "treasury",
    ],
  },
  {
    type: "ANALYST",
    keywords: [
      "upgrade",
      "downgrade",
      "price target",
      "initiates coverage",
      "reiterates",
      "overweight",
      "underweight",
      "outperform",
      "underperform",
      "analyst",
      "rating",
      "raises target",
      "cuts target",
    ],
  },
  {
    type: "SECTOR",
    keywords: [
      "sector",
      "industry",
      "peer",
      "peers",
      "supply chain",
      "commodity",
      "oil prices",
      "rates",
      "chip sector",
      "ai boom",
    ],
  },
] as const;

const ORDER = MOVERS_CATALYST_KEYWORD_GROUPS.map((g) => g.type);

/** Classify a headline into a catalyst type via keyword match (no LLM). */
export function classifyCatalystTypeFromHeadline(
  headline: string,
): ClassifiableCatalystType | "NONE" {
  const hay = headline.toLowerCase();
  if (!hay.trim()) return "NONE";
  for (const group of MOVERS_CATALYST_KEYWORD_GROUPS) {
    for (const kw of group.keywords) {
      if (hay.includes(kw)) return group.type;
    }
  }
  return "SECTOR";
}

export function catalystTypeSortPriority(type: ClassifiableCatalystType | "NONE"): number {
  if (type === "NONE") return 99;
  const i = ORDER.indexOf(type as (typeof ORDER)[number]);
  return i >= 0 ? i : 50;
}
