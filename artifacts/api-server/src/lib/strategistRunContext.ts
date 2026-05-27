import { AsyncLocalStorage } from "node:async_hooks";
import { newStrategistRequestId } from "./strategistDiagnostics.js";

import type { TapeBackfillStatus } from "./strategistTapeBackfill.js";
import type { ScannerStrategistContext } from "./scannerStrategistContext.js";
import type { MarketContext } from "./getMarketContext.js";
import type { DatasetFreshnessMeta } from "./datasetFreshness.js";

export type StrategistDiagScratch = {
  tapeBackfillStatus?: TapeBackfillStatus;
  dataPackageStr?: string;
  soloModelLabel?: string;
  closingImbalancePresent?: boolean;
  closingImbalanceLatencyMs?: number | null;
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
  /** JSON-safe snapshots of provider SDK request payloads for strategist LLM calls (same order as turns). */
  modelSdkInputs?: unknown[];
  /** Conviction Desk per-attempt usage + web search counts (mirrors fullDiagnostic). */
  convictionDeskProviderTelemetry?: Array<Record<string, unknown>>;
  /** Deterministic session clock for this analyze run. */
  marketTimeContext?: MarketContext;
  /** Per-dataset asOf/origin captured when the data package was built. */
  datasetFreshness?: Record<string, DatasetFreshnessMeta>;
}

/** Async-local scratch for one strategist analyze run (diagnostics + trace correlation). */
export type StrategistRunContext = {
  requestId: string;
  startedAt: number;
  userId: string | null;
  sessionIdentifier: string | null;
  /** Client IANA timezone from analyze request (display clock). */
  clientTimeZone: string;
  diag: StrategistDiagScratch;
  /** Optional handoff from Alpha Terminal scanner → strategist analyze. */
  scannerContext?: ScannerStrategistContext | null;
  /** V3 worker: queue telemetry inserts until persistAndComplete post-commit. */
  deferTelemetryUntilPersist?: boolean;
  /** Captured telemetry args when deferTelemetryUntilPersist is true (last write wins). */
  pendingTelemetryCapture?: Record<string, unknown> | null;
};

const storage = new AsyncLocalStorage<StrategistRunContext>();

export function runInStrategistRunContext<T>(
  opts: {
    userId?: string | null;
    sessionIdentifier?: string | null;
    scannerContext?: ScannerStrategistContext | null;
    clientTimeZone?: string | null;
    deferTelemetryUntilPersist?: boolean;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: StrategistRunContext = {
    requestId: newStrategistRequestId(),
    startedAt: Date.now(),
    userId: opts.userId ?? null,
    sessionIdentifier: opts.sessionIdentifier ?? null,
    clientTimeZone:
      typeof opts.clientTimeZone === "string" && opts.clientTimeZone.trim().length > 0
        ? opts.clientTimeZone.trim()
        : "America/New_York",
    diag: {},
    scannerContext: opts.scannerContext ?? null,
    deferTelemetryUntilPersist: opts.deferTelemetryUntilPersist === true,
    pendingTelemetryCapture: null,
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
