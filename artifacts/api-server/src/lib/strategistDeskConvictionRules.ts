import type { ConvictionDeskOutput } from "./strategistDeskSchemas.js";

function normalizeStructureLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/[^a-z0-9 $./\-]/g, "");
}

/** True when pm.structure.type and the hypothesis line describe the same structure (allows naming variance). */
export function pmStructureAlignsWithCandidate(pmType: string, candidateStructure: string): boolean {
  const a = normalizeStructureLabel(pmType);
  const b = normalizeStructureLabel(candidateStructure);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function tradeFamiliesPricedWithConcreteMath(familyHypotheses: ConvictionDeskOutput["family_hypotheses"]): boolean {
  for (const h of familyHypotheses) {
    if (h.family === "pass") continue;
    const m = h.entry_math.trim();
    if (m.length < 24) return false;
    if (!/\d/.test(m)) return false;
    const lower = m.toLowerCase();
    const hasBreak =
      /breakeven|break-even|break even|\bb\/e\b|\bbe at\b/i.test(lower) || /\bBE\b/.test(m);
    const hasMax = /max(imum)?\s*(profit|loss)/i.test(lower) || /max\s+profit|max\s+loss/i.test(lower);
    if (!hasBreak || !hasMax) return false;
  }
  return true;
}

function decisionConsistentWithStrongestHypothesis(o: ConvictionDeskOutput): boolean {
  const { strongest_hypothesis } = o.regime_synthesis;
  if (o.pm.decision === "pass" || o.pm.structure == null) {
    return strongest_hypothesis === "pass";
  }
  if (strongest_hypothesis === "pass") return false;
  const hyp = o.family_hypotheses.find((h) => h.family === strongest_hypothesis);
  if (!hyp || hyp.family === "pass") return false;
  return pmStructureAlignsWithCandidate(o.pm.structure.type, hyp.candidate_structure);
}

export function validateConvictionDeskBusinessRules(o: ConvictionDeskOutput): string[] {
  const errs: string[] = [];

  if (o.pm.decision === "trade" && !o.pm.thesis?.trim()) {
    errs.push("pm.thesis must be non-empty when pm.decision is trade");
  }

  if (!o.regime_synthesis.synthesis?.trim()) {
    errs.push("regime_synthesis.synthesis must be non-empty");
  }

  const sh = o.regime_synthesis.strongest_hypothesis;
  const families = o.family_hypotheses.map((h) => h.family);
  if (families.join(",") !== "long_vol,short_vol,directional,pass") {
    errs.push("family_hypotheses must be ordered long_vol, short_vol, directional, pass");
  }
  if (!families.includes(sh)) {
    errs.push("regime_synthesis.strongest_hypothesis must match a family_hypotheses.family value");
  }

  const ror = o.risk_of_ruin?.trim() ?? "";
  if (ror.length < 20) {
    errs.push("risk_of_ruin must be at least 20 characters");
  }

  if (o.pm.decision === "pass" || o.pm.structure == null) {
    if (sh !== "pass") {
      errs.push('regime_synthesis.strongest_hypothesis must be "pass" when pm.decision is pass or pm.structure is null');
    }
  } else {
    if (sh === "pass") {
      errs.push('regime_synthesis.strongest_hypothesis must not be "pass" when pm.decision is trade with a structure');
    }
    const hyp = o.family_hypotheses.find((h) => h.family === sh);
    if (hyp && hyp.family !== "pass" && !pmStructureAlignsWithCandidate(o.pm.structure.type, hyp.candidate_structure)) {
      errs.push(
        `pm.structure.type must align with strongest_hypothesis candidate_structure (got "${o.pm.structure.type}" vs "${hyp.candidate_structure}")`,
      );
    }
  }

  if (o.pm.decision === "trade") {
    const pc = o.positioning_context;
    if (
      !pc.sell_side_targets_vs_price?.trim() ||
      !pc.implied_vs_consensus?.trim() ||
      !pc.upside_fade_risk?.trim() ||
      !pc.downside_fade_risk?.trim()
    ) {
      errs.push("positioning_context string fields must all be non-empty when pm.decision is trade");
    }
  }

  if (!tradeFamiliesPricedWithConcreteMath(o.family_hypotheses)) {
    errs.push(
      "each trade family (long_vol, short_vol, directional) must have entry_math with numerics, breakeven language, and max profit/loss language",
    );
  }

  const derivedPricingOk = tradeFamiliesPricedWithConcreteMath(o.family_hypotheses);
  if (o.self_check.each_family_priced_with_math !== derivedPricingOk) {
    errs.push("self_check.each_family_priced_with_math must match whether trade families carry concrete pricing math");
  }

  const derivedDecisionOk = decisionConsistentWithStrongestHypothesis(o);
  if (o.self_check.decision_consistent_with_strongest_hypothesis !== derivedDecisionOk) {
    errs.push("self_check.decision_consistent_with_strongest_hypothesis must match pm and regime_synthesis alignment");
  }

  if (!derivedDecisionOk) {
    errs.push("pm.decision, pm.structure, and regime_synthesis.strongest_hypothesis are internally inconsistent");
  }

  return errs;
}
