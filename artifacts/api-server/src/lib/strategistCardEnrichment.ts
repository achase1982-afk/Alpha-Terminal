/**
 * Strategist trade-card enrichment: exit per-lot P/L, risk-first R:R, entry stock band,
 * exit plan percentages, and brief bullet lists.
 */

import type { CandidateLeg } from "./strategistV2.js";

export const DEFAULT_PROFIT_TARGET_PCT = 0.62;
export const DEFAULT_STOP_LOSS_PCT = 0.3;

export interface ExitPerLotInput {
  isCredit: boolean;
  netEntry: number;
  profitBuyback: number;
  stopBuyback: number;
}

export interface ExitPerLotResult {
  profitPerLot: number;
  stopPerLot: number;
}

/** Correct per-lot P/L for credit vs debit structures (§7). */
export function computeExitPerLot(input: ExitPerLotInput): ExitPerLotResult {
  const { isCredit, netEntry, profitBuyback, stopBuyback } = input;
  if (!Number.isFinite(netEntry) || netEntry <= 0) {
    return { profitPerLot: 0, stopPerLot: 0 };
  }
  if (isCredit) {
    const profitPerLot =
      profitBuyback > 0 ? Math.round((netEntry - profitBuyback) * 100) : 0;
    const stopPerLot =
      stopBuyback > 0 ? Math.round((stopBuyback - netEntry) * 100) : 0;
    return { profitPerLot, stopPerLot: -Math.abs(stopPerLot) };
  }
  const profitPerLot =
    profitBuyback > 0 ? Math.round((profitBuyback - netEntry) * 100) : 0;
  const rawStop =
    stopBuyback > 0 ? Math.round((stopBuyback - netEntry) * 100) : 0;
  const stopPerLot = Math.max(-Math.round(netEntry * 100), Math.min(0, rawStop));
  return { profitPerLot, stopPerLot };
}

/** Risk-first R:R normalized to reward = 1 (§4.4). */
export function computeRiskFirstReward(
  maxProfit: number,
  maxLoss: number,
): { ratio: number | null; display: string } {
  if (!Number.isFinite(maxProfit) || maxProfit >= 99999 || maxProfit <= 0) {
    return { ratio: null, display: "OPEN-ENDED" };
  }
  if (!Number.isFinite(maxLoss) || maxLoss <= 0) {
    return { ratio: null, display: "VARIES" };
  }
  const ratio = maxLoss / maxProfit;
  return { ratio, display: `${ratio.toFixed(2)} : 1` };
}

export function confidenceTierColor(score: number): string {
  if (score >= 70) return "#46d486";
  if (score >= 65) return "#ffd23f";
  return "#ff7a7a";
}

export interface EnrichedExitTargets {
  profitTarget: number;
  profitTargetUnderlying: number;
  stopLoss: number;
  stopLossUnderlying: number;
  timeStop: string;
  profitTargetPct: number;
  stopLossPct: number;
  profitPerLot: number;
  stopPerLot: number;
}

export function enrichExitTargets(args: {
  raw: {
    profitTarget: number;
    profitTargetUnderlying: number;
    stopLoss: number;
    stopLossUnderlying: number;
    timeStop: string;
  };
  isCredit: boolean;
  netEntry: number;
  maxProfit: number;
  maxLoss: number;
}): EnrichedExitTargets {
  const { raw, isCredit, netEntry, maxProfit, maxLoss } = args;
  let profitBuyback = raw.profitTarget;
  let stopBuyback = raw.stopLoss;

  const maxProfitPerShare = maxProfit > 0 && maxProfit < 99999 ? maxProfit / 100 : 0;
  const maxLossPerShare = maxLoss > 0 ? maxLoss / 100 : 0;

  if (profitBuyback <= 0 && maxProfitPerShare > 0) {
    if (isCredit) {
      profitBuyback = Math.round(netEntry * (1 - DEFAULT_PROFIT_TARGET_PCT) * 100) / 100;
    } else {
      profitBuyback = Math.round((netEntry + maxProfitPerShare * DEFAULT_PROFIT_TARGET_PCT) * 100) / 100;
    }
  }
  if (stopBuyback <= 0 && maxLossPerShare > 0) {
    if (isCredit) {
      stopBuyback = Math.round(netEntry + maxLossPerShare * DEFAULT_STOP_LOSS_PCT * 100) / 100;
    } else {
      stopBuyback = Math.round(netEntry * (1 - DEFAULT_STOP_LOSS_PCT) * 100) / 100;
    }
  }

  const profitCapturedPerShare = isCredit
    ? netEntry - profitBuyback
    : profitBuyback - netEntry;
  const profitTargetPct =
    maxProfitPerShare > 0
      ? Math.round((profitCapturedPerShare / maxProfitPerShare) * 100)
      : Math.round(DEFAULT_PROFIT_TARGET_PCT * 100);

  const lossAtStopPerShare = isCredit
    ? stopBuyback - netEntry
    : netEntry - stopBuyback;
  const stopLossPct =
    maxLossPerShare > 0
      ? Math.round((lossAtStopPerShare / maxLossPerShare) * 100)
      : Math.round(DEFAULT_STOP_LOSS_PCT * 100);

  const { profitPerLot, stopPerLot } = computeExitPerLot({
    isCredit,
    netEntry,
    profitBuyback,
    stopBuyback,
  });

  return {
    profitTarget: profitBuyback,
    profitTargetUnderlying: raw.profitTargetUnderlying,
    stopLoss: stopBuyback,
    stopLossUnderlying: raw.stopLossUnderlying,
    timeStop: raw.timeStop,
    profitTargetPct: Math.min(100, Math.max(0, profitTargetPct)),
    stopLossPct: Math.min(100, Math.max(0, stopLossPct)),
    profitPerLot,
    stopPerLot,
  };
}

