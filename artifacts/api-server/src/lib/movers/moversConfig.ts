export {
  MARKET_CAP_FLOOR,
  MOVERS_MANUAL_REFRESH_DEBOUNCE_MS,
  MOVERS_POLL_INTERVAL_MS,
} from "@workspace/movers-types";

/** Minimum price for survivors (Stage 1 strip). */
export const PRICE_FLOOR = 5;

/** Rows retained in movers_feed after each insert. */
export const MOVERS_FEED_RETENTION = 50;

export { MOVERS_THEME_KEYWORDS } from "./moversThemeKeywords.js";
