import { addCalendarDaysNy, nyCalendarYmd, nyOffsetForYmd } from "../usEquityMarketCalendar.js";

export function reportAtIso(earningsDate: string, timing: string | null): string {
  const off = nyOffsetForYmd(earningsDate);
  if (timing === "BMO") {
    return new Date(`${earningsDate}T09:30:00${off}`).toISOString();
  }
  return new Date(`${earningsDate}T16:00:00${off}`).toISOString();
}

/** Inclusive calendar-day window from today through today + windowDays. */
export function isEarningsDateInWindow(earningsDate: string, windowDays: number, now = new Date()): boolean {
  const start = nyCalendarYmd(now);
  const end = addCalendarDaysNy(start, windowDays);
  return earningsDate >= start && earningsDate <= end;
}
