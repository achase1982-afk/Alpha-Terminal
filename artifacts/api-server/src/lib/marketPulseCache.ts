/**
 * Snapshot of Market Pulse used by the unified scanner and AI chat tools.
 */

export interface ScannerPulseSnapshot {
  composite: number;
  confidence: number;
  bias: string;
  /** ISO time when this snapshot was recorded (pulse generation completed). */
  capturedAt: string;
}

let latest: ScannerPulseSnapshot | null = null;
let latestFullPulse: Record<string, unknown> | null = null;
let latestFullPulseAt = 0;

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
  latestFullPulse = pulse;
  latestFullPulseAt = Date.now();
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

/** Latest Market Pulse v2.6 payload for chat `get_market_pulse` (2h TTL). */
export function getLatestMarketPulseForChat(): {
  status: "ready" | "none" | "stale";
  pulse: Record<string, unknown> | null;
  capturedAt: string | null;
} {
  const maxAgeMs = 2 * 60 * 60 * 1000;
  if (!latestFullPulse || Date.now() - latestFullPulseAt > maxAgeMs) {
    return { status: latestFullPulse ? "stale" : "none", pulse: null, capturedAt: null };
  }
  return {
    status: "ready",
    pulse: latestFullPulse,
    capturedAt: latest?.capturedAt ?? new Date(latestFullPulseAt).toISOString(),
  };
}
