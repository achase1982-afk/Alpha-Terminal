/** Unconditional poll interval (ms) — must match api-server `moversConfig`. */
export const MOVERS_POLL_INTERVAL_MS = 60 * 1000;

/** Manual refresh debounce (ms) — must match api-server `moversConfig`. */
export const MOVERS_MANUAL_REFRESH_DEBOUNCE_MS = 30 * 1000;

/** Minimum market cap (USD) for tradeable movers — Stage 2 strip. */
export const MARKET_CAP_FLOOR = 500_000_000;
