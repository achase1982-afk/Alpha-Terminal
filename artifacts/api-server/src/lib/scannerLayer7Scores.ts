/**
 * Scanner Layer 7 — normalized 0–100 component scores for composite display and Layer 8 preset gates.
 * Uses Layer 2 quote fields, Layer 3 IVR, Layer 4 catalysts, Layer 5 flow, Layer 6 technicals.
 */

import type { ScannerFlowLayer5Wire } from "./scannerFlowContext.js";
import type { ScannerTechnicalLayer6Wire } from "./scannerTechnicalContext.js";

export type ScannerLayer7Scores = {
  liquidityScore: number | null;
  volatilityScore: number | null;
  catalystScore: number | null;
  flowScore: number | null;
  technicalScore: number | null;
  compositeScore: number | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Relative volume vs 20d average; null when inputs missing. */
export function scoreLiquidity(volume: number | null, avgVolume20d: number | null): number | null {
  if (volume == null || avgVolume20d == null || !Number.isFinite(volume) || !Number.isFinite(avgVolume20d)) {
    return null;
  }
  if (avgVolume20d <= 0 || volume < 0) return null;
  const rel = volume / avgVolume20d;
  const raw = 28 + rel * 42;
  return Math.round(clamp(raw, 0, 100));
}

/** Implied volatility rank (0–100) from Layer 3 when present. */
export function scoreVolatility(ivr: number | null): number | null {
  if (ivr == null || !Number.isFinite(ivr)) return null;
  return Math.round(clamp(ivr, 0, 100));
}

/**
 * Proximity to earnings + historical earnings-move volatility (reactions).
 * Null when no scheduled earnings window is known.
 */
export function scoreCatalyst(args: {
  daysToEarnings: number | null;
  reactionsLast4q: number[] | null;
}): number | null {
  const d = args.daysToEarnings;
  if (d == null || !Number.isFinite(d)) return null;

  let windowScore = 35;
  if (d >= 1 && d <= 3) windowScore = 88;
  else if (d <= 7) windowScore = 80;
  else if (d <= 14) windowScore = 72;
  else if (d <= 30) windowScore = 58;
  else if (d <= 60) windowScore = 48;

  let reactionBoost = 0;
  const rx = args.reactionsLast4q;
  if (rx != null && rx.length > 0) {
    const absVals = rx.map((x) => Math.abs(x)).filter((x) => Number.isFinite(x));
    if (absVals.length > 0) {
      const meanAbs = absVals.reduce((a, b) => a + b, 0) / absVals.length;
      reactionBoost = clamp(meanAbs * 1.8, 0, 28);
    }
  }

  return Math.round(clamp(windowScore + reactionBoost, 0, 100));
}

/** Options-flow activity in the 4h window; null when Layer 5 returned no row. */
export function scoreFlow(flow: ScannerFlowLayer5Wire | null): number | null {
  if (flow == null) return null;
  const vol = flow.volume_4h;
  if (vol == null || !Number.isFinite(vol) || vol <= 0) return null;

  const blocks = flow.blocks_4h ?? 0;
  const sweeps = flow.sweeps_4h ?? 0;
  const v = Math.log10(1 + vol);
  const raw = 36 + v * 14 + Math.min(blocks, 12) * 2.1 + Math.min(sweeps, 18) * 1.2;
  return Math.round(clamp(raw, 0, 100));
}

/**
 * Trend / positioning strength from MA distances and short-term return.
 * Higher when price is extended vs MAs or 5d move is large (momentum).
 * Moderate when MA spreads are small (consolidation band for preset filters).
 */
export function scoreTechnical(t: ScannerTechnicalLayer6Wire | null): number | null {
  if (t == null) return null;

  const parts: number[] = [];
  for (const x of [t.vs_twenty_ma_pct, t.vs_fifty_ma_pct, t.vs_two_hundred_ma_pct]) {
    if (x != null && Number.isFinite(x)) parts.push(Math.abs(x));
  }
  const maAvg = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : null;

  const fd = t.five_day_return_pct;
  const five = fd != null && Number.isFinite(fd) ? Math.abs(fd) : null;

  if (maAvg == null && five == null) return null;

  const maTerm = maAvg != null ? clamp(maAvg * 1.15, 0, 55) : 0;
  const retTerm = five != null ? clamp(five * 2.8, 0, 45) : 0;
  const base = maAvg != null || five != null ? 28 : 0;
  const raw = base + maTerm + retTerm;
  return Math.round(clamp(raw, 0, 100));
}

export type ScannerLayer7CardInput = {
  volume: number | null;
  avg_volume_20d: number | null;
  ivr: number | null;
  days_to_earnings: number | null;
  reactions_last_4q: number[] | null;
  flow: ScannerFlowLayer5Wire | null;
  technical: ScannerTechnicalLayer6Wire | null;
};

export function computeScannerLayer7Scores(card: ScannerLayer7CardInput): ScannerLayer7Scores {
  const liquidityScore = scoreLiquidity(card.volume, card.avg_volume_20d);
  const volatilityScore = scoreVolatility(card.ivr);
  const catalystScore = scoreCatalyst({
    daysToEarnings: card.days_to_earnings,
    reactionsLast4q: card.reactions_last_4q,
  });
  const flowScore = scoreFlow(card.flow);
  const technicalScore = scoreTechnical(card.technical);

  const parts = [liquidityScore, volatilityScore, catalystScore, flowScore, technicalScore].filter(
    (x): x is number => x != null && Number.isFinite(x),
  );
  const compositeScore =
    parts.length === 0 ? null : Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);

  return {
    liquidityScore,
    volatilityScore,
    catalystScore,
    flowScore,
    technicalScore,
    compositeScore,
  };
}
