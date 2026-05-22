/**
 * Preload terminal-visible data for chat / TA so models see the same facts as Company → Valuation.
 */
import { fetchAnalystCoverage, type AnalystCoverageResult } from "./analystCoverageService.js";
import {
  fetchChatTerminalNewsArticles,
  formatChatTerminalNewsBlock,
} from "./chatTerminalNews.js";
import { fetchQuoteForChat } from "./chatTools/getQuote.js";

const AMBIENT_ANALYST_LIMIT = 20;

function formatAnalystSnapshot(result: AnalystCoverageResult): string {
  const c = result.consensus;
  const lines: string[] = [
    `Symbol: ${result.symbol}`,
    `Source: ${result.data_source}${result.source_note ? ` — ${result.source_note}` : ""}`,
  ];
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
  if (c.num_active_analysts > 0) lines.push(`Active analysts (snapshot): ${c.num_active_analysts}`);
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

/** Markdown block appended to chat system prompt when user has a page symbol. */
export async function buildAmbientSymbolContextBlock(symbol: string | null | undefined): Promise<string> {
  const sym = symbol?.trim().toUpperCase();
  if (!sym) return "";

  const [analyst, quote, newsArticles] = await Promise.all([
    fetchAnalystCoverage(sym, AMBIENT_ANALYST_LIMIT).catch(() => null),
    fetchQuoteForChat(sym, "ambient context").catch(() => null),
    fetchChatTerminalNewsArticles(sym).catch(() => [] as Awaited<ReturnType<typeof fetchChatTerminalNewsArticles>>),
  ]);

  const parts: string[] = [
    `## Terminal snapshot (${sym})`,
    "Use this block for analyst, quote, and headline questions before inventing data. Headlines match the Markets → News tab (merged Polygon, Benzinga, Finnhub). Call tools if you need fresher flow, options, or a different ticker.",
  ];

  if (quote && !("error" in quote && quote.error)) {
    const q = quote as Record<string, unknown>;
    const last = q.last ?? q.price ?? q.regularMarketLastPrice;
    const chg = q.netChange ?? q.change;
    const pct = q.netPercentChange ?? q.percentChange;
    parts.push(
      `Quote: last ${last ?? "—"}${chg != null ? `, change ${chg}` : ""}${pct != null ? ` (${pct}%)` : ""}`,
    );
  }

  if (analyst && analyst.data_source !== "none") {
    parts.push("Analyst coverage:", formatAnalystSnapshot(analyst));
  } else {
    parts.push(
      "Analyst coverage: unavailable from terminal backends (Polygon Benzinga not entitled; no Benzinga/FMP/Schwab fallback). Say so plainly if asked.",
    );
  }

  parts.push(formatChatTerminalNewsBlock(sym, newsArticles));

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
