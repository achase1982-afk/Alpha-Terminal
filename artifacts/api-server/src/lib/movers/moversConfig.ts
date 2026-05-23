export {
  MOVERS_MANUAL_REFRESH_DEBOUNCE_MS,
  MOVERS_POLL_INTERVAL_MS,
} from "@workspace/movers-types";

/** Minimum price for survivors (Stage 1 strip). */
export const PRICE_FLOOR = 5;

/** Minimum market cap for survivors (Stage 2 — not applied in Stage 1). */
export const MARKET_CAP_FLOOR_USD = 500_000_000;

/** Rows retained in movers_feed after each insert. */
export const MOVERS_FEED_RETENTION = 50;
