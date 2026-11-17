import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedRateLimited,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
} from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";
import {
  DeskFinnhubClientRateLimitError,
  deskLoadFinnhubDeskArticles,
  type DeskFinnhubLoadMode,
} from "./deskFinnhubDeskNews.js";

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

export type DeskFetchNewsResult =
  | { ok: true; articles: unknown[]; asOfMs: number }
  | { ok: false; rateLimited: true; retryAfterSec: number };

/** Desk poller + `/news?source=finnhub`: general market + desk symbols. */
export async function deskFetchNews(
  symbols: string[],
  options?: { mode?: DeskFinnhubLoadMode },
): Promise<DeskFetchNewsResult> {
  const pollMs = Date.now();
  const mode = options?.mode ?? "ondemand";
  let load: Awaited<ReturnType<typeof deskLoadFinnhubDeskArticles>>;
  try {
    load = await deskLoadFinnhubDeskArticles(symbols, mode);
  } catch (err) {
    if (err instanceof DeskFinnhubClientRateLimitError) {
      deskMarkFeedRateLimited("news", "finnhub_client_rate_limited", FINNHUB_SOURCE);
      return { ok: false, rateLimited: true, retryAfterSec: err.retryAfterSec };
    }
    throw err;
  }
  const { articles: all, hadHttp2xx, lastErrorStatus, skippedRateCap, retryAfterSec } = load;
  if (skippedRateCap && mode === "ondemand" && lastErrorStatus === 429) {
    deskMarkFeedRateLimited("news", "finnhub_client_rate_limited", FINNHUB_SOURCE);
    return { ok: false, rateLimited: true, retryAfterSec: retryAfterSec ?? 1 };
  }
  if (skippedRateCap && mode === "background") {
    return { ok: true, articles: all, asOfMs: pollMs };
  }
  if (!hadHttp2xx) {
    deskMarkFinnhubPollFailure(lastErrorStatus);
    return { ok: true, articles: all, asOfMs: pollMs };
  }

  finnhubPollFailureStreak = 0;
  deskTouchFeedPollOk("news", pollMs, FINNHUB_SOURCE);
  const articleMaxMs = deskMaxArticlePublishedMs(all);
  deskTouchFeedArticleAge("news", articleMaxMs, FINNHUB_SOURCE);
  return { ok: true, articles: all, asOfMs: pollMs };
}
