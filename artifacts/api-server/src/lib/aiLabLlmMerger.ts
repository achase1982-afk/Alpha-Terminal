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

function buildFinalStructureDescription(merged: MergedIdeaFields): string {
  const { candidate, optionStructureType, legs, primaryProposal } = merged;

  if (candidate.instrumentType === "STOCK") {
    const detail = primaryProposal.structure || "equity position";
    return `Equity ${candidate.direction} — ${detail}`;
  }

  const parts: string[] = [];
  if (optionStructureType) parts.push(optionStructureType);
  parts.push(candidate.direction);

  if (legs && legs.length > 0) {
    const legDescs = legs.map((l) => {
      const sideStr = l.side === "BUY" ? "Buy" : "Sell";
      return `${sideStr} ${l.quantity}x ${l.strike} ${l.legType} ${l.expiration}`;
    });
    parts.push(`(${legDescs.join(" / ")})`);
  } else if (primaryProposal.structure) {
    parts.push(`— ${primaryProposal.structure}`);
  }

  const result = parts.join(" ").trim();
  if (!result || result === candidate.direction) {
    return primaryProposal.structure || `${candidate.instrumentType} ${candidate.direction}`;
  }
  return result;
}

export function buildFinalDecision(
  merged: MergedIdeaFields,
  approved: boolean,
  rejectionReason: string | undefined,
): FinalDecision {
  const { critiqueScore, skepticFlags, originalConviction, convictionLevel } = merged;
  const sc = merged.skepticCritique;

  const finalStructure = buildFinalStructureDescription(merged);

  let decision: FinalDecisionEnum;
  let resolutionRationale: string;

  const skepticKillSignal = sc.suggestedChanges?.toLowerCase().includes("kill this") ?? false;
  const severeFlags = [
    skepticFlags?.liquidityConcern,
    skepticFlags?.regimeMismatch,
    skepticFlags?.overfitWarning,
  ].filter(Boolean).length;

  const hasSkepticContent = sc.objections && sc.objections !== "Skeptic unavailable.";
  const hasSkepticSuggestion = sc.suggestedChanges && sc.suggestedChanges !== "N/A" && sc.suggestedChanges !== "Proceed with standard risk management.";

  if (!approved || (critiqueScore >= 75 && skepticKillSignal) || severeFlags >= 3) {
    decision = "REJECT";
    const parts: string[] = [];
    if (!approved) {
      parts.push(`Rejected: ${rejectionReason ?? "validation failed"}.`);
    } else {
      parts.push("Rejected due to overwhelming Skeptic concerns.");
    }
    if (hasSkepticContent) {
      parts.push(`Skeptic objections: ${sc.objections}`);
    }
    const flagList: string[] = [];
    if (skepticFlags?.liquidityConcern) flagList.push("liquidity concern");
    if (skepticFlags?.regimeMismatch) flagList.push("regime mismatch");
    if (skepticFlags?.overfitWarning) flagList.push("overfit warning");
    if (skepticFlags?.redundancyWithActiveIdeas) flagList.push("redundancy with active ideas");
    if (flagList.length > 0) parts.push(`Flags: ${flagList.join(", ")}.`);
    if (hasSkepticSuggestion) {
      parts.push(`Skeptic suggested: ${sc.suggestedChanges}`);
    }
    resolutionRationale = parts.join(" ");
  } else {
    const hasMaterialChange =
      originalConviction !== convictionLevel ||
      (skepticFlags?.regimeMismatch && skepticFlags?.liquidityConcern) ||
      (skepticFlags?.overfitWarning && critiqueScore >= 50);

    if (hasMaterialChange) {
      decision = "MODIFIED";
      const parts: string[] = [`Proceeding with modifications (Skeptic score: ${critiqueScore}).`];
      if (originalConviction !== convictionLevel) {
        parts.push(`Conviction downgraded from ${originalConviction} to ${convictionLevel}.`);
      }
      if (skepticFlags?.overfitWarning) {
        parts.push("Overfit warning acknowledged — reducing confidence in pattern reliability.");
      }
      if (hasSkepticContent) {
        parts.push(`Addressing Skeptic concerns: ${sc.objections}`);
      }
      if (hasSkepticSuggestion) {
        parts.push(`Skeptic suggested: ${sc.suggestedChanges}`);
      }
      const flagNotes: string[] = [];
      if (skepticFlags?.regimeMismatch) flagNotes.push("regime mismatch acknowledged");
      if (skepticFlags?.liquidityConcern) flagNotes.push("liquidity concern acknowledged");
      if (flagNotes.length > 0) parts.push(`Flags: ${flagNotes.join("; ")}.`);
      resolutionRationale = parts.join(" ");
    } else if (critiqueScore >= 55) {
      decision = "PROCEED";
      const parts: string[] = [`Proceeding despite elevated Skeptic score (${critiqueScore}).`];
      if (hasSkepticContent) {
        parts.push(`Skeptic raised: ${sc.objections} — assessed as non-blocking given the strength of the thesis.`);
      }
      if (hasSkepticSuggestion) {
        parts.push(`Skeptic suggested: ${sc.suggestedChanges} — noted but not implemented.`);
      }
      resolutionRationale = parts.join(" ");
    } else {
      decision = "PROCEED";
      const parts: string[] = [`Proceeding as proposed. Skeptic score: ${critiqueScore} (no blocking concerns).`];
      if (hasSkepticContent) {
        parts.push(`Skeptic noted: ${sc.objections} — assessed as non-blocking.`);
      }
      if (skepticFlags?.redundancyWithActiveIdeas) {
        parts.push("Minor redundancy flag noted but not blocking.");
      }
      resolutionRationale = parts.join(" ");
    }
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
