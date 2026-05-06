import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import type { ScannerV3WireCard, ScannerV3WireCardFlow, ScannerV3WireCardTechnical } from "@/hooks/useUnifiedScan";
import { emptyScannerCardData } from "./scannerCard.utils";

export type { ScannerV3WireCard };

function mapTechnicalWire(t: ScannerV3WireCardTechnical | null | undefined): ScannerCardData["technical"] {
  if (t == null) return null;
  return {
    fiftyTwoWeekLow: t.fifty_two_week_low ?? null,
    fiftyTwoWeekHigh: t.fifty_two_week_high ?? null,
    offFiftyTwoWeekHighPct: t.off_fifty_two_week_high_pct ?? null,
    vsTwentyMaPct: t.vs_twenty_ma_pct ?? null,
    vsFiftyMaPct: t.vs_fifty_ma_pct ?? null,
    vsTwoHundredMaPct: t.vs_two_hundred_ma_pct ?? null,
    fiveDayReturnPct: t.five_day_return_pct ?? null,
    thirtyDayReturnPct: t.thirty_day_return_pct ?? null,
  };
}

function mapFlowWire(flow: ScannerV3WireCardFlow | null | undefined): ScannerCardData["flow"] {
  if (flow == null) return null;
  const ts = flow.top_strike;
  return {
    blocks4h: flow.blocks_4h,
    sweeps4h: flow.sweeps_4h,
    netDeltaDollar: flow.net_delta_dollar,
    topStrikeLabel: flow.top_strike_label,
    topStrike: ts
      ? {
          strike: ts.strike,
          optionType: ts.option_type,
          expiration: ts.expiration,
          volumeAtStrike: ts.volume_at_strike,
          openInterest: ts.open_interest,
        }
      : null,
    volume4h: flow.volume_4h,
    volumeOverOi: flow.volume_over_oi,
  };
}

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
    flow: mapFlowWire(wire.flow),
    technical: mapTechnicalWire(wire.technical),
    score: wire.score ?? null,
    scoreComponents: wire.score_components
      ? {
          liquidity: wire.score_components.liquidity ?? null,
          volContext: wire.score_components.vol_context ?? null,
          catalyst: wire.score_components.catalyst ?? null,
          flow: wire.score_components.flow ?? null,
          technical: wire.score_components.technical ?? null,
        }
      : null,
    matchedPreset: wire.matched_preset?.trim() ? wire.matched_preset.trim() : null,
    lastUpdate: scanAt,
  };
}
