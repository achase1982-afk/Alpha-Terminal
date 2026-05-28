import { tool } from "ai";
import { z } from "zod";
import { getStoredIVR } from "../ivNormalize.js";
import { fetchAnalystCoverage } from "../analystCoverageService.js";
import { getNextEarningsDate } from "../earningsService.js";
import { getPolygonFlowHighlights } from "../polygonFlowHighlights.js";
import { requestFlowCapture } from "../flowCaptureService.js";
import { fetchPolygonChain } from "../polygonChain.js";
import { getOrFetchChain } from "../../routes/market.js";
import { getLatestMarketPulseForChat } from "../marketPulseCache.js";
import { logger } from "../logger.js";
import { buildChatNewsToolPayload } from "../chatTerminalNews.js";
import { runChatNativeWebSearch } from "./chatWebSearch.js";
import { augmentPolygonColdTickerForChat } from "../chatPolygonColdActivity.js";
import { fetchQuoteForChat } from "./getQuote.js";
import { fetchTechnicalsForSymbol } from "./technicals.js";
import type { ChatToolContext } from "./types.js";

const FMP_NEWS_LIMIT = 12;

async function fetchFmpHeadlines(symbol: string): Promise<string[]> {
  const key = (process.env.FMP_API_KEY ?? "").trim();
  if (!key) return [];
  const sym = symbol.toUpperCase().trim();
  try {
    const url =
      `https://financialmodelingprep.com/api/v3/stock_news?tickers=${encodeURIComponent(sym)}` +
      `&limit=${FMP_NEWS_LIMIT}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) return [];
    const lines: string[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title : "";
      const site = typeof o.site === "string" ? o.site : "";
      const published = typeof o.publishedDate === "string" ? o.publishedDate : "";
      if (title) lines.push(`${published} | ${title}${site ? ` (${site})` : ""}`);
    }
    return lines;
  } catch (err) {
    logger.warn({ err, sym }, "chatTools: FMP stock_news failed");
    return [];
  }
}

async function webFetchUrl(url: string): Promise<Record<string, unknown>> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { error: "URL must start with http:// or https://" };
  }
  try {
    const res = await fetch(trimmed, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "AlphaTerminal-Chat/1.0" },
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}`, url: trimmed };
    }
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12_000);
    return { url: trimmed, excerpt: text || "(no extractable text)" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), url: trimmed };
  }
}

const packLog = {
  info: (obj: unknown, msg?: string) => logger.info(obj, msg),
  warn: (obj: unknown, msg?: string) => logger.warn(obj, msg),
};