/** Sweep underlying to find band where spread fill lands in entry range (§6.1). */
export function computeEntryStockBand(args: {
  spot: number;
  legs: CandidateLeg[];
  fillMin: number;
  fillMax: number;
}): { min: number | null; max: number | null } {
  const { spot, legs, fillMin, fillMax } = args;
  if (!Number.isFinite(spot) || spot <= 0 || legs.length === 0) {
    return { min: null, max: null };
  }
  if (!Number.isFinite(fillMin) || !Number.isFinite(fillMax) || fillMax <= 0) {
    return { min: null, max: null };
  }

  const lo = fillMin;
  const hi = fillMax;
  const step = Math.max(0.05, spot * 0.0025);
  const start = spot * 0.75;
  const end = spot * 1.25;

  const inBand = (S: number): boolean => {
    const entry = estimateEntryAtUnderlying(legs, spot, S);
    return entry >= lo - 0.005 && entry <= hi + 0.005;
  };

  let bandMin: number | null = null;
  let bandMax: number | null = null;
  for (let S = start; S <= end + 1e-9; S += step) {
    if (inBand(S)) {
      if (bandMin == null) bandMin = S;
      bandMax = S;
    }
  }

  if (bandMin == null || bandMax == null) {
    return { min: null, max: null };
  }
  return {
    min: Math.round(bandMin * 100) / 100,
    max: Math.round(bandMax * 100) / 100,
  };
}

function estimateEntryAtUnderlying(legs: CandidateLeg[], spot: number, S: number): number {
  const expirations = new Set(legs.map((l) => l.expiration.split(":")[0].trim()));
  if (expirations.size === 1) {
    let net = 0;
    for (const leg of legs) {
      const sign = leg.side === "buy" ? 1 : -1;
      const isCall = leg.type === "call";
      const intrinsic = isCall ? Math.max(0, S - leg.strike) : Math.max(0, leg.strike - S);
      net += sign * intrinsic;
    }
    return Math.abs(net);
  }

  let netMid = 0;
  for (const leg of legs) {
    const sign = leg.side === "buy" ? 1 : -1;
    const delta = Number.isFinite(leg.delta) ? leg.delta : 0;
    const midAtS = leg.mid + delta * (S - spot);
    netMid += sign * midAtS;
  }
  return Math.abs(netMid);
}

const EM_DASH = /\u2014/g;

export function stripEmDashes(text: string): string {
  return text.replace(EM_DASH, ",").trim();
}

/** Split prose into ranked bullets (max 6). */
export function proseToBullets(text: string, max = 6): string[] {
  if (!text?.trim()) return [];
  const cleaned = stripEmDashes(text);
  const parts = cleaned
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[-•*]\s*/, "").trim())
    .filter((s) => s.length > 8);
  return parts.slice(0, max);
}

export function buildBriefBullets(args: {
  thesis: string;
  bullInvalidation: string;
  bearInvalidation: string;
  riskOfRuin: string;
  warnings: string | null;
}): { whyItWorks: string[]; whatKillsIt: string[] } {
  const whyFromThesis = proseToBullets(args.thesis, 4);
  const whyExtra = proseToBullets(args.bullInvalidation, 2);
  const whyItWorks = [...whyFromThesis, ...whyExtra].slice(0, 6);

  const killFromBear = proseToBullets(args.bearInvalidation, 3);
  const killFromRisk = proseToBullets(args.riskOfRuin, 2);
  const killFromWarn = proseToBullets(args.warnings ?? "", 2);
  const whatKillsIt = [...killFromBear, ...killFromRisk, ...killFromWarn].slice(0, 6);

  if (whatKillsIt.length === 0 && args.warnings) {
    whatKillsIt.push(stripEmDashes(args.warnings.slice(0, 120)));
  }
  if (whyItWorks.length === 0 && args.thesis) {
    whyItWorks.push(stripEmDashes(args.thesis.slice(0, 160)));
  }

  return { whyItWorks, whatKillsIt };
}
