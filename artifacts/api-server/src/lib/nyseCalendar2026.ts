/**
 * Static NYSE calendar slices for deterministic session logic.
 * Full-day holidays are derived from the shared civil calendar; early-close days are listed explicitly.
 * Update annually (flag in repo maintenance notes).
 */
import { getHolidaysForYear } from "./usEquityMarketCalendar.js";

/** Full-day NYSE/NASDAQ closures in 2026 (America/New_York YYYY-MM-DD). */
export const NYSE_HOLIDAYS_2026: string[] = getHolidaysForYear(2026);

/** Regular session ends 13:00 ET on these 2026 dates. */
export const NYSE_EARLY_CLOSE_2026: string[] = [
  "2026-11-27",
  "2026-12-24",
];
