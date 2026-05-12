import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  parseTuningUniverseSelection,
  TUNING_WATCHLIST_SYMBOLS,
  type TuningWatchlist,
} from "@/lib/tuningWatchlistUi";
import { scannerV3UniverseQueryFromSelection } from "@/lib/scannerV3UniverseParams";
import type {
  ScannerV3UniverseResponse,
  ScannerV3WireCard,
  V2ScanResponse,
  UseUnifiedScanState,
} from "@/lib/scannerScanApiTypes";

const API_BASE = "/api";

const PERSIST_KEY = "alpha-terminal-scanner-scan-v1";

function parseSnapshotAge(res: Response): number | null {
  const raw = res.headers.get("X-Scanner-Snapshot-Age-Seconds");
  if (raw == null || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function filterLayer1ForTuningWatchlist(
  layer1: ScannerV3UniverseResponse,
  tuningWl: TuningWatchlist,
): ScannerV3UniverseResponse {
  const order = TUNING_WATCHLIST_SYMBOLS[tuningWl];
  const cardBySym = new Map(
    (Array.isArray(layer1.cards) ? layer1.cards : [])
      .filter((c) => c && typeof c.symbol === "string")
      .map((c) => [c.symbol.trim().toUpperCase(), c] as const),
  );
  const tickers = order.map((s) => s.trim().toUpperCase());
  const cards: ScannerV3WireCard[] = [];
  for (const s of tickers) {
    const c = cardBySym.get(s);
    if (c) cards.push(c);
  }
  return {
    ...layer1,
    tickers,
    count: tickers.length,
    cards,
    universe: `tuning:${tuningWl}`,
  };
}

type ScannerScanStore = UseUnifiedScanState & {
  /** Monotonic guard so stale async completions do not clobber newer runs. */
  _requestSeq: number;
};

const initialResultSlice = {
  candidates: [] as UseUnifiedScanState["candidates"],
  snapshotCompletedAt: null as string | null,
  snapshotAgeSeconds: null as number | null,
  stale: null as boolean | null,
  scanAt: null as string | null,
  tuningWatchlistEcho: undefined as V2ScanResponse["tuning_watchlist"],
  errorMessage: null as string | null,
  layer1Universe: null as ScannerV3UniverseResponse | null,
  lastScanUniverseId: null as string | null,
};

function clearPersistedScanSlice(s: ScannerScanStore): void {
  s.phase = "idle";
  s.candidates = [];
  s.layer1Universe = null;
  s.snapshotCompletedAt = null;
  s.snapshotAgeSeconds = null;
  s.stale = null;
  s.scanAt = null;
  s.tuningWatchlistEcho = undefined;
  s.errorMessage = null;
  s.lastScanUniverseId = null;
}

export const useScannerScanStore = create<ScannerScanStore>()(
  persist(
    (set, get) => ({
      phase: "idle",
      _requestSeq: 0,
      ...initialResultSlice,

      cancelLocal: () => {
        set((s) => ({
          ...s,
          _requestSeq: s._requestSeq + 1,
          phase: "idle",
          ...initialResultSlice,
        }));
      },

      startScan: async (universeId: string) => {
        set((s) => ({
          ...s,
          _requestSeq: s._requestSeq + 1,
          phase: "scanning",
          errorMessage: null,
          candidates: [],
          layer1Universe: null,
          tuningWatchlistEcho: undefined,
          snapshotCompletedAt: null,
          snapshotAgeSeconds: null,
          stale: null,
          scanAt: null,
          lastScanUniverseId: null,
        }));

        const seq = get()._requestSeq;
        const tuningWl = parseTuningUniverseSelection(universeId);

        try {
          const v3UniverseParam = encodeURIComponent(scannerV3UniverseQueryFromSelection(universeId));
          const v3Res = await fetchWithAuth(`${API_BASE}/scanner/v3/universe?universe=${v3UniverseParam}`, {
            method: "GET",
          });
          if (get()._requestSeq !== seq) return;

          if (v3Res.status === 401) {
            set({ phase: "error", errorMessage: "Unauthorized — sign in again." });
            return;
          }
          if (!v3Res.ok) {
            const t = await v3Res.text().catch(() => "");
            if (get()._requestSeq !== seq) return;
            set({
              phase: "error",
              errorMessage: t.trim() || `Scanner v3 error (${v3Res.status}). Please try again.`,
            });
            return;
          }
          const layer1Raw = (await v3Res.json()) as ScannerV3UniverseResponse;
          const tickers = Array.isArray(layer1Raw.tickers) ? layer1Raw.tickers : [];
          const scan_at =
            typeof layer1Raw.scan_at === "string" ? layer1Raw.scan_at : new Date().toISOString();
          const count =
            typeof layer1Raw.count === "number" && Number.isFinite(layer1Raw.count)
              ? layer1Raw.count
              : tickers.length;
          const universeEcho =
            typeof layer1Raw.universe === "string" && layer1Raw.universe.length > 0
              ? layer1Raw.universe
              : scannerV3UniverseQueryFromSelection(universeId);
          const cards = Array.isArray(layer1Raw.cards) ? layer1Raw.cards : undefined;

          let layer1: ScannerV3UniverseResponse = {
            ...layer1Raw,
            tickers,
            scan_at,
            count,
            universe: universeEcho,
            cards,
          };
          if (tuningWl) {
            layer1 = filterLayer1ForTuningWatchlist(layer1, tuningWl);
          }

          if (get()._requestSeq !== seq) return;
          set({ layer1Universe: layer1 });

          const params = new URLSearchParams({
            universe: universeId,
            limit: "25",
            minScore: "0",
          });
          if (tuningWl) {
            params.set("tuning_watchlist", tuningWl);
          }
          const res = await fetchWithAuth(`${API_BASE}/v2/scan?${params.toString()}`, { method: "GET" });
          if (get()._requestSeq !== seq) return;

          if (res.status === 401) {
            set({ phase: "error", errorMessage: "Unauthorized — sign in again." });
            return;
          }
          if (res.status === 503) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            if (get()._requestSeq !== seq) return;
            set({
              phase: "error",
              errorMessage:
                typeof j.error === "string"
                  ? j.error
                  : "Scanner is not ready yet. Try again after the snapshot worker completes its first cycle.",
            });
            return;
          }
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            if (get()._requestSeq !== seq) return;
            set({
              phase: "error",
              errorMessage: t.trim() || `Server error (${res.status}). Please try again.`,
            });
            return;
          }
          const data = (await res.json()) as V2ScanResponse;
          if (get()._requestSeq !== seq) return;

          const completedAt =
            typeof data.snapshot_completed_at === "string"
              ? data.snapshot_completed_at
              : res.headers.get("X-Scanner-Snapshot-At");
          const ageSec =
            typeof data.snapshot_age_seconds === "number" && Number.isFinite(data.snapshot_age_seconds)
              ? data.snapshot_age_seconds
              : parseSnapshotAge(res);
          const staleFlag =
            typeof data.stale === "boolean" ? data.stale : res.headers.get("X-Scanner-Stale") === "true";

          set({
            candidates: Array.isArray(data.candidates) ? data.candidates : [],
            snapshotCompletedAt: completedAt ?? null,
            snapshotAgeSeconds: ageSec,
            stale: typeof staleFlag === "boolean" ? staleFlag : null,
            scanAt: typeof data.scan_at === "string" ? data.scan_at : new Date().toISOString(),
            tuningWatchlistEcho: data.tuning_watchlist,
            phase: "complete",
            lastScanUniverseId: universeId,
          });
        } catch {
          if (get()._requestSeq !== seq) return;
          set({ phase: "error", errorMessage: "Network error. Check connection and try again." });
        }
      },
    }),
    {
      name: PERSIST_KEY,
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        phase: s.phase,
        lastScanUniverseId: s.lastScanUniverseId,
        candidates: s.candidates,
        layer1Universe: s.layer1Universe,
        snapshotCompletedAt: s.snapshotCompletedAt,
        snapshotAgeSeconds: s.snapshotAgeSeconds,
        stale: s.stale,
        scanAt: s.scanAt,
        tuningWatchlistEcho: s.tuningWatchlistEcho,
        errorMessage: s.errorMessage,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.phase === "scanning") {
          clearPersistedScanSlice(state);
        }
        if (state.lastScanUniverseId === undefined) state.lastScanUniverseId = null;
      },
    },
  ),
);
