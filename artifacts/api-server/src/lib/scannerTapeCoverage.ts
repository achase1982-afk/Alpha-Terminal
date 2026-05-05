/**
 * Graduated tape coverage tiers for scanner flow scoring (vs binary disqualifiers).
 * Requires scanner_tape_metrics row from last strategist tape backfill when available.
 */

export type TapeCoverageTier =
  | "complete"
  | "high"
  | "degraded"
  | "partial"
  | "not_run";

export type TapeCoverageInputs = {
  occRequested: number;
  occCompleted: number;
  tradesAttemptedInsert: number;
  tradesInsertedCommitted: number;
  dedupeDropped: number;
  anyTruncated: boolean;
  /** Underlying tape pipeline status from strategistTapeBackfill (skipped/failed/partial/complete). */
  pipelineStatus: string;
};

/**
 * Classify coverage:
 * - complete: ≥95% OCC completion AND ≥95% insert success vs attempted rows, no truncation
 * - high: 80–95% on both dimensions (when denominators allow), else max of the two bands
 * - degraded: 50–80%
 * - partial: <50%
 * - not_run: pipeline never ran or failed entirely before OCC work
 */
export function classifyTapeCoverageTier(inp: TapeCoverageInputs): TapeCoverageTier {
  const { pipelineStatus } = inp;
  if (pipelineStatus === "skipped" || pipelineStatus === "failed") {
    return "not_run";
  }

  const occReq = Math.max(0, inp.occRequested);
  const occDone = Math.max(0, inp.occCompleted);
  const tried = Math.max(0, inp.tradesAttemptedInsert);
  const ins = Math.max(0, inp.tradesInsertedCommitted);

  if (occReq === 0 && tried === 0) {
    if (pipelineStatus === "complete" || pipelineStatus === "partial") {
      return "high";
    }
    return "not_run";
  }

  const occRatio = occReq > 0 ? occDone / occReq : 1;
  let insertRatio = 1;
  if (tried > 0) {
    insertRatio = ins / tried;
  } else if (occReq > 0) {
    insertRatio = occRatio;
  }

  const worstRatio = Math.min(occRatio, insertRatio);

  const meetsCompleteGate =
    occRatio >= 0.95
    && insertRatio >= 0.95
    && !inp.anyTruncated
    && (pipelineStatus === "complete" || pipelineStatus === "partial");

  if (meetsCompleteGate && worstRatio >= 0.95) {
    return "complete";
  }

  if (worstRatio >= 0.95 && inp.anyTruncated) {
    return "high";
  }

  if (worstRatio >= 0.8) return "high";
  if (worstRatio >= 0.5) return "degraded";
  return "partial";
}

/** Multiplier applied to raw flow_quality before caps (tier graduated penalties). */
export function flowQualityTapeMultiplier(tier: TapeCoverageTier): number {
  switch (tier) {
    case "complete":
    case "high":
      return 1;
    case "degraded":
      return 0.7;
    case "partial":
      return 0.4;
    case "not_run":
      return 0;
    default:
      return 0;
  }
}
