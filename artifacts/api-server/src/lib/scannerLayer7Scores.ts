/**
 * Scanner Layer 7 — per-symbol 0–100 component scores (Layers 2–6) and a weighted composite.
 * Used for scanner V3 cards, Layer 8 preset gates, and strategist handoff context.
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

/** Composite weights (sum = 1). Tuned for options-scanner emphasis on vol + flow; may be revised after live review. */
export const SCANNER_LAYER7_COMPOSITE_WEIGHTS = {
  liquidity: 0.15,
  volatility: 0.25,
  catalyst: 0.2,
  flow: 0.2,
  technical: 0.2,
} as const;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Liquidity (Layer 2): blend of relative volume (volume / avgVolume20d) and dollar-volume tier (volume × price).
 * Higher liquidity → higher score. Null when volume, average volume, or price is missing or invalid.
 */
export function scoreLiquidity(
  volume: number | null,
  avgVolume20d: number | null,
  price: number | null,
): number | null {
  if (volume == null || avgVolume20d == null || price == null) return null;
  if (!Number.isFinite(volume) || !Number.isFinite(avgVolume20d) || !Number.isFinite(price)) return null;
  if (avgVolume20d <= 0 || volume < 0 || price <= 0) return null;

  const rel = volume / avgVolume20d;
  const relScore = clamp(22 + rel * 38, 0, 100);

  const notional = volume * price;
  const logN = Math.log10(1 + notional);
  const notionalScore = clamp((logN - 5.2) * 22 + 18, 0, 100);

  const blended = 0.55 * relScore + 0.45 * notionalScore;
  return Math.round(clamp(blended, 0, 100));
}

/**
 * Volatility / vol context (Layer 3): IVR is dominant; IV30 level and IV vs HV ratio add smaller tilts when present.
 * Higher IV / IVR → higher score. Null when IVR is unknown (primary signal).
 */
export function scoreVolatility(args: {
  ivr: number | null;
  iv30: number | null;
  ivVsHv: number | null;
}): number | null {
  if (args.ivr == null || !Number.isFinite(args.ivr)) return null;

  const ivrClamped = clamp(args.ivr, 0, 100);
  let vol = 0.72 * ivrClamped;

  const iv30 = args.iv30;
  if (iv30 != null && Number.isFinite(iv30) && iv30 > 0) {
    const ivPct = iv30 * 100;
    vol += clamp((ivPct - 18) * 0.32, 0, 14);
  }

  const ratio = args.ivVsHv;
  if (ratio != null && Number.isFinite(ratio) && ratio > 0) {
    vol += clamp((ratio - 0.9) * 42, -6, 14);
  }

  return Math.round(clamp(vol, 0, 100));
}

/**
 * Catalyst (Layer 4): nearer scheduled earnings and larger |reaction| history raise the score.
 * `0` when the next earnings date is known but more than 30 sessions away; `null` when days-to-earnings is unknown.
 */
