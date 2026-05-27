/** Poll interval (ms) when regular or extended equity session is active. */
export const MOVERS_POLL_INTERVAL_MS = 60 * 1000;

/** Poll interval (ms) when the market is fully closed (no regular / extended session). */
export const MOVERS_POLL_INTERVAL_CLOSED_MS = 15 * 60 * 1000;

/** Manual refresh debounce (ms) — must match api-server `moversConfig`. */
export const MOVERS_MANUAL_REFRESH_DEBOUNCE_MS = 30 * 1000;

/** Minimum market cap (USD) for tradeable movers — Stage 2 strip. */
export const MARKET_CAP_FLOOR = 500_000_000;

/** Minimum average daily volume for tradeable names (shared with Catalysts gate). */
export const AVG_VOLUME_FLOOR = 500_000;

/** Min |% change| to trigger read-path web fallback when FMP headline lacks hard-catalyst keywords. */
export const MOVERS_WEB_FALLBACK_MIN_ABS_CHANGE_PCT = 10;
