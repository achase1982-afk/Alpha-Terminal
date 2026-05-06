import type { ConvictionDeskOutput } from "./strategistDeskSchemas.js";

/** Map structure label to one primary family for desk-span validation. */
export function convictionStructureFamily(
  structure: string,
): "directional" | "vol_surface" | "premium" {
  /** Skeleton + models emit snake_case labels (e.g. iron_condor); regexes expect spaced prose. */
  const s = structure.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (/\biron condor\b|\b(short premium|sell premium|cash[- ]secured put|naked short)\b/.test(s)) {
    return "premium";
  }

  if (
    /\b(calendar|double calendar|calendar spread)\b/.test(s) ||
    /\b(butterfly|iron fly|ironfly|straddle|strangle)\b/.test(s) ||
    (/\bfly\b/.test(s) && !/\biron condor\b/.test(s))
  ) {
    return "vol_surface";
  }

  if (
    /\b(naked\b|\bcredit spread\b|\bcovered call\b|\bcsp\b|\bshort put\b|\bshort call\b|\bsell vol\b)\b/.test(s) ||
    (/\bcredit\b/.test(s) && /\b(short|sell)\b/.test(s))
  ) {
    return "premium";
  }

  return "directional";
}

/** Mean of P5..P95 used as EV proxy vs model EV dollars. */
export function impliedEvFromOutcomeDistribution(dist: {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}): number {
  return (dist.p5 + dist.p25 + dist.p50 + dist.p75 + dist.p95) / 5;
}

export function normalizeConvictionDeskOutput(o: ConvictionDeskOutput): ConvictionDeskOutput {
  const copy = JSON.parse(JSON.stringify(o)) as ConvictionDeskOutput;

  const convictionGradeBad =
    copy.self_grade.conviction === "C" ||
    copy.self_grade.conviction === "D" ||
    copy.self_grade.conviction === "F";

  if (convictionGradeBad) {
    copy.self_grade.conviction_threshold_met = false;
  }

  const mustNoTrade =
    !copy.failure_scenario.sufficient ||
    copy.view.decision_intent === "pass" ||
    convictionGradeBad ||
    !copy.self_grade.conviction_threshold_met;

  if (mustNoTrade) {
    copy.decision.chosen = null;
    copy.scenarios = null;
    copy.exit_plan = null;
    copy.size = "no-trade";
  }

  return copy;
}

export function validateConvictionDeskBusinessRules(o: ConvictionDeskOutput): string[] {
  const errs: string[] = [];

  if (o.decision.candidates_considered.length < 2) {
    errs.push("decision.candidates_considered must have at least 2 entries");
  }

  if (o.decision.rejected_alternatives.length < 1) {
    errs.push("decision.rejected_alternatives must have at least 1 entry");
  }

  const fams = new Set(
    o.decision.candidates_considered.map((c) => convictionStructureFamily(c.structure)),
  );
  if (o.decision.candidates_considered.length >= 2 && fams.size < 2) {
    errs.push("candidates_considered must span at least two structure families (directional, vol_surface, premium)");
  }

  const chosen = o.decision.chosen;
  const candidateStructures = o.decision.candidates_considered.map((c) => c.structure.trim());

  if (chosen) {
    if (!candidateStructures.includes(chosen.structure.trim())) {
      errs.push("decision.chosen.structure must appear in decision.candidates_considered");
    }
    if (chosen.greeks_evolution.length < 3) {
      errs.push("decision.chosen.greeks_evolution must have at least 3 entries");
    }
    const evModel = chosen.ev_dollars;
    const evImplied = impliedEvFromOutcomeDistribution(chosen.outcome_distribution);
    if (Number.isFinite(evModel) && Number.isFinite(evImplied) && Math.abs(evImplied) > 1e-9) {
      const rel = Math.abs((evModel - evImplied) / evImplied);
      if (rel > 0.05) {
        errs.push(
          `decision.chosen.ev_dollars must be within 5% of the mean of outcome_distribution P5..P95 (expected ~${evImplied.toFixed(4)}, got ${evModel})`,
        );
      }
    }
    if (chosen.stop_loss != null && Number.isFinite(chosen.stop_loss) && Number.isFinite(chosen.max_loss)) {
      if (chosen.stop_loss === chosen.max_loss) {
        errs.push("decision.chosen.stop_loss must not equal max_loss");
      }
    }
  }

  if (o.failure_scenario.sufficient === false) {
    if (o.decision.chosen != null || o.scenarios != null || o.exit_plan != null) {
      errs.push("when failure_scenario.sufficient is false, chosen, scenarios, and exit_plan must be null");
    }
  }

  if (o.view.decision_intent === "pass") {
    if (o.decision.chosen != null || o.scenarios != null || o.exit_plan != null) {
      errs.push('when view.decision_intent is "pass", chosen, scenarios, and exit_plan must be null');
    }
  }

  const badConv = o.self_grade.conviction === "C" || o.self_grade.conviction === "D" || o.self_grade.conviction === "F";
  if (badConv) {
    if (o.self_grade.conviction_threshold_met !== false) {
      errs.push("when self_grade.conviction is C, D, or F, conviction_threshold_met must be false");
    }
    if (o.decision.chosen != null || o.scenarios != null || o.exit_plan != null) {
      errs.push("when conviction grade is C or below, chosen, scenarios, and exit_plan must be null");
    }
  }

  return errs;
}