export function scoreCatalyst(args: {
  daysToEarnings: number | null;
  reactionsLast4q: number[] | null;
}): number | null {
  const d = args.daysToEarnings;
  if (d == null || !Number.isFinite(d)) return null;

  const days = Math.round(d);
  if (days > 30) return 0;

  let windowScore = 35;
  if (days < 1) windowScore = 88;
  else if (days <= 3) windowScore = 88;
  else if (days <= 7) windowScore = 80;
  else if (days <= 14) windowScore = 72;
  else if (days <= 30) windowScore = 58;

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

/**
 * Flow (Layer 5): activity-level, direction-agnostic (uses |net delta $|). Null when there is no flow row
 * or no 4h contract volume (no prints in window).
 */
export function scoreFlow(flow: ScannerFlowLayer5Wire | null): number | null {
  if (flow == null) return null;
  const vol = flow.volume_4h;
  if (vol == null || !Number.isFinite(vol) || vol <= 0) return null;

  const blocks = flow.blocks_4h ?? 0;
  const sweeps = flow.sweeps_4h ?? 0;
  const net = flow.net_delta_dollar;
  const netMag = net != null && Number.isFinite(net) ? Math.abs(net) : 0;
  const voi = flow.volume_over_oi;

  const vTerm = clamp(Math.log10(1 + vol) * 6.5 + 8, 0, 48);
  const blockTerm = Math.min(Math.max(0, blocks), 14) * 1.65;
  const sweepTerm = Math.min(Math.max(0, sweeps), 20) * 0.95;
  const netTerm = netMag > 0 ? clamp(Math.log10(1 + netMag / 40_000) * 8.5, 0, 22) : 0;
  const voiTerm =
    voi != null && Number.isFinite(voi) && voi >= 0 ? clamp(Math.log10(1 + Math.max(voi, 1e-9)) * 14, 0, 18) : 0;

  return Math.round(clamp(vTerm + blockTerm + sweepTerm + netTerm + voiTerm, 0, 100));
}

/**
 * Technical (Layer 6): directional 0–100 (high = bullish vs MAs / returns / proximity to 52w high; low = weak / bearish).
 * Null when no MA distance, return, or off-high field is populated.
 */
export function scoreTechnical(t: ScannerTechnicalLayer6Wire | null): number | null {
  if (t == null) return null;

  const vs = [t.vs_twenty_ma_pct, t.vs_fifty_ma_pct, t.vs_two_hundred_ma_pct].filter(
    (x): x is number => x != null && Number.isFinite(x),
  );
  const maAvg = vs.length > 0 ? vs.reduce((a, b) => a + b, 0) / vs.length : null;

  const five = t.five_day_return_pct;
  const thirty = t.thirty_day_return_pct;
  const off = t.off_fifty_two_week_high_pct;

  if (maAvg == null && five == null && thirty == null && off == null) return null;

  let delta = 0;
  if (maAvg != null) delta += clamp(maAvg * 0.9, -28, 28);
  if (five != null && Number.isFinite(five)) delta += clamp(five * 0.48, -22, 22);
  if (thirty != null && Number.isFinite(thirty)) delta += clamp(thirty * 0.28, -16, 16);
  if (off != null && Number.isFinite(off)) delta += clamp(off * 0.38, -20, 12);

  return Math.round(clamp(50 + delta, 0, 100));
}

/** Weighted composite over non-null components; weights renormalize when some legs are null. */
export function computeWeightedComposite(scores: {
  liquidity: number | null;
  volatility: number | null;
  catalyst: number | null;
  flow: number | null;
  technical: number | null;
}): number | null {
  type WKey = keyof typeof SCANNER_LAYER7_COMPOSITE_WEIGHTS;
  let num = 0;
  let den = 0;
  for (const k of Object.keys(SCANNER_LAYER7_COMPOSITE_WEIGHTS) as WKey[]) {
    const w = SCANNER_LAYER7_COMPOSITE_WEIGHTS[k];
    const s =
      k === "liquidity"
        ? scores.liquidity
        : k === "volatility"
          ? scores.volatility
          : k === "catalyst"
            ? scores.catalyst
            : k === "flow"
              ? scores.flow
              : scores.technical;
    if (s != null && Number.isFinite(s)) {
      num += w * s;
      den += w;
    }
  }
  if (den <= 0) return null;
  return Math.round(clamp(num / den, 0, 100));
}

export type ScannerLayer7CardInput = {
  volume: number | null;
  avg_volume_20d: number | null;
  price: number | null;
  iv30: number | null;
  ivr: number | null;
  iv_vs_hv: number | null;
  days_to_earnings: number | null;
  reactions_last_4q: number[] | null;
  flow: ScannerFlowLayer5Wire | null;
  technical: ScannerTechnicalLayer6Wire | null;
};

export function computeScannerLayer7Scores(card: ScannerLayer7CardInput): ScannerLayer7Scores {
  const liquidityScore = scoreLiquidity(card.volume, card.avg_volume_20d, card.price);
  const volatilityScore = scoreVolatility({
    ivr: card.ivr,
    iv30: card.iv30,
    ivVsHv: card.iv_vs_hv,
  });
  const catalystScore = scoreCatalyst({
    daysToEarnings: card.days_to_earnings,
    reactionsLast4q: card.reactions_last_4q,
  });
  const flowScore = scoreFlow(card.flow);
  const technicalScore = scoreTechnical(card.technical);

  const compositeScore = computeWeightedComposite({
    liquidity: liquidityScore,
    volatility: volatilityScore,
    catalyst: catalystScore,
    flow: flowScore,
    technical: technicalScore,
  });

  return {
    liquidityScore,
    volatilityScore,
    catalystScore,
    flowScore,
    technicalScore,
    compositeScore,
  };
}
