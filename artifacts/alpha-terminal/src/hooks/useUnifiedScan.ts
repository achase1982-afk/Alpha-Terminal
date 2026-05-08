import { useShallow } from "zustand/react/shallow";
import { useScannerScanStore } from "@/stores/scannerScanStore";
import type { UseUnifiedScanState } from "@/lib/scannerScanApiTypes";

export type {
  UnifiedScanPhase,
  V2ScanResponse,
  ScannerV3WireCard,
  ScannerV3WireCardFlow,
  ScannerV3WireCardTechnical,
  ScannerV3UniverseResponse,
} from "@/lib/scannerScanApiTypes";

export { scannerV3UniverseQueryFromSelection } from "@/lib/scannerV3UniverseParams";

export function useUnifiedScan(): UseUnifiedScanState {
  return useScannerScanStore(
    useShallow((s) => ({
      phase: s.phase,
      candidates: s.candidates,
      snapshotCompletedAt: s.snapshotCompletedAt,
      snapshotAgeSeconds: s.snapshotAgeSeconds,
      stale: s.stale,
      scanAt: s.scanAt,
      tuningWatchlistEcho: s.tuningWatchlistEcho,
      errorMessage: s.errorMessage,
      layer1Universe: s.layer1Universe,
      startScan: s.startScan,
      cancelLocal: s.cancelLocal,
    })),
  );
}
