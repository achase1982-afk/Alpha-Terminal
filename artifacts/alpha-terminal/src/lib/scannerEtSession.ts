/**
 * Client-side ET session helpers for invalidating persisted scanner Layer 1
 * when it can no longer match live `/symbol/.../events` session bounds.
 *
 * Uses Mon–Fri + fixed 09:30–16:00 America/New_York (same coarse rule as server 2C).
 * Exchange holidays are not modeled here; worst case we clear a cached scan once.
 */

export function nyCalendarYmdEt(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Approximate US equity regular session (weekday 09:30–16:00 ET, end exclusive at 16:00). */
export function isApproxUsEquityRthOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function universeSnapshotHasTapeFlow(layer1: {
  cards?: unknown[] | null;
  layer5_flow_hits?: number | null;
}): boolean {
  if (typeof layer1.layer5_flow_hits === "number" && layer1.layer5_flow_hits > 0) return true;
  for (const c of layer1.cards ?? []) {
    if (!c || typeof c !== "object") continue;
    const flow = (c as { flow?: Record<string, unknown> }).flow;
    if (!flow || typeof flow !== "object") continue;
    const et = flow.events_today ?? flow.eventsToday;
    if (typeof et === "number" && Number.isFinite(et) && et >= 1) return true;
    const sw = flow.sweeps_4h ?? flow.sweeps4h;
    const bl = flow.blocks_4h ?? flow.blocks4h;
    if (typeof sw === "number" && sw > 0) return true;
    if (typeof bl === "number" && bl > 0) return true;
  }
  return false;
}

/**
 * True when a persisted universe response should be dropped so the row cannot
 * disagree with a fresh `/symbol/.../events` call (new NY session day, or
 * after-hours while the snapshot still shows intraday tape).
 */
export function shouldInvalidateLayer1Universe(
  layer1: { scan_at?: string; cards?: unknown[] | null; layer5_flow_hits?: number | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!layer1?.scan_at || typeof layer1.scan_at !== "string") return false;
  const scanAt = new Date(layer1.scan_at);
  if (!Number.isFinite(scanAt.getTime())) return false;
  if (nyCalendarYmdEt(scanAt) !== nyCalendarYmdEt(now)) return true;
  if (universeSnapshotHasTapeFlow(layer1) && !isApproxUsEquityRthOpen(now)) return true;
  return false;
}
