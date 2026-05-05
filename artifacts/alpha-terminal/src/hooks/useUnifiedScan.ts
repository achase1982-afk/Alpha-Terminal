import { useCallback, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { UnifiedScanCandidate } from "@/lib/unifiedScanTypes";

const API_BASE = "/api";

export type UnifiedScanPhase = "idle" | "scanning" | "complete" | "error";

export interface V2ScanResponse {
  candidates: UnifiedScanCandidate[];
  snapshot_completed_at: string | null;
  snapshot_age_seconds: number | null;
  stale: boolean | null;
  scan_at: string;
}

export interface UseUnifiedScanState {
  phase: UnifiedScanPhase;
  candidates: UnifiedScanCandidate[];
  snapshotCompletedAt: string | null;
  snapshotAgeSeconds: number | null;
  stale: boolean | null;
  scanAt: string | null;
  errorMessage: string | null;
  startScan: (universeId: string) => Promise<void>;
  cancelLocal: () => void;
}

function parseSnapshotAge(res: Response): number | null {
  const raw = res.headers.get("X-Scanner-Snapshot-Age-Seconds");
  if (raw == null || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function useUnifiedScan(): UseUnifiedScanState {
  const [phase, setPhase] = useState<UnifiedScanPhase>("idle");
  const [candidates, setCandidates] = useState<UnifiedScanCandidate[]>([]);
  const [snapshotCompletedAt, setSnapshotCompletedAt] = useState<string | null>(null);
  const [snapshotAgeSeconds, setSnapshotAgeSeconds] = useState<number | null>(null);
  const [stale, setStale] = useState<boolean | null>(null);
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cancelLocal = useCallback(() => {
    setPhase("idle");
    setCandidates([]);
    setSnapshotCompletedAt(null);
    setSnapshotAgeSeconds(null);
    setStale(null);
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
          typeof j.error === "string"
            ? j.error
            : "Scanner is not ready yet. Try again after the snapshot worker completes its first cycle.",
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
      const completedAt =
        typeof data.snapshot_completed_at === "string"
          ? data.snapshot_completed_at
          : res.headers.get("X-Scanner-Snapshot-At");
      const ageSec =
        typeof data.snapshot_age_seconds === "number" && Number.isFinite(data.snapshot_age_seconds)
          ? data.snapshot_age_seconds
          : parseSnapshotAge(res);
      const staleFlag =
        typeof data.stale === "boolean"
          ? data.stale
          : res.headers.get("X-Scanner-Stale") === "true";

      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setSnapshotCompletedAt(completedAt ?? null);
      setSnapshotAgeSeconds(ageSec);
      setStale(typeof staleFlag === "boolean" ? staleFlag : null);
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
    snapshotCompletedAt,
    snapshotAgeSeconds,
    stale,
    scanAt,
    errorMessage,
    startScan,
    cancelLocal,
  };
}
