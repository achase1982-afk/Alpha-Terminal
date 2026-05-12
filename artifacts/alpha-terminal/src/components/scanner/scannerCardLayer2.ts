import type { ScannerCardData, UnifiedScanCandidate } from "@/lib/unifiedScanTypes";
import type { ScannerV3WireCard, ScannerV3WireCardFlow, ScannerV3WireCardTechnical } from "@/lib/scannerScanApiTypes";
import { emptyScannerCardData } from "./scannerCard.utils";

export type { ScannerV3WireCard };

function formatTopStrikeLabelFromStrike(strike: number, optionType: "call" | "put"): string {
  const strikeStr = Number.isInteger(strike) ? String(strike) : strike.toFixed(2).replace(/\.?0+$/, "");
  return `$${strikeStr}${optionType === "call" ? "C" : "P"}`;
}

/** True when at least one Flow 4h row should show a value (not only dashes). */
function hasRenderableScannerFlow(flow: ScannerCardData["flow"]): boolean {
  if (flow == null) return false;
  return (
    (flow.eventsToday != null && Number.isFinite(flow.eventsToday) && flow.eventsToday >= 1) ||
    (flow.blocks4h != null && Number.isFinite(flow.blocks4h)) ||
    (flow.sweeps4h != null && Number.isFinite(flow.sweeps4h)) ||
    (flow.netDeltaDollar != null && Number.isFinite(flow.netDeltaDollar)) ||
    (flow.topStrikeLabel != null && flow.topStrikeLabel.trim().length > 0) ||
    flow.topStrike != null ||
    (flow.volume4h != null && Number.isFinite(flow.volume4h)) ||
    (flow.volumeOverOi != null && Number.isFinite(flow.volumeOverOi))
  );
}

function flowFromV2Snapshot(fs: NonNullable<UnifiedScanCandidate["flowSnapshot"]>): ScannerCardData["flow"] | null {
  const hasSignal =
    fs.topStrike != null ||
    (fs.notional24h != null && fs.notional24h > 0) ||
    (fs.tapeQuality != null && fs.tapeQuality !== "not_run");
  if (!hasSignal) return null;

  const ts = fs.topStrike;
  const topStrikeLabel = ts ? formatTopStrikeLabelFromStrike(ts.strike, ts.type) : null;
  const exp =
    ts && typeof ts.expiry === "string"
      ? ts.expiry.length >= 10
        ? ts.expiry.slice(0, 10)
        : ts.expiry
      : "";

  return {
    blocks4h: null,
    sweeps4h: null,
    netDeltaDollar: null,
    topStrikeLabel,
    topStrike: ts
      ? {
          strike: ts.strike,
          optionType: ts.type,
          expiration: exp,
          volumeAtStrike: 0,
          openInterest: null,
        }
      : null,
    volume4h: null,
    volumeOverOi: null,
    eventsToday: null,
    primaryEventType: null,
    netDirection: "neutral",
    lastEventTs: null,
    sweepCount: null,
    blockCount: null,
    largestEventNotional: null,
  };
}

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

/**
 * Merge `/v2/scan` flowSnapshot into the v3 card when universe `flow` is missing or not
 * renderable (e.g. API used `expiry` on `top_strike` that the mapper dropped).
 */
export function enrichScannerCardFromV2Candidate(
  data: ScannerCardData,
  candidate: UnifiedScanCandidate | undefined,
): ScannerCardData {
  if (!candidate?.flowSnapshot) return data;
  if (hasRenderableScannerFlow(data.flow)) return data;

  const v2flow = flowFromV2Snapshot(candidate.flowSnapshot);
  if (!v2flow) return data;

  const cur = data.flow;
  if (!cur) return { ...data, flow: v2flow };

  return {
    ...data,
    flow: {
      blocks4h: cur.blocks4h ?? v2flow.blocks4h,
      sweeps4h: cur.sweeps4h ?? v2flow.sweeps4h,
      netDeltaDollar: cur.netDeltaDollar ?? v2flow.netDeltaDollar,
      topStrikeLabel: cur.topStrikeLabel ?? v2flow.topStrikeLabel,
      topStrike: cur.topStrike ?? v2flow.topStrike,
      volume4h: cur.volume4h ?? v2flow.volume4h,
      volumeOverOi: cur.volumeOverOi ?? v2flow.volumeOverOi,
      eventsToday: cur.eventsToday ?? v2flow.eventsToday,
      primaryEventType: cur.primaryEventType ?? v2flow.primaryEventType,
      netDirection: cur.netDirection ?? v2flow.netDirection,
      lastEventTs: cur.lastEventTs ?? v2flow.lastEventTs,
      sweepCount: cur.sweepCount ?? v2flow.sweepCount,
      blockCount: cur.blockCount ?? v2flow.blockCount,
      largestEventNotional: cur.largestEventNotional ?? v2flow.largestEventNotional,
    },
  };
}

