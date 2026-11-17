import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedRateLimited,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
} from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";
import {
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
  | {
      ok: true;
      articles: unknown[];
      asOfMs: number;
      partial?: boolean;
      missing_symbols?: string[];
    }
  | { ok: false; rateLimited: true; retryAfterSec: number };

/** Desk poller + `/news?source=finnhub`: general market + desk symbols. */
export async function deskFetchNews(
  symbols: string[],
  options?: { mode?: DeskFinnhubLoadMode },
): Promise<DeskFetchNewsResult> {
  const pollMs = Date.now();
  const mode = options?.mode ?? "ondemand";
  const load = await deskLoadFinnhubDeskArticles(symbols, mode);
  const {
    articles: all,
    hadHttp2xx,
    lastErrorStatus,
    skippedRateCap,
    clientRateLimited,
    retryAfterSec,
    missingSymbols,
  } = load;

  if (mode === "ondemand" && clientRateLimited && !hadHttp2xx) {
    return { ok: false, rateLimited: true, retryAfterSec: retryAfterSec ?? 1 };
  }

  if (hadHttp2xx) {
    finnhubPollFailureStreak = 0;
    deskTouchFeedPollOk("news", pollMs, FINNHUB_SOURCE);
    const articleMaxMs = deskMaxArticlePublishedMs(all);
    deskTouchFeedArticleAge("news", articleMaxMs, FINNHUB_SOURCE);
    const partial = mode === "ondemand" && Boolean(missingSymbols?.length);
    return {
      ok: true,
      articles: all,
      asOfMs: pollMs,
      ...(partial ? { partial: true, missing_symbols: missingSymbols } : {}),
    };
  }

  const rateSkipNeutral = Boolean(skippedRateCap) && !hadHttp2xx;
  if (rateSkipNeutral) {
    return { ok: true, articles: all, asOfMs: pollMs };
  }

  deskMarkFinnhubPollFailure(lastErrorStatus);
  return { ok: true, articles: all, asOfMs: pollMs };
}