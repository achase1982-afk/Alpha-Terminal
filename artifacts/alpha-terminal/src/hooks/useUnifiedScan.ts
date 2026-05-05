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

export interface ScannerV3UniverseResponse {
  tickers: string[];
  scan_at: string;
  count: number;
}

export interface UseUnifiedScanState {
  phase: UnifiedScanPhase;
  candidates: UnifiedScanCandidate[];
  snapshotCompletedAt: string | null;
  snapshotAgeSeconds: number | null;
  stale: boolean | null;
  scanAt: string | null;
  errorMessage: string | null;
  /** Layer 1 — static LC130 universe from GET /api/scanner/v3/universe */
  layer1Universe: ScannerV3UniverseResponse | null;
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
  const [layer1Universe, setLayer1Universe] = useState<ScannerV3UniverseResponse | null>(null);

  const cancelLocal = useCallback(() => {
    setPhase("idle");
    setCandidates([]);
    setSnapshotCompletedAt(null);
    setSnapshotAgeSeconds(null);
    setStale(null);
    setScanAt(null);
    setErrorMessage(null);
    setLayer1Universe(null);
  }, []);

  const startScan = useCallback(async (_universeId: string) => {
    setPhase("scanning");
    setErrorMessage(null);
    setCandidates([]);
    setLayer1Universe(null);
    try {
      const v3Res = await fetchWithAuth(`${API_BASE}/scanner/v3/universe`, { method: "GET" });
      if (v3Res.status === 401) {
        setPhase("error");
        setErrorMessage("Unauthorized — sign in again.");
        return;
      }
      if (!v3Res.ok) {
        const t = await v3Res.text().catch(() => "");
        setPhase("error");
        setErrorMessage(t.trim() || `Scanner v3 error (${v3Res.status}). Please try again.`);
        return;
      }
      const layer1 = (await v3Res.json()) as ScannerV3UniverseResponse;
      const tickers = Array.isArray(layer1.tickers) ? layer1.tickers : [];
      const scan_at =
        typeof layer1.scan_at === "string" ? layer1.scan_at : new Date().toISOString();
      const count =
        typeof layer1.count === "number" && Number.isFinite(layer1.count)
          ? layer1.count
          : tickers.length;
      setLayer1Universe({ tickers, scan_at, count });

      const params = new URLSearchParams({
        universe: _universeId,
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
    layer1Universe,
    startScan,
    cancelLocal,
  };
}
