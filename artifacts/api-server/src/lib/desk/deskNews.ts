import { fetchSymbolNews } from "../symbolNewsProvider.js";
import { logger } from "../logger.js";
import { deskTouchFeed, deskMarkFeedError } from "./deskFeedFreshness.js";
import { deskCoercePollReceiptTs } from "./deskFeedTimestamp.js";

export async function deskFetchNews(symbols: string[]): Promise<{ articles: unknown[]; asOfMs: number }> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const all: unknown[] = [];
  let latest = Date.now();

  const pollMs = Date.now();
  let hadSuccess = false;
  let contentLatest = pollMs;
  for (const sym of uniq) {
    try {
      const rows = await fetchSymbolNews(sym, logger);
      hadSuccess = true;
      for (const a of rows) {
        all.push(a);
        if (a.datetime) contentLatest = Math.max(contentLatest, a.datetime * 1000);
      }
    } catch (err) {
      deskMarkFeedError("news", "finnhub_fetch_error");
      logger.warn({ err, sym }, "Desk news fetch failed");
    }
  }

  if (hadSuccess) {
    const touch = Math.max(deskCoercePollReceiptTs(contentLatest, pollMs), pollMs - 30_000);
    deskTouchFeed("news", touch, "finnhub");
    latest = touch;
  }
  return { articles: all, asOfMs: latest };
}