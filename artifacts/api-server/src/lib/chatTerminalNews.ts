/**
 * Terminal news for chat — same merged Polygon/Benzinga/Finnhub feed as GET /api/market/news (News tab).
 */
import { logger } from "./logger.js";
import {
  fetchMergedMarketNewsArticles,
  type NormalizedArticle,
} from "./tickerNewsAggregated.js";

const CHAT_NEWS_HEADLINE_LIMIT = 25;
const SUMMARY_SNIP = 140;

const newsLog = {
  warn: (o: unknown, m?: string) => logger.warn(o, m),
  info: (o: unknown, m?: string) => logger.info(o, m),
};

function etYmd(unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSec * 1000));
}

function formatPublishedEt(unixSec: number): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function snip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).trimEnd();
  const lastSpace = cut.lastIndexOf(" ");
  const out = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${out}…`;
}

/** Format one headline line for chat / tool output. */
export function formatChatNewsLine(article: NormalizedArticle, todayYmd: string): string {
  const dayTag = article.datetime && etYmd(article.datetime) === todayYmd ? "[TODAY] " : "";
  const when = formatPublishedEt(article.datetime);
  const src = article.source || "Unknown";
  const head = article.headline?.trim() || "(no headline)";
  const sum = article.summary?.trim();
  const sumPart = sum ? ` — ${snip(sum, SUMMARY_SNIP)}` : "";
  return `${dayTag}${when} ET | ${src} | ${head}${sumPart}`;
}

/** Markdown block for ambient system prompt (News tab parity). */
export function formatChatTerminalNewsBlock(
  symbol: string,
  articles: NormalizedArticle[],
  now: Date = new Date(),
): string {
  if (articles.length === 0) {
    return "Recent headlines (News tab feed): none returned from Polygon/Benzinga/Finnhub for this symbol.";
  }
  const todayYmd = etYmd(Math.floor(now.getTime() / 1000));
  const lines = articles
    .slice(0, CHAT_NEWS_HEADLINE_LIMIT)
    .map((a) => `- ${formatChatNewsLine(a, todayYmd)}`);
  return [
    `Recent headlines (News tab feed, merged Polygon + Benzinga + Finnhub, newest first):`,
    ...lines,
  ].join("\n");
}

export async function fetchChatTerminalNewsArticles(
  symbol: string,
  signal?: AbortSignal,
): Promise<NormalizedArticle[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return [];
  return fetchMergedMarketNewsArticles(sym, newsLog, signal);
}

export type ChatNewsToolPayload = {
  symbol: string;
  source: "news_tab_merged";
  headline_count: number;
  headlines: string[];
  articles: Array<{
    source: string;
    headline: string;
    summary: string;
    url: string;
    datetime: number;
    published_et: string;
    same_day_et: boolean;
  }>;
  fmp_supplemental: string[];
};

/** Structured get_news tool payload (merged feed + optional FMP extras). */
export async function buildChatNewsToolPayload(
  symbol: string,
  fmpHeadlines: string[],
  now: Date = new Date(),
): Promise<ChatNewsToolPayload> {
  const sym = symbol.trim().toUpperCase();
  const articles = await fetchChatTerminalNewsArticles(sym);
  const todayYmd = etYmd(Math.floor(now.getTime() / 1000));
  const limited = articles.slice(0, CHAT_NEWS_HEADLINE_LIMIT);
  const headlines = limited.map((a) => formatChatNewsLine(a, todayYmd));
  const seen = new Set(headlines.map((h) => h.toLowerCase().slice(0, 60)));
  const fmp_supplemental = fmpHeadlines.filter((h) => {
    const k = h.toLowerCase().slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    symbol: sym,
    source: "news_tab_merged",
    headline_count: limited.length,
    headlines: [...headlines, ...fmp_supplemental],
    articles: limited.map((a) => ({
      source: a.source,
      headline: a.headline,
      summary: a.summary,
      url: a.url,
      datetime: a.datetime,
      published_et: formatPublishedEt(a.datetime),
      same_day_et: Boolean(a.datetime && etYmd(a.datetime) === todayYmd),
    })),
    fmp_supplemental,
  };
}
