import { getMarketContext, type MarketSessionLabel } from "../getMarketContext.js";
import {
  MOVERS_POLL_INTERVAL_CLOSED_MS,
  MOVERS_POLL_INTERVAL_MS,
} from "./moversConfig.js";

export function isExtendedEquitySessionActive(session: MarketSessionLabel): boolean {
  return session === "OPEN" || session === "PREMARKET" || session === "AFTERHOURS";
}

/** Poll delay for the next cycle based on US equity session (calendar). */
export function moversPollIntervalMs(now = new Date()): number {
  const session = getMarketContext(now).session;
  return isExtendedEquitySessionActive(session)
    ? MOVERS_POLL_INTERVAL_MS
    : MOVERS_POLL_INTERVAL_CLOSED_MS;
}
