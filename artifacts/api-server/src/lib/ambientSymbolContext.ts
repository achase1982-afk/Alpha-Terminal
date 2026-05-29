/**
 * Preload terminal-visible data for chat / TA so models see the same facts as Company → Valuation.
 */
import { fetchAnalystCoverage, type AnalystCoverageResult } from "./analystCoverageService.js";
import {
  fetchChatTerminalNewsArticles,
  formatChatTerminalNewsBlock,
} from "./chatTerminalNews.js";
import { fetchQuoteForChat } from "./chatTools/getQuote.js";
import { fetchChatPortfolioSnapshot, formatChatPortfolioAmbientBlock } from "./chatPortfolio.js";
import type { MarketSessionLabel } from "./getMarketContext.js";
import { getMarketContext } from "./getMarketContext.js";

export type AmbientSymbolContextOptions = {
  marketAccessToken?: string | null;
  traderAccessToken?: string | null;
  clientTimeZone?: string | null;
};

const AMBIENT_ANALYST_LIMIT = 20;

function formatAnalystSnapshot(result: AnalystCoverageResult): string {
  const c = result.consensus;
  const lines: string[] = [`Symbol: ${result.symbol}`];
  if (result.coverage_reason) lines.push(`Coverage note: ${result.coverage_reason}`);
  if (c.consensus_pt != null) {
    lines.push(
      `Consensus PT: $${Math.round(c.consensus_pt)} (low $${c.low_pt != null ? Math.round(c.low_pt) : "—"}, high $${c.high_pt != null ? Math.round(c.high_pt) : "—"})`,
    );
  }
  const total = c.strong_buy + c.buy + c.hold + c.sell + c.strong_sell;
  if (total > 0) {
    lines.push(
      `Rating mix: strong buy ${c.strong_buy}, buy ${c.buy}, hold ${c.hold}, sell ${c.sell}, strong sell ${c.strong_sell}`,
    );
  }
  if (c.num_active_analysts > 0) lines.push(`Active analysts: ${c.num_active_analysts}`);
  for (const r of result.ratings.slice(0, AMBIENT_ANALYST_LIMIT)) {
    const pt = r.pt_current != null ? `$${Math.round(r.pt_current)}` : "—";
    lines.push(
      `- ${r.date} ${r.firm}: ${r.action_type} ${r.rating_prior ?? "—"} → ${r.rating_current ?? "—"}, PT ${pt}`,
    );
  }
  if (result.ratings.length === 0 && result.data_source === "schwab_fundamental") {
    lines.push("(Schwab fundamental snapshot — per-firm rows not available.)");
  }
  return lines.join("\n");
}

function formatAmbientQuoteLine(q: Record<string, unknown>, session: MarketSessionLabel): string {
  const normalized = q.normalizedQuote as { summary?: string } | undefined;
  if (normalized?.summary) {
    const bid = q.bid;
    const ask = q.ask;
    const ageSec =
      typeof q.quoteAgeMs === "number" ? Math.round((q.quoteAgeMs as number) / 1000) : null;
    const extras = [
      bid != null && ask != null ? `bid ${bid} / ask ${ask}` : null,
      ageSec != null ? `quote age ${ageSec}s` : null,
    ].filter(Boolean);
    const tail = extras.length ? ` (${extras.join(", ")})` : "";
    return `Live quote (${session}): ${normalized.summary}${tail}`;
  }
  const display = q.displayLast ?? q.last;
  const bid = q.bid;
  const ask = q.ask;
  const ageSec =
    typeof q.quoteAgeMs === "number" ? Math.round((q.quoteAgeMs as number) / 1000) : null;
  const parts = [
    `Live quote (${session}): ${display ?? "—"}`,
    bid != null && ask != null ? `bid ${bid} / ask ${ask}` : null,
    ageSec != null ? `quote age ${ageSec}s` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Markdown block appended to chat system prompt when user has a page symbol. */
export async function buildAmbientSymbolContextBlock(
  symbol: string | null | undefined,
  options: AmbientSymbolContextOptions = {},
): Promise<string> {
  const sym = symbol?.trim().toUpperCase();
  const session = getMarketContext(new Date(), options.clientTimeZone ?? undefined).session;

  const [analyst, quote, newsArticles, portfolio] = await Promise.all([
    sym
      ? fetchAnalystCoverage(sym, AMBIENT_ANALYST_LIMIT).catch(() => null)
      : Promise.resolve(null),
    sym
      ? fetchQuoteForChat(sym, "ambient context", {
          marketAccessToken: options.marketAccessToken,
          clientTimeZone: options.clientTimeZone,
        }).catch(() => null)
      : Promise.resolve(null),
    sym
      ? fetchChatTerminalNewsArticles(sym).catch(() => [] as Awaited<ReturnType<typeof fetchChatTerminalNewsArticles>>)
      : Promise.resolve([]),
    fetchChatPortfolioSnapshot(options.traderAccessToken).catch(() => ({
      available: false,
      positions: [],
    })),
  ]);

  const parts: string[] = [
    sym ? `## Context data (${sym}) — internal only` : "## Context data — internal only",
    "Use quote, analyst, headline, and portfolio facts below before inventing data. Do not mention this section, the terminal, news feed, wire names, tools, or web search in your reply. Synthesize into plain analyst prose.",
    "For current price and session change, use the normalized quote summary verbatim (extended-hours prints when session is PREMARKET or AFTERHOURS). Never recompute change from raw prices.",
  ];

  if (sym && quote && !("error" in quote && quote.error)) {
    parts.push(formatAmbientQuoteLine(quote as Record<string, unknown>, session));
  } else if (sym) {
    parts.push("Live quote: unavailable — call get_quote or check Schwab connection.");
  }

  if (sym) {
    if (analyst && analyst.data_source !== "none") {
      parts.push("Analyst coverage:", formatAnalystSnapshot(analyst));
    } else {
      parts.push("Analyst coverage: unavailable from configured data. Say so plainly if asked, without naming backends.");
    }
    parts.push(formatChatTerminalNewsBlock(sym, newsArticles));
  }

  parts.push(formatChatPortfolioAmbientBlock(portfolio));

  return `\n\n${parts.join("\n")}`;
}

/** Plain-text block for technical-analysis stream prompt. */
export async function buildTechnicalAnalysisAnalystBlock(symbol: string): Promise<string> {
  const result = await fetchAnalystCoverage(symbol.trim().toUpperCase(), AMBIENT_ANALYST_LIMIT).catch(() => null);
  if (!result || result.data_source === "none") {
    return "\nANALYST COVERAGE: Not available from configured data sources.\n";
  }
  return `\nANALYST COVERAGE (same source as Company → Valuation):\n${formatAnalystSnapshot(result)}\n`;
}
