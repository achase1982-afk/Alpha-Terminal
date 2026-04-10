import type { TradeIdeaCandidate } from "./aiLabValidator.js";
import type {
  AnalystResponse,
  SkepticResponse,
  ScannerAlignmentAtCreation,
  TradeIdeaCore,
  PrimaryProposal,
  SkepticCritique,
  FinalDecision,
  FinalDecisionEnum,
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
  originalConviction: "LOW" | "MEDIUM" | "HIGH";
  uncertainty: { dataQuality: string; patternReliability?: number | null; regimeFitScore?: number | null };
  entryZone: { min: number; max: number } | null;
  softStop: number | null;
  targetZone: { min: number; max: number } | null;
  timeHorizon: "INTRADAY" | "1-3D" | "3-10D" | "10+D";
  analystNote: string;
  criticNote: string;
  critiqueScore: number;
  analystModelName: string;
  criticModelName: string;
  regimeAtCreation: string;
  scannerAlignmentAtCreation: ScannerAlignmentAtCreation;
  optionStructureType: string | null;
  legs: TradeIdeaCore["legs"];
  primaryProposal: PrimaryProposal;
  skepticCritique: SkepticCritique;
  skepticFlags: SkepticResponse["flags"] | null;
}

export function buildFinalDecision(
  merged: MergedIdeaFields,
  approved: boolean,
  rejectionReason: string | undefined,
): FinalDecision {
  const { optionStructureType, candidate, critiqueScore, skepticFlags, originalConviction, convictionLevel, signalStrength } = merged;

  const finalStructure = optionStructureType
    ? `${optionStructureType} ${candidate.direction}`
    : `${candidate.instrumentType} ${candidate.direction}`;

  let decision: FinalDecisionEnum;
  let resolutionRationale: string;

  if (!approved) {
    decision = "REJECT";
    const flagList: string[] = [];
    if (skepticFlags?.liquidityConcern) flagList.push("liquidity concern");
    if (skepticFlags?.regimeMismatch) flagList.push("regime mismatch");
    if (skepticFlags?.overfitWarning) flagList.push("overfit warning");
    if (skepticFlags?.redundancyWithActiveIdeas) flagList.push("redundancy with active ideas");
    const flagStr = flagList.length > 0 ? ` Skeptic raised: ${flagList.join(", ")}.` : "";
    resolutionRationale = `Rejected: ${rejectionReason ?? "validation failed"}.${flagStr}`;
  } else if (
    critiqueScore >= 55 ||
    originalConviction !== convictionLevel ||
    (skepticFlags?.regimeMismatch && skepticFlags?.liquidityConcern)
  ) {
    decision = "MODIFIED";
    const mods: string[] = [];
    if (originalConviction !== convictionLevel) mods.push(`conviction downgraded from ${originalConviction} to ${convictionLevel}`);
    if (skepticFlags?.regimeMismatch) mods.push("regime mismatch noted");
    if (skepticFlags?.liquidityConcern) mods.push("liquidity concern noted");
    const modStr = mods.length > 0 ? ` Modifications: ${mods.join("; ")}.` : "";
    const suggestedStr = merged.skepticCritique.suggestedChanges !== "N/A"
      ? ` Skeptic suggested: ${merged.skepticCritique.suggestedChanges}`
      : "";
    resolutionRationale = `Proceeding with modifications. Skeptic score: ${critiqueScore}.${modStr}${suggestedStr}`.trim();
  } else {
    decision = "PROCEED";
    const redundancyNote = skepticFlags?.redundancyWithActiveIdeas ? " Minor redundancy flag noted but not blocking." : "";
    resolutionRationale = `Proceeding as proposed. Skeptic found no blocking concerns (score: ${critiqueScore}).${redundancyNote}`.trim();
  }

  return { decision, finalStructure, resolutionRationale };
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

  const originalConviction = conf.convictionLevel;
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

  const defaultSkepticCritique: SkepticCritique = {
    objections: "Skeptic unavailable.",
    evidence: "No skeptic data available.",
    suggestedChanges: "Proceed with standard risk management.",
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
    originalConviction,
    uncertainty: conf.uncertainty,
    entryZone: core.entryZone,
    softStop: core.softStop,
    targetZone: core.targetZone,
    timeHorizon: core.timeHorizon,
    analystNote: analystResponse.analystNote,
    criticNote: skepticResponse?.criticNote ?? "Skeptic unavailable — using default neutral score.",
    critiqueScore,
    analystModelName,
    criticModelName,
    regimeAtCreation: regimeStr,
    scannerAlignmentAtCreation: scanner,
    optionStructureType: core.optionStructureType ?? null,
    legs: core.legs ?? null,
    primaryProposal: analystResponse.primaryProposal,
    skepticCritique: skepticResponse?.skepticCritique ?? defaultSkepticCritique,
    skepticFlags: skepticResponse?.flags ?? null,
  };
}
