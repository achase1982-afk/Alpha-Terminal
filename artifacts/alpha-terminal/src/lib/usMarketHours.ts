/**
 * US equities regular session (simple ET clock): Mon–Fri, 9:30 AM–4:00 PM America/New_York.
 */
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
