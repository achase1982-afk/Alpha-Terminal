import type { TradeIdeaCandidate } from "./aiLabValidator.js";
import type {
  AnalystResponse,
  SkepticResponse,
  ScannerAlignmentAtCreation,
  TradeIdeaCore,
} from "./aiLabLlmTypes.js";

const SKEPTIC_DAMPENING_FACTOR = 0.3;
const DEFAULT_CRITIQUE_SCORE = 50;

export interface MergedIdeaFields {
  candidate: TradeIdeaCandidate;
  thesis: string;
  catalyst: "FLOW" | "EARNINGS" | "TECHNICAL" | "MACRO" | "OTHER";
  invalidation: string;
  regimeFit: "GOOD" | "NEUTRAL" | "POOR";
  mainSignals: string[];
  signalStrength: number;
  convictionLevel: "LOW" | "MEDIUM" | "HIGH";
  uncertainty: { dataQuality: string; patternReliability?: number | null; regimeFitScore?: number | null };
  entryZone: { min: number; max: number } | null;
  softStop: number | null;
  targetZone: { min: number; max: number } | null;
  timeHorizon: "INTRADAY" | "1-3D" | "3-10D" | "10+D";
  analystNote: string;
  criticNote: string;
  analystModelName: string;
  criticModelName: string;
  regimeAtCreation: string;
  scannerAlignmentAtCreation: ScannerAlignmentAtCreation;
  optionStructureType: string | null;
  legs: TradeIdeaCore["legs"];
}

export function buildCandidateIdeaFromLlms(
  symbol: string,
  analystResponse: AnalystResponse,
  skepticResponse: SkepticResponse | null,
  regimeState: { trendState: string; volState: string; breadthState: string },
  analystModelName: string,
  criticModelName: string,
): MergedIdeaFields {
  const core = analystResponse.tradeIdeaCore;
  const rat = analystResponse.rationale;
  const conf = analystResponse.confidence;
  const liq = analystResponse.liquiditySnapshot;
  const scanner = analystResponse.scannerAlignmentAtCreation;

  const critiqueScore = skepticResponse?.critiqueScore ?? DEFAULT_CRITIQUE_SCORE;

  const rawSignal = conf.signalStrength - (critiqueScore * SKEPTIC_DAMPENING_FACTOR);
  const effectiveSignal = Math.round(Math.max(0, Math.min(100, rawSignal)));

  let effectiveConviction: "LOW" | "MEDIUM" | "HIGH" = conf.convictionLevel;
  if (skepticResponse?.flags.regimeMismatch && effectiveConviction === "HIGH") {
    effectiveConviction = "MEDIUM";
  }
  if (effectiveSignal < 30 && effectiveConviction !== "LOW") {
    effectiveConviction = "LOW";
  }

  const regimeStr = `${regimeState.trendState}|${regimeState.volState}|${regimeState.breadthState}`;

  const candidate: TradeIdeaCandidate = {
    symbol: symbol.toUpperCase(),
    direction: core.direction,
    instrumentType: core.instrumentType,
    optionStructureType: core.optionStructureType ?? null,
    legs: core.legs ?? null,
    entrySpreadPct: liq.entrySpreadPct ?? null,
    oiAtEntry: liq.oiAtEntry ?? null,
    volumeAtEntry: liq.volumeAtEntry ?? null,
    volumeToOiRatio: liq.volumeToOiRatio ?? null,
    sector: null,
  };

  return {
    candidate,
    thesis: rat.thesis,
    catalyst: rat.catalyst,
    invalidation: rat.invalidation,
    regimeFit: rat.regimeFit,
    mainSignals: rat.mainSignals,
    signalStrength: effectiveSignal,
    convictionLevel: effectiveConviction,
    uncertainty: conf.uncertainty,
    entryZone: core.entryZone,
    softStop: core.softStop,
    targetZone: core.targetZone,
    timeHorizon: core.timeHorizon,
    analystNote: analystResponse.analystNote,
    criticNote: skepticResponse?.criticNote ?? "Skeptic unavailable — using default neutral score.",
    analystModelName,
    criticModelName,
    regimeAtCreation: regimeStr,
    scannerAlignmentAtCreation: scanner,
    optionStructureType: core.optionStructureType ?? null,
    legs: core.legs ?? null,
  };
}
