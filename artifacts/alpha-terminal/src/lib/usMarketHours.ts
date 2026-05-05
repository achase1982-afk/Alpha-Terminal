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

function readEtClock(d: Date): { weekday: string; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", ET_OPEN_PARTS).formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value ?? "0", 10);
  return { weekday, hour, minute, second };
}

/**
 * Next US regular-session open (9:30:00 America/New_York) strictly after `ref`.
 * Used for session-bounded mute expiry.
 */
export function getNextUsRegularSessionOpenEtIso(ref = new Date()): string {
  const startMs = Math.floor(ref.getTime() / 1000) * 1000;
  const maxSeconds = 14 * 24 * 60 * 60;
  for (let s = 1; s <= maxSeconds; s++) {
    const t = new Date(startMs + s * 1000);
    const { weekday, hour, minute, second } = readEtClock(t);
    if (weekday === "Sat" || weekday === "Sun") continue;
    if (hour === 9 && minute === 30 && second === 0) {
      return t.toISOString();
    }
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
