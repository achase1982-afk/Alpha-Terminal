/**
 * Scanner Layer 5 + symbol-events: one RTH session-to-date window (America/New_York).
 * Fixed 09:30–16:00 ET (no early-close adjustment here — follow-up per product spec 2C).
 */

import { isNyTradingSessionDate } from "./polygonMarketCalendar.js";
import { nyCalendarYmd, nyOffsetForYmd } from "./usEquityMarketCalendar.js";

export type ScannerRthSessionInactiveReason =
  | "not_trading_day"
  | "before_open"
  | "after_rth";

export type ScannerRthSessionWindow =
  | { active: false; reason: ScannerRthSessionInactiveReason }
  | {
      active: true;
      sessionDateEtYmd: string;
      /** Inclusive lower bound (09:30 ET session open). */
      startIso: string;
      /** Inclusive upper bound: min(now, 16:00 ET) while in RTH; at/after official close, inactive. */
      endIso: string;
    };

function rthOpenCloseMs(sessionYmd: string): { openMs: number; closeMs: number } {
  const off = nyOffsetForYmd(sessionYmd);
  const openMs = new Date(`${sessionYmd}T09:30:00${off}`).getTime();
  const closeMs = new Date(`${sessionYmd}T16:00:00${off}`).getTime();
  return { openMs, closeMs };
}

/**
 * Session-to-date for the **current** NY calendar date: prints with timestamp in
 * [09:30 ET, min(now, 16:00 ET)] on regular session days, only while now is inside that interval.
 * Outside RTH or on non-session days → inactive (no flow window).
 */
export async function getScannerRthSessionToDateWindow(now: Date = new Date()): Promise<ScannerRthSessionWindow> {
  const ymd = nyCalendarYmd(now);
  if (!(await isNyTradingSessionDate(ymd))) {
    return { active: false, reason: "not_trading_day" };
  }
  const { openMs, closeMs } = rthOpenCloseMs(ymd);
  const t = now.getTime();
  if (t < openMs) return { active: false, reason: "before_open" };
  if (t >= closeMs) return { active: false, reason: "after_rth" };
  const endMs = Math.min(t, closeMs);
  return {
    active: true,
    sessionDateEtYmd: ymd,
    startIso: new Date(openMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}
