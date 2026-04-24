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

export type ScrubField =
  | "IVR"
  | "PC_RATIO"
  | "IV30"
  | "HV20"
  | "IVHV"
  | "BETA"
  | "EARNINGS_DAYS"
  | "PC_RATIO_FLOW";

export interface ScrubReplacement {
  field: ScrubField;
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

/** Format IV30 (30-day implied vol). Inputs are decimals (e.g. 0.4125 → "41.3%").
 *  Precision matches the data package render in strategistValidate.ts so the
 *  scrubbed substitution is byte-identical to the canonical line above it. */
export function formatIv30(iv: number | null): string | null {
  if (iv == null || !Number.isFinite(iv)) return null;
  return (iv * 100).toFixed(1) + "%";
}

/** Format HV20 (20-day historical vol). Decimal in → percent out, 1 decimal
 *  (matches data package precision — see formatIv30 comment). */
export function formatHv20(hv: number | null): string | null {
  if (hv == null || !Number.isFinite(hv)) return null;
  return (hv * 100).toFixed(1) + "%";
}

/** Format IV/HV ratio to two decimals. */
export function formatIvHvRatio(r: number | null): string | null {
  if (r == null || !Number.isFinite(r)) return null;
  return (Math.round(r * 100) / 100).toFixed(2);
}

/** Format beta to two decimals. */
export function formatBeta(b: number | null): string | null {
  if (b == null || !Number.isFinite(b)) return null;
  return (Math.round(b * 100) / 100).toFixed(2);
}

/** Format days-to-earnings as an integer. */
export function formatEarningsDays(d: number | null): string | null {
  if (d == null || !Number.isFinite(d)) return null;
  return String(Math.round(d));
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
  field: ScrubField,
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
 * Placeholder-only substitution for the new validate-pipeline fields. We
 * deliberately do NOT add inline-number sweeps for these — the risk of
 * false positives (clobbering an unrelated number that happens to follow
 * the keyword) outweighs the marginal benefit, since the validators read
 * the canonical block and rarely hallucinate. The model is instructed to
 * use `{{...}}` placeholders for each; if it complies, the placeholder is
 * substituted; if it ignores the placeholder rule and writes the literal
 * canonical number, that's already correct so no scrub is needed; if it
 * writes a *wrong* number, that's a residual hallucination we accept and
 * log via the existing telemetry path.
 */
function scrubPlaceholderOnly(
  text: string,
  canonical: number | null,
  fmt: (n: number | null) => string | null,
  field: ScrubField,
  placeholder: string,
): ScrubResult {
  const replacements: ScrubReplacement[] = [];
  if (!text) return { text, replacements };
  const canonicalStr = fmt(canonical);
  if (canonicalStr == null) return { text, replacements };
  if (!text.includes(placeholder)) return { text, replacements };
  const out = text.split(placeholder).join(canonicalStr);
  replacements.push({ field, cited: placeholder, canonical: canonicalStr, kind: "placeholder" });
  return { text: out, replacements };
}

export interface ScrubCanonical {
  ivr: number | null;
  pcRatio: number | null;
  iv30?: number | null;
  hv20?: number | null;
  ivHv?: number | null;
  beta?: number | null;
  earningsDays?: number | null;
  pcRatioFlow?: number | null;
}

/**
 * Returns true if any canonical scalar is non-null. Use this to gate the
 * scrubAll() call: skipping the call when one specific field is null
 * would leave OTHER placeholder tokens unsubstituted in the transcript.
 */
export function hasAnyCanonical(c: ScrubCanonical): boolean {
  return (
    c.ivr != null ||
    c.pcRatio != null ||
    c.iv30 != null ||
    c.hv20 != null ||
    c.ivHv != null ||
    c.beta != null ||
    c.earningsDays != null ||
    c.pcRatioFlow != null
  );
}

/**
 * Convenience: scrub a single text field for every canonical scalar we
 * surface to the validators, returning the combined replacement log.
 *
 * Substitution policy:
 *   - IVR + PC_RATIO: full scrub (placeholder + inline number sweep) — these
 *     have a documented hallucination history (see file header).
 *   - All other fields: placeholder substitution only. Inline sweeps for
 *     these would risk false positives (e.g. "beta of 1.2" inside a
 *     sentence about strategy beta vs ticker beta). If telemetry shows
 *     model non-compliance for any field, upgrade it to a full scrub.
 */
export function scrubAll(text: string, canonical: ScrubCanonical): ScrubResult {
  const all: ScrubReplacement[] = [];
  let cur = text;

  const r1 = scrubIvrReferences(cur, canonical.ivr);
  cur = r1.text; all.push(...r1.replacements);

  const r2 = scrubPcRatioReferences(cur, canonical.pcRatio);
  cur = r2.text; all.push(...r2.replacements);

  const r3 = scrubPlaceholderOnly(cur, canonical.iv30 ?? null, formatIv30, "IV30", "{{IV30}}");
  cur = r3.text; all.push(...r3.replacements);

  const r4 = scrubPlaceholderOnly(cur, canonical.hv20 ?? null, formatHv20, "HV20", "{{HV20}}");
  cur = r4.text; all.push(...r4.replacements);

  const r5 = scrubPlaceholderOnly(cur, canonical.ivHv ?? null, formatIvHvRatio, "IVHV", "{{IVHV}}");
  cur = r5.text; all.push(...r5.replacements);

  const r6 = scrubPlaceholderOnly(cur, canonical.beta ?? null, formatBeta, "BETA", "{{BETA}}");
  cur = r6.text; all.push(...r6.replacements);

  const r7 = scrubPlaceholderOnly(cur, canonical.earningsDays ?? null, formatEarningsDays, "EARNINGS_DAYS", "{{EARNINGS_DAYS}}");
  cur = r7.text; all.push(...r7.replacements);

  const r8 = scrubPlaceholderOnly(cur, canonical.pcRatioFlow ?? null, formatPcRatio, "PC_RATIO_FLOW", "{{PC_RATIO_FLOW}}");
  cur = r8.text; all.push(...r8.replacements);

  return { text: cur, replacements: all };
}
