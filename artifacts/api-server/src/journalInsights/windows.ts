import { ACTIVITY_WINDOW_MS, HISTORY_START_MS, ORDER_WINDOW_MS, SYNC_OVERLAP_MS } from "./types.js";

export interface TimeWindow {
  start: Date;
  end: Date;
}

export function syncRange(input: {
  syncedThrough: string | null;
  backfillComplete: boolean;
  now: Date;
}): TimeWindow & { mode: "backfill" | "incremental" } {
  const end = input.now;
  if (!input.backfillComplete) {
    const resume = input.syncedThrough ? Date.parse(input.syncedThrough) : HISTORY_START_MS;
    return { start: new Date(resume), end, mode: "backfill" };
  }
  const through = input.syncedThrough ? Date.parse(input.syncedThrough) : HISTORY_START_MS;
  const startMs = Math.max(HISTORY_START_MS, through - SYNC_OVERLAP_MS);
  return { start: new Date(startMs), end, mode: "incremental" };
}

export function sliceWindows(start: Date, end: Date, spanMs: number): TimeWindow[] {
  const endMs = end.getTime();
  let cursor = start.getTime();
  if (!(cursor < endMs)) return [];
  const out: TimeWindow[] = [];
  while (cursor < endMs) {
    const next = Math.min(cursor + spanMs, endMs);
    out.push({ start: new Date(cursor), end: new Date(next) });
    cursor = next;
  }
  return out;
}

export function orderWindows(range: TimeWindow): TimeWindow[] {
  return sliceWindows(range.start, range.end, ORDER_WINDOW_MS);
}

export function activityWindows(range: TimeWindow): TimeWindow[] {
  return sliceWindows(range.start, range.end, ACTIVITY_WINDOW_MS);
}
