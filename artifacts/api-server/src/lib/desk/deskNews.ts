import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
} from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";
import { deskLoadFinnhubDeskArticles } from "./deskFinnhubDeskNews.js";

const FINNHUB_SOURCE = "finnhub";

/** Desk poller + `/news?source=finnhub`: general market + desk symbols. */
export async function deskFetchNews(symbols: string[]): Promise<{ articles: unknown[]; asOfMs: number }> {
  const pollMs = Date.now();
  const { articles: all, hadHttp2xx, lastErrorStatus } = await deskLoadFinnhubDeskArticles(symbols);
  if (!hadHttp2xx) {
    if (lastErrorStatus === 401 || lastErrorStatus === 403) {
      deskMarkFeedAuthError("news", `finnhub_http_${lastErrorStatus}`, FINNHUB_SOURCE);
    } else if (lastErrorStatus === 429) {
      deskMarkFeedError("news", `finnhub_http_${lastErrorStatus}`, FINNHUB_SOURCE);
    } else if (lastErrorStatus && lastErrorStatus > 0) {
      deskMarkFeedError("news", `finnhub_poll_failed_${lastErrorStatus}`, FINNHUB_SOURCE);
    } else {
      deskMarkFeedError("news", "finnhub_fetch_error", FINNHUB_SOURCE);
    }
    return { articles: all, asOfMs: pollMs };
  }

  deskTouchFeedPollOk("news", pollMs, FINNHUB_SOURCE);
  const articleMaxMs = deskMaxArticlePublishedMs(all);
  deskTouchFeedArticleAge("news", articleMaxMs, FINNHUB_SOURCE);
  return { articles: all, asOfMs: articleMaxMs ?? pollMs };
}
