import { AsyncLocalStorage } from "node:async_hooks";

/** One Polygon REST round-trip recorded during a strategist run (for diagnostics). */
export interface PolygonApiCallRecord {
  path: string;
  method: "GET";
  statusCode: number | null;
  responseTimeMs: number;
  paginationPages?: number;
  retryCountAfter429?: number;
  saw429?: boolean;
  timedOut?: boolean;
}

type TraceStore = { calls: PolygonApiCallRecord[] };

const polygonTraceStorage = new AsyncLocalStorage<TraceStore>();

export function runWithPolygonApiTrace<T>(fn: () => T): T {
  return polygonTraceStorage.run({ calls: [] }, fn);
}

export async function runWithPolygonApiTraceAsync<T>(fn: () => Promise<T>): Promise<T> {
  return polygonTraceStorage.run({ calls: [] }, fn);
}

export function takePolygonApiTrace(): PolygonApiCallRecord[] {
  const s = polygonTraceStorage.getStore();
  return s ? [...s.calls] : [];
}

/** Append one traced Polygon call when inside runWithPolygonApiTrace / Async. */
export function appendPolygonApiTraceRecord(rec: PolygonApiCallRecord): void {
  const s = polygonTraceStorage.getStore();
  if (s) s.calls.push(rec);
}
