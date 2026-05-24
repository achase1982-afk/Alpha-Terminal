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
      "q1",
      "q2",
      "q3",
      "q4",
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

const ALNUM_SPACE_KEYWORD = /^[a-z0-9 ]+$/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whitespace-delimited tokens (hyphenated compounds stay one token). */
function tokenizeHeadline(hay: string): string[] {
  return hay
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter(Boolean);
}

function tokensIncludePhrase(tokens: string[], phrase: string): boolean {
  const parts = phrase
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.length === 1) return tokens.includes(parts[0]!);
  for (let i = 0; i <= tokens.length - parts.length; i++) {
    if (parts.every((p, j) => tokens[i + j] === p)) return true;
  }
  return false;
}

/** Match keyword as whole token(s) or bounded phrase; avoids "sector" inside "defense-sector". */
export function headlineMatchesKeyword(hay: string, keyword: string): boolean {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;

  if (ALNUM_SPACE_KEYWORD.test(kw)) {
    if (kw.includes(" ")) return tokensIncludePhrase(tokenizeHeadline(hay), kw);
    return tokenizeHeadline(hay).includes(kw);
  }

  const pattern = `(?<![a-z0-9])${escapeRegex(kw)}(?![a-z0-9])`;
  return new RegExp(pattern, "i").test(hay);
}

/** Classify a headline into a catalyst type via keyword match (no LLM). */
export function classifyCatalystTypeFromHeadline(
  headline: string,
): ClassifiableCatalystType | "NONE" | "UNKNOWN" {
  const hay = headline.toLowerCase();
  if (!hay.trim()) return "NONE";
  for (const group of MOVERS_CATALYST_KEYWORD_GROUPS) {
    for (const kw of group.keywords) {
      if (headlineMatchesKeyword(hay, kw)) return group.type;
    }
  }
  return "UNKNOWN";
}

export function catalystTypeSortPriority(
  type: ClassifiableCatalystType | "NONE" | "UNKNOWN",
): number {
  if (type === "NONE") return 99;
  if (type === "UNKNOWN") return 98;
  const i = ORDER.indexOf(type as (typeof ORDER)[number]);
  return i >= 0 ? i : 50;
}
