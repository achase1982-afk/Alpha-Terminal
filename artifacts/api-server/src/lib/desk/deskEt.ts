import { getMarketContext } from "../getMarketContext.js";
import { nyOffsetForYmd } from "../usEquityMarketCalendar.js";

export const US_EQUITY_TZ = "America/New_York";

export function deskSessionDateEt(now = new Date()): string {
  return getMarketContext(now).tradingDate;
}

/** ISO-8601 instant with explicit America/New_York offset. */
export function deskAsofEtIso(now = new Date()): string {
  const ymd = deskSessionDateEt(now);
  const offset = nyOffsetForYmd(ymd);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: US_EQUITY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((a, p) => {
      if (p.type !== "literal") a[p.type] = p.value;
      return a;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export function deskEtMinutesOfDay(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: US_EQUITY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((a, p) => {
      if (p.type !== "literal") a[p.type] = p.value;
      return a;
    }, {});
  return +parts.hour! * 3600 + +parts.minute! * 60 + +parts.second!;
}

/** Inclusive window [start, end] as HH:MM:SS in ET. */
export function deskInEtTimeWindow(
  start: string,
  end: string,
  now = new Date(),
): boolean {
  const toSec = (hms: string) => {
    const [h, m, s] = hms.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };
  const t = deskEtMinutesOfDay(now);
  return t >= toSec(start) && t <= toSec(end);
}

export function deskIsNyWeekday(now = new Date()): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: US_EQUITY_TZ, weekday: "short" }).format(now);
  return wd !== "Sat" && wd !== "Sun";
}