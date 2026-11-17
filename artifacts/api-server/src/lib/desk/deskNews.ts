import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedRateLimited,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
} from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";
import { deskLoadFinnhubDeskArticles } from "./deskFinnhubDeskNews.js";

const FINNHUB_SOURCE = "finnhub";

/** Consecutive Finnhub poll cycles with zero HTTP 2xx (background + on-demand). */
let finnhubPollFailureStreak = 0;

export function deskResetFinnhubPollFailureStreakForTests(): void {
  finnhubPollFailureStreak = 0;
}

function deskMarkFinnhubPollFailure(lastErrorStatus?: number): void {
  if (lastErrorStatus === 401 || lastErrorStatus === 403) {
    finnhubPollFailureStreak = 0;
    deskMarkFeedAuthError("news", `finnhub_http_${lastErrorStatus}`, FINNHUB_SOURCE);
    return;
  }
  if (lastErrorStatus === 429) {
    finnhubPollFailureStreak = 0;
    deskMarkFeedRateLimited("news", `finnhub_http_${lastErrorStatus}`, FINNHUB_SOURCE);
    return;
  }
  finnhubPollFailureStreak += 1;
  if (finnhubPollFailureStreak < 2) return;
  if (lastErrorStatus && lastErrorStatus > 0) {
    deskMarkFeedError("news", `finnhub_poll_failed_${lastErrorStatus}`, FINNHUB_SOURCE);
  } else {
    deskMarkFeedError("news", "finnhub_fetch_error", FINNHUB_SOURCE);
  }
}

/** Desk poller + `/news?source=finnhub`: general market + desk symbols. */
export async function deskFetchNews(symbols: string[]): Promise<{ articles: unknown[]; asOfMs: number }> {
  const pollMs = Date.now();
  const { articles: all, hadHttp2xx, lastErrorStatus } = await deskLoadFinnhubDeskArticles(symbols);
  if (!hadHttp2xx) {
    deskMarkFinnhubPollFailure(lastErrorStatus);
    return { articles: all, asOfMs: pollMs };
  }

  finnhubPollFailureStreak = 0;
  deskTouchFeedPollOk("news", pollMs, FINNHUB_SOURCE);
  const articleMaxMs = deskMaxArticlePublishedMs(all);
  deskTouchFeedArticleAge("news", articleMaxMs, FINNHUB_SOURCE);
  return { articles: all, asOfMs: pollMs };
}
