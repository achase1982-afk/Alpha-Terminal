import type { ConvictionDeskOutput } from "./strategistDeskSchemas.js";

/**
 * Map pm.structure.type labels (free-form) to structure family for alignment checks.
 * Order matters: calendar_diagonal before generic calendar; premium before broad "spread" matches.
 */
export function inferExpectedFamilyFromPmStructureType(typeRaw: string): "directional" | "vol_surface" | "premium" | null {
  const t = typeRaw.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (t.includes("calendar_diagonal")) return "directional";
  if (/iron_condor|credit_spread|short_put_spread|short_call_spread|put_credit|call_credit|\bcsp\b|cash_secured/.test(t)) {
    return "premium";
  }
  if (/calendar|butterfly|iron_butterfly|iron_fly|ironfly|straddle|strangle/.test(t)) {
    return "vol_surface";
  }
  if (/bull_call|bear_put|long_call|long_put|diagonal|vertical/.test(t)) {
    return "directional";
  }
  return null;
}

export function validateConvictionDeskBusinessRules(o: ConvictionDeskOutput): string[] {
  const errs: string[] = [];

  if (o.pm.decision === "trade" && !o.pm.thesis?.trim()) {
    errs.push("pm.thesis must be non-empty when pm.decision is trade");
  }

  if (!o.regime_synthesis.synthesis?.trim()) {
    errs.push("regime_synthesis.synthesis must be non-empty");
  }

  const ror = o.risk_of_ruin?.trim() ?? "";
  if (ror.length < 20) {
    errs.push("risk_of_ruin must be at least 20 characters");
  }

  const sfd = o.structure_family_discipline;
  if (
    !sfd.directional_evaluated?.trim() ||
    !sfd.vol_surface_evaluated?.trim() ||
    !sfd.premium_evaluated?.trim()
  ) {
    errs.push(
      "structure_family_discipline.directional_evaluated, vol_surface_evaluated, and premium_evaluated must each be non-empty",
    );
  }

  if (o.pm.decision === "trade") {
    const pc = o.positioning_context;
    if (
      !pc.sell_side_targets_vs_price?.trim() ||
      !pc.implied_vs_consensus?.trim() ||
      !pc.fade_risk?.trim()
    ) {
      errs.push("positioning_context string fields must all be non-empty when pm.decision is trade");
    }
    if (!sfd.defense?.trim()) {
      errs.push("structure_family_discipline.defense must be non-empty when pm.decision is trade");
    }
  }

  const fam = sfd.chosen_family;

  if (o.pm.decision === "pass" || o.pm.structure == null) {
    if (fam !== "no_trade") {
      errs.push('structure_family_discipline.chosen_family must be "no_trade" when pm.decision is pass or pm.structure is null');
    }
  } else {
    const typeStr = o.pm.structure.type;
    const expected = inferExpectedFamilyFromPmStructureType(typeStr);
    if (expected == null) {
      errs.push(
        `could not classify pm.structure.type "${typeStr}" into directional, vol_surface, or premium for family alignment`,
      );
    } else if (fam !== expected) {
      errs.push(
        `structure_family_discipline.chosen_family must be "${expected}" for pm.structure.type "${typeStr}" (got "${fam}")`,
      );
    }
  }

  return errs;
}
