/** Hard-catalyst phrases for headline strength ranking (shared Movers + read fallback). */
export const MOVERS_HARD_CATALYST_KEYWORDS: readonly string[] = [
  "price target",
  "raised",
  "cut",
  "upgrade",
  "downgrade",
  "initiated",
  "earnings",
  "eps",
  "beats",
  "misses",
  "guidance",
  "acquire",
  "acquisition",
  "merger",
  "buyout",
  "stake",
  "contract",
  "awarded",
  "selected",
  "grant",
] as const;

const ALNUM_SPACE_KEYWORD = /^[a-z0-9 ]+$/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

/** Whether a headline title contains a hard-catalyst keyword (word/phrase boundary). */
export function headlineMatchesHardCatalystKeyword(hay: string, keyword: string): boolean {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;

  if (ALNUM_SPACE_KEYWORD.test(kw)) {
    if (kw.includes(" ")) return tokensIncludePhrase(tokenizeHeadline(hay), kw);
    return tokenizeHeadline(hay).includes(kw);
  }

  const pattern = `(?<![a-z0-9])${escapeRegex(kw)}(?![a-z0-9])`;
  return new RegExp(pattern, "i").test(hay);
}

/** Count of distinct hard-catalyst keyword hits in the headline (higher = stronger catalyst signal). */
export function scoreHeadlineHardCatalystStrength(headline: string): number {
  let score = 0;
  for (const kw of MOVERS_HARD_CATALYST_KEYWORDS) {
    if (headlineMatchesHardCatalystKeyword(headline, kw)) score += 1;
  }
  return score;
}

export function headlineHasHardCatalystKeyword(headline: string): boolean {
  return scoreHeadlineHardCatalystStrength(headline) > 0;
}
