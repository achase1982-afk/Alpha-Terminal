import { DESK_NEWS_POLL_MS } from "./deskPollCadence.js";
import {
  deskGetFeedLastPollOkMs,
  deskMarkFeedError,
  deskMarkFeedOkNoNewArticles,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
  deskIsFeedStale,
} from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";
import { deskLoadFinnhubDeskArticles } from "./deskFinnhubDeskNews.js";

/** Finnhub `ok_no_new_articles` only when a 2xx poll happened within ~2 poll intervals. */
const OK_NO_NEW_POLL_MS = DESK_NEWS_POLL_MS * 2 + 5_000;

/** Desk poller + `/news?source=finnhub`: general market + desk symbols. */
export async function deskFetchNews(symbols: string[]): Promise<{ articles: unknown[]; asOfMs: number }> {
  const pollMs = Date.now();
  const { articles: all, hadHttp2xx, lastErrorStatus } = await deskLoadFinnhubDeskArticles(symbols);
  if (!hadHttp2xx) {
    if (lastErrorStatus && lastErrorStatus > 0) {
      deskMarkFeedError("news", `finnhub_poll_failed_${lastErrorStatus}`);
    } else {
      deskMarkFeedError("news", "finnhub_fetch_error");
    }
    return { articles: all, asOfMs: pollMs };
  }

  deskTouchFeedPollOk("news", pollMs, "finnhub");
  const articleMaxMs = deskMaxArticlePublishedMs(all);
  deskTouchFeedArticleAge("news", articleMaxMs, "finnhub");

  const lastPollOk = deskGetFeedLastPollOkMs("news");
  const pollFresh = lastPollOk != null && pollMs - lastPollOk <= OK_NO_NEW_POLL_MS;
  if (pollFresh && articleMaxMs != null && deskIsFeedStale("news", articleMaxMs, pollMs)) {
    const ageSec = Math.round((pollMs - articleMaxMs) / 1000);
    deskMarkFeedOkNoNewArticles(
      "news",
      `finnhub_no_new_articles_age_${ageSec}s`,
      "finnhub",
      articleMaxMs,
    );
  }

  return { articles: all, asOfMs: articleMaxMs ?? pollMs };
}