function mapFlowWire(flow: ScannerV3WireCardFlow | Record<string, unknown> | null | undefined): ScannerCardData["flow"] {
  if (flow == null) return null;
  if (typeof flow !== "object" || Array.isArray(flow)) return null;
  const f = flow as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const blocks4h = num(f.blocks_4h ?? f.blocks4h);
  const sweeps4h = num(f.sweeps_4h ?? f.sweeps4h);
  const netDeltaDollar = num(f.net_delta_dollar ?? f.netDeltaDollar);
  const topStrikeLabel =
    typeof f.top_strike_label === "string"
      ? f.top_strike_label
      : typeof f.topStrikeLabel === "string"
        ? f.topStrikeLabel
        : null;
  const vol4h = num(f.volume_4h ?? f.volume4h);
  const volOi = num(f.volume_over_oi ?? f.volumeOverOi);
  const eventsToday = num(f.events_today ?? f.eventsToday);
  const primaryRaw = f.primary_event_type ?? f.primaryEventType;
  const primaryEventType =
    primaryRaw === "sweep" || primaryRaw === "block" ? primaryRaw : null;
  const netDirRaw = f.net_direction ?? f.netDirection;
  const netDirParsed =
    netDirRaw === "bullish" || netDirRaw === "bearish" || netDirRaw === "mixed" || netDirRaw === "neutral"
      ? netDirRaw
      : null;
  const lastEventTs =
    typeof f.last_event_ts === "string"
      ? f.last_event_ts
      : typeof f.lastEventTs === "string"
        ? f.lastEventTs
        : null;
  const sweepCount = num(f.sweep_count ?? f.sweepCount);
  const blockCount = num(f.block_count ?? f.blockCount);
  const largestEventNotional = num(f.largest_event_notional ?? f.largestEventNotional);

  const eventsTodayInt = eventsToday != null && Number.isFinite(eventsToday) ? Math.trunc(eventsToday) : null;
  const netDirection =
    netDirParsed ??
    (() => {
      const et = eventsTodayInt ?? 0;
      if (et === 0) return "neutral" as const;
      if (netDeltaDollar != null && Number.isFinite(netDeltaDollar)) {
        if (netDeltaDollar > 5000) return "bullish" as const;
        if (netDeltaDollar < -5000) return "bearish" as const;
      }
      return "mixed" as const;
    })();
  const tsRaw = f.top_strike ?? f.topStrike;
  let topStrike: {
    strike: number;
    optionType: "call" | "put";
    expiration: string;
    volumeAtStrike: number;
    openInterest: number | null;
  } | null = null;
  if (tsRaw && typeof tsRaw === "object" && !Array.isArray(tsRaw)) {
    const ts = tsRaw as Record<string, unknown>;
    const strike = num(ts.strike);
    const optionType =
      ts.option_type === "put" || ts.option_type === "call"
        ? ts.option_type
        : ts.optionType === "put" || ts.optionType === "call"
          ? ts.optionType
          : null;
    const expRaw =
      typeof ts.expiration === "string" && ts.expiration.trim()
        ? ts.expiration.trim()
        : typeof ts.expiry === "string" && ts.expiry.trim()
          ? ts.expiry.trim()
          : "";
    const expiration = /^(\d{4}-\d{2}-\d{2})/.test(expRaw) ? expRaw.slice(0, 10) : expRaw;
    const volumeAtStrike = num(ts.volume_at_strike ?? ts.volumeAtStrike);
    const openInterest = num(ts.open_interest ?? ts.openInterest);
    if (strike != null && optionType) {
      topStrike = {
        strike,
        optionType,
        expiration: expiration.length > 0 ? expiration : "",
        volumeAtStrike: volumeAtStrike ?? 0,
        openInterest: openInterest ?? null,
      };
    }
  }

  const hasAny =
    (eventsToday != null && Number.isFinite(eventsToday) && eventsToday >= 1) ||
    (blocks4h != null && Number.isFinite(blocks4h)) ||
    (sweeps4h != null && Number.isFinite(sweeps4h)) ||
    (netDeltaDollar != null && Number.isFinite(netDeltaDollar)) ||
    (topStrikeLabel != null && topStrikeLabel.length > 0) ||
    topStrike != null ||
    (vol4h != null && Number.isFinite(vol4h)) ||
    (volOi != null && Number.isFinite(volOi));

  if (!hasAny) return null;

  return {
    blocks4h,
    sweeps4h,
    netDeltaDollar,
    topStrikeLabel,
    topStrike,
    volume4h: vol4h,
    volumeOverOi: volOi,
    eventsToday: eventsTodayInt,
    primaryEventType,
    netDirection,
    lastEventTs,
    sweepCount,
    blockCount,
    largestEventNotional,
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
