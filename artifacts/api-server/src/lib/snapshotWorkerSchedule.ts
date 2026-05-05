/**
 * Time windows when `snapshotRefreshWorker` runs refresh cycles (aligned with its interval gate).
 * Outside these windows the worker does not update `scanner_health`, so `/api/v2/scan` must not
 * treat an aging health row as "stalled."
 */
export function isSnapshotWorkerScheduledWindowEt(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const mins = h * 60 + m;
  return mins >= 9 * 60 && mins < 16 * 60 + 30;
}
