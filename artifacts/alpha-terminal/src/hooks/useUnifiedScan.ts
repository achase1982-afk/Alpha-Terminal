import { useCallback, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { UnifiedScanCandidate } from "@/lib/unifiedScanTypes";

const API_BASE = "/api";

export type UnifiedScanPhase = "idle" | "scanning" | "complete" | "error";

export interface V2ScanResponse {
  candidates: UnifiedScanCandidate[];
  snapshot_age_seconds: number | null;
  scan_at: string;
}

export interface UseUnifiedScanState {
  phase: UnifiedScanPhase;
  candidates: UnifiedScanCandidate[];
  snapshotAgeSeconds: number | null;
  scanAt: string | null;
  errorMessage: string | null;
  startScan: (universeId: string) => Promise<void>;
  cancelLocal: () => void;
}

export function useUnifiedScan(): UseUnifiedScanState {
  const [phase, setPhase] = useState<UnifiedScanPhase>("idle");
  const [candidates, setCandidates] = useState<UnifiedScanCandidate[]>([]);
  const [snapshotAgeSeconds, setSnapshotAgeSeconds] = useState<number | null>(null);
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cancelLocal = useCallback(() => {
    setPhase("idle");
    setCandidates([]);
    setSnapshotAgeSeconds(null);
    setScanAt(null);
    setErrorMessage(null);
  }, []);

  const startScan = useCallback(async (universeId: string) => {
    setPhase("scanning");
    setErrorMessage(null);
    setCandidates([]);
    try {
      const params = new URLSearchParams({
        universe: universeId,
        limit: "25",
        minScore: "0",
      });
      const res = await fetchWithAuth(`${API_BASE}/v2/scan?${params.toString()}`, { method: "GET" });
      if (res.status === 401) {
        setPhase("error");
        setErrorMessage("Unauthorized — sign in again.");
        return;
      }
      if (res.status === 503) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setPhase("error");
        setErrorMessage(
          typeof j.error === "string" ? j.error : "Scanner refresh stalled. Try again shortly.",
        );
        return;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setPhase("error");
        setErrorMessage(t.trim() || `Server error (${res.status}). Please try again.`);
        return;
      }
      const data = (await res.json()) as V2ScanResponse;
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setSnapshotAgeSeconds(data.snapshot_age_seconds ?? null);
      setScanAt(typeof data.scan_at === "string" ? data.scan_at : new Date().toISOString());
      setPhase("complete");
    } catch {
      setPhase("error");
      setErrorMessage("Network error. Check connection and try again.");
    }
  }, []);

  return {
    phase,
    candidates,
    snapshotAgeSeconds,
    scanAt,
    errorMessage,
    startScan,
    cancelLocal,
  };
}
