/**
 * Snapshot of Market Pulse used by the unified scanner so engine scoring matches
 * the legacy deterministic-scan path without importing the ai route module.
 */

export interface ScannerPulseSnapshot {
  composite: number;
  confidence: number;
  bias: string;
  /** ISO time when this snapshot was recorded (pulse generation completed). */
  capturedAt: string;
}

let latest: ScannerPulseSnapshot | null = null;

/** Called from the market-pulse stream when a new pulse is ready (same moment as route cache). */
export function recordPulseSnapshotForScanner(pulse: Record<string, unknown>): void {
  const composite = (pulse["compositeScore"] as number) ?? 0;
  const confidence = (pulse["confidenceScore"] as number) ?? 0;
  const bias = (pulse["bias"] as string) ?? "NO_EDGE";
  latest = {
    composite,
    confidence,
    bias,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Pulse context for scanner engines — mirrors routes/ai deterministic-scan extraction.
 * Returns neutral defaults when no pulse has been generated yet.
 */
export function getSnapshotForUnifiedScannerPulse(): ScannerPulseSnapshot {
  if (!latest) {
    return {
      composite: 0,
      confidence: 0,
      bias: "NO_EDGE",
      capturedAt: new Date().toISOString(),
    };
  }
  return { ...latest };
}
