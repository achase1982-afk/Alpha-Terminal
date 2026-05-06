import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import type { ScannerV3WireCard } from "@/hooks/useUnifiedScan";
import { emptyScannerCardData } from "./scannerCard.utils";

export type { ScannerV3WireCard };

export function scannerWireCardToScannerCardData(wire: ScannerV3WireCard, scanAt: string): ScannerCardData {
  const sym = wire.symbol.trim().toUpperCase();
  const base = emptyScannerCardData(sym);

  const nextEarnings =
    wire.next_earnings_date != null && wire.days_to_earnings != null && Number.isFinite(wire.days_to_earnings)
      ? {
          date: wire.next_earnings_date,
          daysTo: Math.round(wire.days_to_earnings),
          timing:
            wire.earnings_timing_hint === "BMO" || wire.earnings_timing_hint === "AMC"
              ? wire.earnings_timing_hint
              : null,
        }
      : null;

  const nextExDiv =
    wire.next_ex_dividend_date != null && wire.days_to_ex_dividend != null && Number.isFinite(wire.days_to_ex_dividend)
      ? {
          date: wire.next_ex_dividend_date,
          daysTo: Math.round(wire.days_to_ex_dividend),
          amount: wire.ex_dividend_amount ?? null,
        }
      : null;

  const earningsHistory =
    wire.reactions_last_4q != null &&
    Array.isArray(wire.reactions_last_4q) &&
    wire.reactions_last_4q.length === 4 &&
    wire.reactions_last_4q.every((x) => typeof x === "number" && Number.isFinite(x))
      ? wire.reactions_last_4q.map((pct, i) => ({
          quarter: String(i + 1),
          absMovePct: pct,
        }))
      : null;

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
    nextEarnings,
    nextExDiv,
    earningsHistory,
    lastUpdate: scanAt,
  };
}
