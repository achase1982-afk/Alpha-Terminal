import { CATALYSTS_WINDOW_CALENDAR_DAYS } from "@workspace/catalysts-types";

/**
 * Forward calendar pull for weekly harvest (FMP → corporate_events).
 * 10-day tab display + ~6 day buffer between weekly sweeps.
 */
export const CATALYST_EARNINGS_HARVEST_FORWARD_DAYS = 16;

/** Re-export for harvest horizon alignment with display window. */
export const CATALYSTS_DISPLAY_WINDOW_DAYS = CATALYSTS_WINDOW_CALENDAR_DAYS;
