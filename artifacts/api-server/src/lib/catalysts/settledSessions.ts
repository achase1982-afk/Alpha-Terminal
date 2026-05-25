import {
  addCalendarDaysNy,
  isNyTradingSessionDateSync,
  nyCalendarYmd,
  nyOffsetForYmd,
} from "../usEquityMarketCalendar.js";

/** True when the NY calendar instant is at or after 4:00 PM ET (settled daily bar). */
export function isAtOrAfterNyRegularClose(now = new Date()): boolean {
  const ymd = nyCalendarYmd(now);
  const off = nyOffsetForYmd(ymd);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const probe = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`);
  const closeMs = new Date(`${ymd}T16:00:00${off}`).getTime();
  return probe.getTime() >= closeMs;
}

/** Most recent settled 4:00 PM ET session date (YYYY-MM-DD). */
export function lastSettledSessionYmd(now = new Date()): string {
  let ymd = nyCalendarYmd(now);
  if (!isAtOrAfterNyRegularClose(now)) {
    ymd = addCalendarDaysNy(ymd, -1);
  }
  for (let guard = 0; guard < 14; guard++) {
    if (isNyTradingSessionDateSync(ymd)) return ymd;
    ymd = addCalendarDaysNy(ymd, -1);
  }
  return ymd;
}

/** `count` settled session dates ending at `endYmd` inclusive (oldest first). */
export function settledSessionYmdsEndingAt(endYmd: string, count: number): string[] {
  const out: string[] = [];
  let ymd = endYmd;
  for (let guard = 0; guard < 400 && out.length < count; guard++) {
    if (isNyTradingSessionDateSync(ymd)) out.unshift(ymd);
    ymd = addCalendarDaysNy(ymd, -1);
  }
  return out;
}
