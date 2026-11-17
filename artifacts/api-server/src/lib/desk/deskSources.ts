export type DeskQuotesSource = "schwab" | "tradier" | "alpaca_paper" | "alpaca" | "tastytrade";
export type DeskChainsSource = "schwab";
export type DeskBarsSource = "schwab" | "eodhd" | "alpaca_paper" | "alpaca";
export type DeskNewsSource =
  | "finnhub"
  | "alpaca_news"
  | "alpaca"
  | "alphavantage"
  | "marketaux"
  | "stocknews";
export type DeskGammaSource = "unusual_whales";
export type DeskFundamentalsSource = "alphavantage";
export type DeskFlowSource = "unusual_whales";

const ALIASES: Record<string, string> = {
  unusual_whales: "unusual_whales",
  uw: "unusual_whales",
  tasty: "tastytrade",
};

export function deskNormalizeSourceParam(raw: string | undefined): string | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const v = raw.trim().toLowerCase();
  return ALIASES[v] ?? v;
}

/** Requires explicit `source=` — no default vendor when the parameter is omitted. */
export function deskResolveSource<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): { source: T } | { error: string; source: string; allowed: readonly T[] } {
  const norm = deskNormalizeSourceParam(raw);
  if (norm == null || norm === "") {
    return {
      error: "source query parameter is required",
      source: "",
      allowed,
    };
  }
  const chosen = norm as T;
  if (!allowed.includes(chosen)) {
    return {
      error: `unsupported source "${norm}"`,
      source: norm,
      allowed,
    };
  }
  return { source: chosen };
}