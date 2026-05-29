/**
 * Buy-side tape signals [T] for streetVsTape. Deterministic; model never computes these.
 */

import type { FlowBias, TapeVerdict } from "./strategistFullReport/types.js";

export type TapeSignalInput = {
  signalPrice: number;
  dailyChangePct: number;
  putCallVolumeRatio: number | null;
  residualZ: number | null;
  shortStrike: number | null;
  supportLevel?: number | null;
};

export type TapeSignalSnapshot = {
  eventGapPct: number | null;
  lowSinceEvent: number | null;
  reclaimRatio: number | null;
  daysAboveSupport: number | null;
  volumeConfirms: boolean | null;
  upDownVolumeRatio: number | null;
  flowBias: FlowBias;
  pcRatio: number | null;
  netPremium: string | null;
  oiBuildStrike: string | null;
  shortInterestPct: number | null;
  shortTrend: "rising" | "falling" | "flat" | null;
  residualZ: number | null;
  tapeVerdict: TapeVerdict;
};

function classifyFlowBias(pc: number | null): FlowBias {
  if (pc == null || !Number.isFinite(pc)) return "mixed";
  if (pc < 0.7) return "call-buy/put-sell";
  if (pc > 1.3) return "put-buy/call-sell";
  return "mixed";
}

function classifyTapeVerdict(args: {
  flowBias: FlowBias;
  dailyChangePct: number;
  residualZ: number | null;
  pc: number | null;
}): TapeVerdict {
  const { flowBias, dailyChangePct, residualZ, pc } = args;
  let score = 0;
  if (flowBias === "call-buy/put-sell") score += 1;
  if (flowBias === "put-buy/call-sell") score -= 1;
  if (dailyChangePct > 1.5) score += 1;
  if (dailyChangePct < -1.5) score -= 1;
  if (residualZ != null && residualZ > 1) score += 1;
  if (residualZ != null && residualZ < -1) score -= 1;
  if (pc != null && pc < 0.6) score += 1;
  if (pc != null && pc > 1.4) score -= 1;
  if (score >= 2) return "accumulation";
  if (score <= -2) return "distribution";
  return "mixed";
}

export function computeTapeSignals(input: TapeSignalInput): TapeSignalSnapshot {
  const pc = input.putCallVolumeRatio;
  const flowBias = classifyFlowBias(pc);
  const support = input.supportLevel ?? input.shortStrike;
  const eventGapPct =
    Number.isFinite(input.dailyChangePct) ? Math.round(input.dailyChangePct * 100) / 100 : null;

  let reclaimRatio: number | null = null;
  let daysAboveSupport: number | null = null;
  if (support != null && support > 0 && input.signalPrice > 0) {
    reclaimRatio = Math.round((input.signalPrice / support) * 100) / 100;
    daysAboveSupport = input.signalPrice >= support ? 1 : 0;
  }

  return {
    eventGapPct,
    lowSinceEvent: null,
    reclaimRatio,
    daysAboveSupport,
    volumeConfirms: null,
    upDownVolumeRatio: null,
    flowBias,
    pcRatio: pc,
    netPremium: null,
    oiBuildStrike:
      input.shortStrike != null ? `$${input.shortStrike}` : null,
    shortInterestPct: null,
    shortTrend: null,
    residualZ: input.residualZ,
    tapeVerdict: classifyTapeVerdict({
      flowBias,
      dailyChangePct: input.dailyChangePct,
      residualZ: input.residualZ,
      pc,
    }),
  };
}

export function streetTapeAlignment(
  revisionTrend: "rising" | "falling" | "flat",
  tapeVerdict: TapeVerdict,
): "aligned" | "divergent" {
  if (revisionTrend === "flat" || tapeVerdict === "mixed") return "aligned";
  if (revisionTrend === "rising" && tapeVerdict === "accumulation") return "aligned";
  if (revisionTrend === "falling" && tapeVerdict === "distribution") return "aligned";
  if (revisionTrend === "rising" && tapeVerdict === "distribution") return "divergent";
  if (revisionTrend === "falling" && tapeVerdict === "accumulation") return "divergent";
  return "aligned";
}
