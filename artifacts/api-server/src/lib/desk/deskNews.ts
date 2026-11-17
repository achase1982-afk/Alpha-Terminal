import { fetchSymbolNews } from "../symbolNewsProvider.js";
import { logger } from "../logger.js";
import { deskMarkFeedError, deskTouchFeedArticleAge } from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";

export async function deskFetchNews(symbols: string[]): Promise<{ articles: unknown[]; asOfMs: number }> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const all: unknown[] = [];
  let hadSuccess = false;
  for (const sym of uniq) {
    try {
      const rows = await fetchSymbolNews(sym, logger);
      hadSuccess = true;
      for (const a of rows) all.push(a);
    } catch (err) {
      deskMarkFeedError("news", "finnhub_fetch_error");
      logger.warn({ err, sym }, "Desk news fetch failed");
    }
  }

  const articleMaxMs = deskMaxArticlePublishedMs(all);
  if (hadSuccess) {
    deskTouchFeedArticleAge("news", articleMaxMs, "finnhub");
  }
  return { articles: all, asOfMs: articleMaxMs ?? Date.now() };
}
