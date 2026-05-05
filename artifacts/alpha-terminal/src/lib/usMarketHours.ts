/**
 * US equities regular session (simple ET clock): Mon–Fri, 9:30 AM–4:00 PM America/New_York.
 */

const ET_OPEN_PARTS: Intl.DateTimeFormatOptions = {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hour12: false,
};

/** Single cached formatter — constructing `Intl.DateTimeFormat` per call is very expensive. */
const etOpenFormatter = new Intl.DateTimeFormat("en-US", ET_OPEN_PARTS);

function readEtClock(d: Date): { weekday: string; hour: number; minute: number; second: number } {
  const parts = etOpenFormatter.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value ?? "0", 10);
  return { weekday, hour, minute, second };
}

const ET_DATE_TIME_PARTS: Intl.DateTimeFormatOptions = {
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hour12: false,
};

const etDateTimeFormatter = new Intl.DateTimeFormat("en-US", ET_DATE_TIME_PARTS);

function readEtDateTime(d: Date): {
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = etDateTimeFormatter.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const year = parseInt(parts.find((p) => p.type === "year")?.value ?? "0", 10);
  const month = parseInt(parts.find((p) => p.type === "month")?.value ?? "0", 10);
  const day = parseInt(parts.find((p) => p.type === "day")?.value ?? "0", 10);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value ?? "0", 10);
  return { weekday, year, month, day, hour, minute, second };
}

function cmpEtYmdHms(
  a: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): number {
  if (a.year !== y) return a.year - y;
  if (a.month !== m) return a.month - m;
  if (a.day !== d) return a.day - d;
  if (a.hour !== h) return a.hour - h;
  if (a.minute !== mi) return a.minute - mi;
  return a.second - s;
}

/** UTC millis for the instant that is `y-m-d h:mi:s` in America/New_York (unique for session open times). */
function utcMillisForEtWallClock(y: number, m: number, d: number, h: number, mi: number, s: number): number {
  let lo = Date.UTC(y, m - 1, d - 1, 12, 0, 0);
  let hi = Date.UTC(y, m - 1, d + 2, 12, 0, 0);
  for (let i = 0; i < 50; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const p = readEtDateTime(new Date(mid));
    if (cmpEtYmdHms(p, y, m, d, h, mi, s) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function addGregorianDays(y: number, month: number, day: number, delta: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, month - 1, day + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Next US regular-session open (9:30:00 America/New_York) strictly after `ref`.
 * Used for session-bounded mute expiry.
 */
export function getNextUsRegularSessionOpenEtIso(ref = new Date()): string {
  const startMs = Math.floor(ref.getTime() / 1000) * 1000;
  const minUtcMs = startMs + 1000;
  const { year: y0, month: m0, day: d0 } = readEtDateTime(new Date(startMs));
  for (let i = 0; i <= 14; i++) {
    const { y, m, d } = addGregorianDays(y0, m0, d0, i);
    const utcMs = utcMillisForEtWallClock(y, m, d, 9, 30, 0);
    if (utcMs < minUtcMs) continue;
    const { weekday } = readEtClock(new Date(utcMs));
    if (weekday === "Sat" || weekday === "Sun") continue;
    return new Date(utcMs).toISOString();
  }
  return new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
}

export function isUsEquitiesMarketHoursEt(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const mins = h * 60 + m;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins < close;
}
