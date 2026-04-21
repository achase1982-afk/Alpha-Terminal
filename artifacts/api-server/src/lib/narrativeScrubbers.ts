/**
 * Bug 2 (P0): the AI strategist hallucinated "IVR 0.92" and "IVR 92" in the
 * narrative thesis for SPY when the data payload contained ivr=3.17. The
 * grounding-discipline section of the prompt did not stop it. The fix is
 * defense in depth:
 *
 *   1. Tell the model to use a literal `{{IVR}}` placeholder in any narrative
 *      reference (prompt-side, in strategistV2 STRATEGIST_SYSTEM_PROMPT).
 *   2. Server-side, after the model responds:
 *        a. Substitute every `{{IVR}}`, `{{PC_RATIO}}`, etc. placeholder
 *           with the canonical value from the payload.
 *        b. Sweep any remaining numeric mentions of IVR / IV Rank / P/C ratio
 *           and replace the cited number with the canonical one. This catches
 *           the hallucination case (model ignored the placeholder rule and
 *           wrote a real number).
 *        c. Log every replacement so the telemetry surfaces non-compliance.
 *
 * The scrubbers are pure string transforms with no project-internal imports
 * so they can be unit-tested in isolation.
 *
 * Audit scope (per 3c): the strategist prompt's data package includes IVR
 * and putCallVolumeRatio as single-per-ticker scalars. These two are covered
 * here. MMM (max market move) is NOT in the strategist payload — it lives in
 * the separate /api/market/ticker-stats route — so no scrubber is needed.
 * The existing reconcileNarrativeEconomics in strategistV2 already covers
 * debit / credit / max profit / max loss / risk:reward dollar drift.
 *
 * ---------------------------------------------------------------------------
 * BACKLOG: per-leg scrubber (NOT shipping in current pass)
 * ---------------------------------------------------------------------------
 *
 * The fields below are per-leg and require a lookup-by-strike substitution
 * strategy against the chain data payload, rather than a single canonical
 * scalar like IVR. Open issue — implement when the AI is observed misciting
 * any of these in a card the user sees:
 *
 *   - leg delta             (look up by leg.strike + leg.expiration + type)
 *   - leg open interest     (lookup by strike/exp/type)
 *   - leg volume            (lookup by strike/exp/type)
 *   - leg strike            (cross-check that every cited strike exists in
 *                            the chain — the prompt already forbids inventing
 *                            strikes, but a sweep would harden it)
 *   - leg mid price         (lookup by strike/exp/type)
 *
 * Implementation sketch:
 *   1. Build a Map<`${strike}-${expiration}-${type}`, ChainQuote>.
 *   2. Regex-find narrative mentions like "$705 put delta -0.49", "OI 1,760
 *      at the 700 strike", etc., extract the strike, look up the canonical
 *      value, replace the cited number if it drifts more than tolerance
 *      (e.g. 5% for delta, exact for OI/volume, $0.05 for mid).
 *   3. Log every replacement (same telemetry shape as IVR/PC scrubber).
 *
 * Tracking notes:
 *   - The prompt already includes a "GROUNDING DISCIPLINE" rule against
 *     inventing per-leg numbers, but field telemetry should drive whether to
 *     prioritize this; until then, the existing reconcile + IVR/PC scrubbers
 *     cover the highest-impact cases.
 */

export interface ScrubResult {
  text: string;
  /** Replacements made, for telemetry. */
  replacements: ScrubReplacement[];
}

export interface ScrubReplacement {
  field: "IVR" | "PC_RATIO";
  /** What the AI wrote (for the FIRST mention; subsequent mentions are also replaced). */
  cited: string;
  /** What we substituted in. */
  canonical: string;
  /** Source of the original mention: explicit placeholder vs. inline number. */
  kind: "placeholder" | "inline_number";
}

// ────────────────────────────────────────────────────────────────────────────
// Formatting

/** Format an IVR percentile (0-100) consistently across surfaces. */
export function formatIvr(ivr: number | null): string | null {
  if (ivr == null || !Number.isFinite(ivr)) return null;
  // Match the header rendering: integer percentile, no decimal, no % sign in
  // narrative (the surrounding word "IVR" is the unit).
  return String(Math.round(ivr));
}

/** Format a P/C volume ratio (e.g. 0.78) to two decimals. */
export function formatPcRatio(pc: number | null): string | null {
  if (pc == null || !Number.isFinite(pc)) return null;
  return (Math.round(pc * 100) / 100).toFixed(2);
}

// ────────────────────────────────────────────────────────────────────────────
// IVR scrubber

/**
 * Patterns we sweep, in order. Each matches a numeric IVR mention; capture
 * group `num` is the cited number we replace with the canonical.
 *
 * We deliberately do NOT match bare numbers that aren't anchored to an IVR
 * keyword — we don't want to corrupt other fields. We do match:
 *   - "IVR 92", "IVR: 92", "IVR=92", "IVR of 92", "IVR is 92", "IVR at 92"
 *   - "IVR 0.92", "IVR 92%"
 *   - "IV Rank 92", "IV-Rank of 92", "IV rank: 92"
 *   - parenthetical "(IVR 92)" / "(IVR=92)"
 *   - "92 IVR" (postfix style, gated to bare IVR token to avoid grabbing
 *      unrelated "92 minutes after IVR was reported" – very rare, accept risk)
 */
