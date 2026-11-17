/** Shared desk background poll interval (Finnhub, Alpaca, UW refresh cadence). */
export const DESK_NEWS_POLL_MS = 90_000;

/** UW route/poller cache TTL — must cover at least one poll cycle plus jitter. */
export const DESK_UW_CACHE_TTL_MS = Math.ceil(DESK_NEWS_POLL_MS * 2.2);
