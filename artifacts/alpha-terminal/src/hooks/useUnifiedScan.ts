import { useCallback, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { UnifiedScanCandidate } from "@/lib/unifiedScanTypes";

const API_BASE = "/api";

/** Maps dropdown preset keys to the `universe` query value for GET /api/scanner/v3/universe. */
const PRESET_KEY_TO_V3_UNIVERSE_QUERY: Record<string, string> = {
  liquidCore130: "liquid-core-130",
  midcap200: "mid-cap-200",
  core383: "core-balanced-383",
  top_tech: "top-tech",
  top_healthcare: "top-healthcare",
  top_financials: "top-financials",
  top_industrials: "top-industrials",
  top_cons_disc: "top-consumer-disc",
  top_comm_svcs: "top-comm-services",
  top_energy: "top-energy",
  top_cons_staples: "top-consumer-staples",
  top_materials: "top-materials",
  top_utilities: "top-utilities",
  top_real_estate: "top-real-estate",
};

export function scannerV3UniverseQueryFromSelection(universeId: string): string {
  if (universeId.startsWith("preset:")) {
    const key = universeId.slice(7);
    return PRESET_KEY_TO_V3_UNIVERSE_QUERY[key] ?? universeId;
  }
  return universeId;
}

export type UnifiedScanPhase = "idle" | "scanning" | "complete" | "error";

export interface V2ScanResponse {
  candidates: UnifiedScanCandidate[];
  snapshot_completed_at: string | null;
  snapshot_age_seconds: number | null;
  stale: boolean | null;
  scan_at: string;
}

/** Layer 2 Schwab batch quote merge — same order as `tickers`. */
export interface ScannerV3WireCard {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  change_abs: number | null;
  change_pct: number | null;
  volume: number | null;
  avg_volume_20d: number | null;
  day_range: { low: number; high: number } | null;
  /** Layer 3 — nulls render as dashes in Vol Context. Optional for older API payloads. */
  iv30?: number | null;
  ivr?: number | null;
  hv30?: number | null;
  iv_vs_hv?: number | null;
  /** Layer 4 catalysts — optional; nulls render as dashes. */
  next_earnings_date?: string | null;
  earnings_timing_hint?: "BMO" | "AMC" | null;
  days_to_earnings?: number | null;
  next_ex_dividend_date?: string | null;
  ex_dividend_amount?: number | null;
  days_to_ex_dividend?: number | null;
  reactions_last_4q?: number[] | null;
}

export interface ScannerV3UniverseResponse {
  tickers: string[];
  scan_at: string;
  count: number;
  /** Echo of the `universe` query param (kebab id or composite `preset:…` / `watchlist:…` / `screen:…`). */
  universe?: string;
  /** Populated when Schwab batch quotes succeed for symbols; otherwise null fields per symbol. */
  cards?: ScannerV3WireCard[];
  /** True when a Schwab access token is available for batch quotes. */
  schwab_access_token_present?: boolean;
  layer2_quote_hits?: number;
  layer3_iv30_hits?: number;
  layer3_hv30_hits?: number;
  layer3_ivr_hits?: number;
  layer4_earnings_hits?: number;
  layer4_ex_div_hits?: number;
  layer4_reactions_hits?: number;
}

export interface UseUnifiedScanState {
  phase: UnifiedScanPhase;
  candidates: UnifiedScanCandidate[];
  snapshotCompletedAt: string | null;
  snapshotAgeSeconds: number | null;
  stale: boolean | null;
  scanAt: string | null;
  errorMessage: string | null;
  /** Layer 1 — ticker list from GET /api/scanner/v3/universe for the selected universe */
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
      const v3UniverseParam = encodeURIComponent(scannerV3UniverseQueryFromSelection(_universeId));
      const v3Res = await fetchWithAuth(`${API_BASE}/scanner/v3/universe?universe=${v3UniverseParam}`, {
        method: "GET",
      });
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
      const universeEcho =
        typeof layer1.universe === "string" && layer1.universe.length > 0
          ? layer1.universe
          : scannerV3UniverseQueryFromSelection(_universeId);
      const cards = Array.isArray(layer1.cards) ? layer1.cards : undefined;
      const schwab_access_token_present =
        typeof layer1.schwab_access_token_present === "boolean"
          ? layer1.schwab_access_token_present
          : undefined;
      const layer2_quote_hits =
        typeof layer1.layer2_quote_hits === "number" && Number.isFinite(layer1.layer2_quote_hits)
          ? layer1.layer2_quote_hits
          : undefined;
      setLayer1Universe({
        tickers,
        scan_at,
        count,
        universe: universeEcho,
        cards,
        schwab_access_token_present,
        layer2_quote_hits,
        layer3_iv30_hits:
          typeof layer1.layer3_iv30_hits === "number" && Number.isFinite(layer1.layer3_iv30_hits)
            ? layer1.layer3_iv30_hits
            : undefined,
        layer3_hv30_hits:
          typeof layer1.layer3_hv30_hits === "number" && Number.isFinite(layer1.layer3_hv30_hits)
            ? layer1.layer3_hv30_hits
            : undefined,
        layer3_ivr_hits:
          typeof layer1.layer3_ivr_hits === "number" && Number.isFinite(layer1.layer3_ivr_hits)
            ? layer1.layer3_ivr_hits
            : undefined,
      });

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
