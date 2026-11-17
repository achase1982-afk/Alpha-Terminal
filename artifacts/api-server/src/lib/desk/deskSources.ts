export type DeskQuotesSource = "schwab" | "tradier";
export type DeskChainsSource = "schwab";
export type DeskNewsSource = "finnhub" | "alpaca_news";
export type DeskFlowSource = "unusual_whales";

const ALIASES: Record<string, string> = {
  alpaca: "alpaca_news",
  unusual_whales: "unusual_whales",
  uw: "unusual_whales",
};

export function deskNormalizeSourceParam(raw: string | undefined): string | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const v = raw.trim().toLowerCase();
  return ALIASES[v] ?? v;
}

export function deskResolveSource<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  defaultSource: T,
): { source: T } | { error: string; source: string; allowed: readonly T[] } {
  const norm = deskNormalizeSourceParam(raw);
  const chosen = (norm ?? defaultSource) as T;
  if (!allowed.includes(chosen)) {
    return {
      error: `unsupported source "${norm ?? raw}"`,
      source: String(norm ?? raw ?? ""),
      allowed,
    };
  }
  return { source: chosen };
}