import {
  deskMarkFeedError,
  deskMarkFeedOkNoNewArticles,
  deskTouchFeedArticleAge,
  deskIsFeedStale,
} from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";
import { deskLoadFinnhubDeskArticles } from "./deskFinnhubDeskNews.js";

/** Desk poller + `/news?source=finnhub`: general market + desk symbols. */
export async function deskFetchNews(symbols: string[]): Promise<{ articles: unknown[]; asOfMs: number }> {
  const { articles: all, hadSuccess } = await deskLoadFinnhubDeskArticles(symbols);
  if (!hadSuccess && all.length === 0) {
    deskMarkFeedError("news", "finnhub_fetch_error");
    return { articles: [], asOfMs: Date.now() };
  }

  const articleMaxMs = deskMaxArticlePublishedMs(all);
  const pollMs = Date.now();
  if (hadSuccess) {
    deskTouchFeedArticleAge("news", articleMaxMs, "finnhub");
    if (articleMaxMs != null && deskIsFeedStale("news", articleMaxMs, pollMs)) {
      const ageSec = Math.round((pollMs - articleMaxMs) / 1000);
      deskMarkFeedOkNoNewArticles(
        "news",
        `finnhub_no_new_articles_age_${ageSec}s`,
        "finnhub",
        articleMaxMs,
      );
    }
  }
  return { articles: all, asOfMs: articleMaxMs ?? pollMs };
}