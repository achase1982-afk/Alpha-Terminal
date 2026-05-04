import { AsyncLocalStorage } from "node:async_hooks";
import { newStrategistRequestId } from "./strategistDiagnostics.js";

import type { TapeBackfillStatus } from "./strategistTapeBackfill.js";

export type StrategistDiagScratch = {
  tapeBackfillStatus?: TapeBackfillStatus;
  dataPackageStr?: string;
  soloModelLabel?: string;
  nasdaqDepthPresent?: boolean;
  nasdaqDepthLatencyMs?: number | null;
  esContextPresent?: boolean;
  esContextLatencyMs?: number | null;
  cboeOnePresent?: boolean;
  cboeOneLatencyMs?: number | null;
  iseComplexBookPresent?: boolean;
  iseComplexBookLatencyMs?: number | null;
  totalviewPoolSize?: number | null;
  totalviewPoolCapacity?: number | null;
  totalviewWasColdStart?: boolean;
  cboeOnePoolSize?: number | null;
  cboeOnePoolCapacity?: number | null;
  cboeOneWasColdStart?: boolean;
};

/** Async-local scratch for one strategist analyze run (diagnostics + trace correlation). */
export type StrategistRunContext = {
  requestId: string;
  startedAt: number;
  userId: string | null;
  sessionIdentifier: string | null;
  diag: StrategistDiagScratch;
};

const storage = new AsyncLocalStorage<StrategistRunContext>();

export function runInStrategistRunContext<T>(
  opts: { userId?: string | null; sessionIdentifier?: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: StrategistRunContext = {
    requestId: newStrategistRequestId(),
    startedAt: Date.now(),
    userId: opts.userId ?? null,
    sessionIdentifier: opts.sessionIdentifier ?? null,
    diag: {},
  };
  return storage.run(ctx, fn);
}

/** Current async-local strategist run, if inside `runInStrategistRunContext`. */
export function getStrategistRunContext(): StrategistRunContext | undefined {
  return storage.getStore();
}

export function mergeStrategistDiag(patch: Partial<StrategistDiagScratch>): void {
  const c = storage.getStore();
  if (!c) return;
  c.diag = { ...c.diag, ...patch };
}