/** Tool catalog for Alpha Terminal chat (AI SDK `streamText`). */
export function createChatTools(ctx: ChatToolContext) {
  return {
    get_quote: tool({
      description:
        "Live or recent equity quote for a US ticker. Uses Schwab streamer cache on the API server when subscribed, else Polygon daily aggs.",
      inputSchema: z.object({
        symbol: z.string().describe("US equity ticker, e.g. AAPL"),
      }),
      execute: async ({ symbol }) => fetchQuoteForChat(symbol, "equity quote"),
    }),

    get_technicals: tool({
      description: "Session VWAP, RSI14, Bollinger 20, SMA20/50 from persisted bars.",
      inputSchema: z.object({
        symbol: z.string(),
        period: z.string().optional().describe("Hint such as daily or intraday (VWAP is session-based)"),
      }),
      execute: async ({ symbol, period }) => fetchTechnicalsForSymbol(symbol, period),
    }),

    get_options_chain: tool({
      description:
        "Options chain snapshot (Polygon Options Advanced REST). Returns underlying price and top contracts by volume.",
      inputSchema: z.object({
        symbol: z.string(),
        expiration: z.string().optional().describe("YYYY-MM-DD filter"),
        delta_band: z
          .string()
          .optional()
          .describe("Optional hint such as 0.08-0.25 for wing contracts"),
      }),
      execute: async ({ symbol, expiration, delta_band }) => {
        const sym = symbol.toUpperCase().trim();
        const apiKey = (process.env.POLYGON_API_KEY ?? "").trim();
        if (!apiKey) {
          const tok = (ctx.schwabAccessToken ?? "").trim();
          if (tok) {
            const chain = await getOrFetchChain(sym, tok, packLog);
            if (chain) {
              return {
                source: "schwab_chain",
                symbol: sym,
                underlyingPrice: chain.underlyingPrice,
                totalCalls: chain.totalCalls,
                totalPuts: chain.totalPuts,
                note: "POLYGON_API_KEY unset — returned Schwab chain summary only.",
              };
            }
          }
          return { error: "POLYGON_API_KEY not configured and Schwab chain unavailable." };
        }
        const chain = await fetchPolygonChain(sym, apiKey, { maxDte: 60, maxPages: 8, log: packLog });
        if (!chain) return { error: "Polygon chain returned no data", symbol: sym };
        const minDelta = delta_band?.includes("0.08") ? 0.08 : 0;
        const maxDelta = delta_band?.includes("0.25") ? 0.25 : 1;
        const filterContract = (c: { expiration: string; delta?: number; strike: number; volume?: number }) => {
          if (expiration && !c.expiration.startsWith(expiration)) return false;
          if (minDelta > 0 && c.delta != null) {
            const a = Math.abs(c.delta);
            if (a < minDelta || a > maxDelta) return false;
          }
          return true;
        };
        const calls = (chain.calls ?? []).filter(filterContract).slice(0, 40);
        const puts = (chain.puts ?? []).filter(filterContract).slice(0, 40);
        return {
          source: "polygon_options_advanced",
          symbol: sym,
          underlyingPrice: chain.underlyingPrice,
          expirationFilter: expiration ?? null,
          calls,
          puts,
        };
      },
    }),

    get_flow: tool({
      description:
        "Options flow highlights and session tape from DB; may run a short Polygon capture when tape is thin.",
      inputSchema: z.object({
        symbol: z.string(),
        window: z.string().optional().describe("e.g. session, today"),
      }),
      execute: async ({ symbol, window }) => {
        const sym = symbol.toUpperCase().trim();
        let highlights = await getPolygonFlowHighlights(sym);
        const cold = await augmentPolygonColdTickerForChat({
          symbol: sym,
          lastUserMessage: window ?? "options flow tape",
          highlightsBefore: highlights,
          packLog,
        });
        if (cold.highlights !== undefined) highlights = cold.highlights;

        if (highlights?.sessionTape?.tapeKind === "eod_fallback" && !cold.tierBCaptureAttempted) {
          try {
            await requestFlowCapture(sym, { timeout: 12_000, minDurationMs: 1_500 });
            highlights = (await getPolygonFlowHighlights(sym)) ?? highlights;
          } catch (err) {
            logger.warn({ err, sym }, "chatTools: on-demand flow capture failed");
          }
        }

        return {
          symbol: sym,
          window: window ?? "session",
          polygonColdTierA: cold.section,
          highlights: highlights ?? null,
        };
      },
    }),

    get_ivr: tool({
      description: "Stored IV rank (IVR) for a symbol from equity_daily history.",
      inputSchema: z.object({ symbol: z.string() }),
      execute: async ({ symbol }) => {
        const ivr = await getStoredIVR(symbol.toUpperCase().trim());
        return ivr ?? { error: "IVR not available for this symbol" };
      },
    }),

    get_earnings: tool({
      description: "Next earnings date for a symbol.",
      inputSchema: z.object({ symbol: z.string() }),
      execute: async ({ symbol }) => {
        const e = await getNextEarningsDate(symbol.toUpperCase().trim()).catch(() => null);
        return e ?? { error: "No earnings date on file" };
      },
    }),

    get_analyst_ratings: tool({
      description:
        "Sell-side analyst coverage for a US equity: consensus price target, rating distribution (strong buy through strong sell), and recent firm rating rows. Uses Polygon/Benzinga when entitled, else Benzinga direct, FMP backfill, or Schwab fundamental snapshot.",
      inputSchema: z.object({
        symbol: z.string(),
        limit: z.number().optional().describe("Max rating rows to return (default 50)"),
      }),
      execute: async ({ symbol, limit }) => {
        const sym = symbol.toUpperCase().trim();
        const lim = limit != null && Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
        const result = await fetchAnalystCoverage(sym, lim);
        return {
          symbol: result.symbol,
          data_source: result.data_source,
          source_note: result.source_note,
          coverage_reason: result.coverage_reason,
          consensus: result.consensus,
          recent_ratings: result.ratings.slice(0, lim),
          rating_count: result.ratings.length,
        };
      },
    }),

    get_news: tool({
      description:
        "Recent headlines for a ticker (internal). Use to learn catalysts; synthesize into plain prose without citing wire names, headline titles, or the news feed.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        query: z.string().optional(),
      }),
      execute: async ({ symbol, query }) => {
        const sym = (symbol ?? query ?? "").trim().toUpperCase();
        if (!sym) return { error: "Provide symbol or query" };
        const fmp = await fetchFmpHeadlines(sym);
        const payload = await buildChatNewsToolPayload(sym, fmp);
        return {
          ...payload,
          fmpConfigured: !!(process.env.FMP_API_KEY ?? "").trim(),
        };
      },
    }),

    get_market_pulse: tool({
      description: "Latest Market Pulse v2.6 composite regime snapshot (if generated recently).",
      inputSchema: z.object({}),
      execute: async () => getLatestMarketPulseForChat(),
    }),

    web_search: tool({
      description:
        "Search the public web for catalysts or missing context. Return facts for you to synthesize; do not quote publishers or say you searched the web in the final answer.",
      inputSchema: z.object({
        query: z.string().describe("Search query, include ticker when relevant"),
      }),
      execute: async ({ query }) => {
        return runChatNativeWebSearch(ctx.activeModel, query, ctx.anthropicOpusEffort);
      },
    }),

    web_fetch: tool({
      description: "Fetch and extract plain text from a public https URL.",
      inputSchema: z.object({ url: z.string().url().or(z.string().min(8)) }),
      execute: async ({ url }) => webFetchUrl(url),
    }),
  };
}

export type ChatTools = ReturnType<typeof createChatTools>;
