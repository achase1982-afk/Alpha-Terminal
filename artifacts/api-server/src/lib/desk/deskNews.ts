import { fetchSymbolNews } from "../symbolNewsProvider.js";
import { logger } from "../logger.js";
import { deskTouchFeed, deskMarkFeedError } from "./deskFeedFreshness.js";

export async function deskFetchNews(symbols: string[]): Promise<{ articles: unknown[]; asOfMs: number }> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const all: unknown[] = [];
  let latest = Date.now();

  for (const sym of uniq) {
    try {
      const rows = await fetchSymbolNews(sym, logger);
      for (const a of rows) {
        all.push(a);
        if (a.datetime) latest = Math.max(latest, a.datetime * 1000);
      }
    } catch (err) {
      deskMarkFeedError("news", "finnhub_fetch_error");
      logger.warn({ err, sym }, "Desk news fetch failed");
    }
  }

  if (all.length) deskTouchFeed("news");
  return { articles: all, asOfMs: latest };
}