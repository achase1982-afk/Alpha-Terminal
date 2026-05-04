import type { ScannerStrategistContextPayload } from "./scannerStrategistHandoff.js";

let pending: ScannerStrategistContextPayload | null = null;

export function setPendingScannerStrategistContext(ctx: ScannerStrategistContextPayload | null): void {
  pending = ctx;
}

/** Consume and clear (one-shot for the next /strategist/analyze POST). */
export function takePendingScannerStrategistContext(): ScannerStrategistContextPayload | null {
  const x = pending;
  pending = null;
  return x;
}
