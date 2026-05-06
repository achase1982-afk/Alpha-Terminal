import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import type { ScannerV3WireCard } from "@/hooks/useUnifiedScan";
import { emptyScannerCardData } from "./scannerCard.utils";

export type { ScannerV3WireCard };

export function scannerWireCardToScannerCardData(wire: ScannerV3WireCard, scanAt: string): ScannerCardData {
  const sym = wire.symbol.trim().toUpperCase();
  const base = emptyScannerCardData(sym);
  return {
    ...base,
    name: wire.name,
    sector: wire.sector,
    price: wire.price,
    changeAbs: wire.change_abs,
    changePct: wire.change_pct,
    volume: wire.volume,
    avgVolume20d: wire.avg_volume_20d,
    dayRange: wire.day_range,
    iv30: wire.iv30 ?? null,
    ivr: wire.ivr ?? null,
    hv30: wire.hv30 ?? null,
    ivVsHv: wire.iv_vs_hv ?? null,
    lastUpdate: scanAt,
  };
}