const IVR_PATTERNS: RegExp[] = [
  // "IVR" / "IV Rank" / "IV-Rank" prefix forms.
  // Trailing `%?` consumes the optional percent sign so "IVR 92%" becomes
  // "IVR 25" (without dangling %), matching the canonical format which is
  // unitless (the surrounding word "IVR" is the unit).
  /\b(IV[\s\-]?Rank|IVR)\s*(?:of|is|at|=|:|~|≈|of\s+approximately)?\s*(?<num>\d+(?:\.\d+)?)\s*%?/gi,
  // Parenthetical: "(IVR 92)" / "(IV Rank: 92%)"
  /\(\s*(IV[\s\-]?Rank|IVR)\s*(?:=|:|of|is|at)?\s*(?<num>\d+(?:\.\d+)?)\s*%?\s*\)/gi,
  // Postfix: "92 IVR"
  /\b(?<num>\d+(?:\.\d+)?)\s*%?\s+(IVR|IV[\s\-]?Rank)\b/gi,
];

const PC_RATIO_PATTERNS: RegExp[] = [
  // "P/C 1.19", "P/C ratio: 1.19", "put/call 1.19", "put-call ratio of 1.19"
  /\b(P\s*\/\s*C(?:\s+ratio)?|put[\s\-\/]+call(?:\s+(?:volume\s+)?ratio)?)\s*(?:of|is|at|=|:|~|≈)?\s*(?<num>\d+(?:\.\d+)?)\b/gi,
];

/**
 * Replace every IVR mention in `text` with the canonical value.
 * If `canonicalIvr` is null/undefined, scrubbing is a no-op (we cannot
 * substitute a value we don't have).
 */
export function scrubIvrReferences(text: string, canonicalIvr: number | null): ScrubResult {
  return scrubField(text, canonicalIvr, formatIvr, IVR_PATTERNS, "IVR", "{{IVR}}");
}

/**
 * Replace every P/C ratio mention with the canonical value.
 */
export function scrubPcRatioReferences(text: string, canonicalPc: number | null): ScrubResult {
  return scrubField(text, canonicalPc, formatPcRatio, PC_RATIO_PATTERNS, "PC_RATIO", "{{PC_RATIO}}");
}

function scrubField(
  text: string,
  canonical: number | null,
  fmt: (n: number | null) => string | null,
  patterns: RegExp[],
  field: "IVR" | "PC_RATIO",
  placeholder: string,
): ScrubResult {
  const replacements: ScrubReplacement[] = [];
  if (!text) return { text, replacements };

  const canonicalStr = fmt(canonical);
  if (canonicalStr == null) {
    // No canonical value → cannot substitute. Leave text alone but report
    // any inline mentions we found, so callers can decide how to handle.
    return { text, replacements };
  }

  let out = text;

  // Step 1: literal placeholder substitution.
  if (out.includes(placeholder)) {
    out = out.split(placeholder).join(canonicalStr);
    replacements.push({ field, cited: placeholder, canonical: canonicalStr, kind: "placeholder" });
  }

  // Step 2: numeric sweep — catch hallucinations / non-compliance.
  for (const pattern of patterns) {
    // Reset lastIndex (pattern is /g, shared module-scope).
    pattern.lastIndex = 0;
    out = out.replace(pattern, (match, ..._args: unknown[]) => {
      const groups = _args[_args.length - 1] as Record<string, string> | undefined;
      const num = groups?.["num"];
      if (num == null) return match;
      // Skip if the cited number already equals canonical (within rounding).
      const cited = parseFloat(num);
      if (!Number.isFinite(cited)) return match;
      const canonNum = parseFloat(canonicalStr);
      if (Math.abs(cited - canonNum) < 0.5) return match;
      replacements.push({ field, cited: num, canonical: canonicalStr, kind: "inline_number" });
      // Replace the cited number inside the matched span with canonical.
      // Strip any trailing % sign on the cited number — the canonical IVR
      // is unitless, so "92%" → "<canon>" rather than "<canon>%".
      return match.replace(num, canonicalStr).replace(/(\d)\s*%/, "$1");
    });
  }

  return { text: out, replacements };
}

/**
 * Convenience: scrub a single text field for IVR and P/C, returning the
 * combined replacement log.
 */
export function scrubAll(
  text: string,
  canonical: { ivr: number | null; pcRatio: number | null },
): ScrubResult {
  const r1 = scrubIvrReferences(text, canonical.ivr);
  const r2 = scrubPcRatioReferences(r1.text, canonical.pcRatio);
  return { text: r2.text, replacements: [...r1.replacements, ...r2.replacements] };
}
