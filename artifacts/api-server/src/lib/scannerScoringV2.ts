/**
 * Unified Scanner composite scoring (v1): deterministic weights and thresholds.
 * Composite uses catalyst_term_shape + iv_vs_realized + flow_quality +
 * earnings_edge_signature + skew_anomaly + macro_density_in_window.
 */

import type { FetchEarningsBundle, EarningsHistoryRow } from "./polygonEarningsHistory.js";
import { isUsableReaction } from "./polygonEarningsHistory.js";
import { countMacroHighMediumBetween } from "./calendarEventChecker.js";
import { flowQualityTapeMultiplier, type TapeCoverageTier } from "./scannerTapeCoverage.js";

/** IV30-proxy one-week implied move (% of spot): IV_decimal × sqrt(7/365) × 100 — matches polygonEarningsHistory.impliedMoveOneWeekFromIv. */
export const IMPLIED_MOVE_PROXY_IV30_DOC =
  "Historical comparison moves use IV30-proxy implied move at prior earnings: ATM IV (decimal) × sqrt(7/365) × 100 (% of spot), same helper as polygonEarningsHistory.impliedMoveOneWeekFromIv(iv_pre).";

export const SCANNER_SUB_SCORE_HIGH = 65;

export type ScannerComponentScoresV1 = Record<string, number> & {
  catalyst_term_shape?: number;
  iv_vs_realized?: number;
  flow_quality?: number;
  earnings_edge_signature?: number;
  skew_anomaly?: number;
  macro_density_in_window?: number;
  implied_move_richness?: number;
  liquidity_anchor_score?: number;
  edge_type?: string;
};

export type TermSlicePoint = {
  expiry: string;
  days_to_exp: number;
  atm_iv: number | null;
};

export type EarningsEdgeSignatureStored = {
  quarters_used: number;
  gap_avg_abs: number | null;
  c2c_avg_abs: number | null;
  five_d_avg_abs: number | null;
  iv_crush_avg_abs: number | null;
  directional_consistency_ratio: number | null;
  avg_implied_vs_actual_ratio: number | null;
  /** Same-sign streak max over sliding windows of size "window" on usable quarters (newest first). */
  directional_streak_max: number;
  score: number;
};

export type ImpliedMoveRichnessStored = {
  /** Current snapshot front-expiry implied move (% of spot). */
  current_implied_move_pct: number | null;
  /** Historical IV-proxy moves at past earnings (same definition as IV30 one-week rule). */
  historical_iv_proxy_moves_pct: number[];
  median_hist_pct: number | null;
  percentile_current_vs_hist: number | null;
  score: number;
  proxy_definition: typeof IMPLIED_MOVE_PROXY_IV30_DOC;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hvToVolPoints(hv: number | null): number | null {
  if (hv == null || !Number.isFinite(hv) || hv <= 0) return null;
  if (hv < 1) return hv * 100;
  return hv;
}

/** IV decimal annualized → one-week implied move % of spot (same as polygonEarningsHistory). */
export function impliedMoveOneWeekFromIvDecimal(ivDecimal: number | null): number | null {
  if (ivDecimal == null || !Number.isFinite(ivDecimal) || ivDecimal <= 0) return null;
  return ivDecimal * Math.sqrt(7 / 365) * 100;
}

function firstListedExpiryOnOrAfter(sortedIsoExpirations: string[], anchorYmd: string): string | null {
  const future = sortedIsoExpirations.filter((exp) => exp >= anchorYmd).sort();
  return future[0] ?? null;
}

function pickFourCurvePoints(args: {
  strip: TermSlicePoint[];
  earningsYmd: string | null;
  listedExpirationsSorted: string[];
}): { near: number | null; preEvent: number | null; event: number | null; postEvent: number | null; captureExpiry: string | null } {
  const { strip, earningsYmd, listedExpirationsSorted } = args;
  const pts = [...strip]
    .filter((p) => p.atm_iv != null && Number.isFinite(p.atm_iv) && (p.days_to_exp ?? 0) > 0)
    .sort((a, b) => a.days_to_exp - b.days_to_exp);
  if (pts.length === 0) return { near: null, preEvent: null, event: null, postEvent: null, captureExpiry: null };

  const near = pts[0]?.atm_iv ?? null;

  if (!earningsYmd || !/^\d{4}-\d{2}-\d{2}$/.test(earningsYmd)) {
    const next = pts[1]?.atm_iv ?? null;
    const far = pts[pts.length - 1]?.atm_iv ?? null;
    return { near, preEvent: near, event: next, postEvent: far, captureExpiry: null };
  }

  const capture = firstListedExpiryOnOrAfter(listedExpirationsSorted, earningsYmd);
  const capturePt = capture ? pts.find((p) => p.expiry === capture) : null;
  const beforeCapture = pts.filter((p) => capture && p.expiry < capture);
  const afterCapture = pts.filter((p) => capture && p.expiry > capture);

  const preEvent = beforeCapture.length ? beforeCapture[beforeCapture.length - 1]!.atm_iv! : near;
  const eventIv = capturePt?.atm_iv ?? null;
  const postEvent = afterCapture.length ? afterCapture[0]!.atm_iv! : pts[pts.length - 1]?.atm_iv ?? null;

  return { near, preEvent, event: eventIv, postEvent, captureExpiry: capture };
}

/**
 * Curve-shape score at earnings capture vs last pre-event expiry, plus inversion penalty.
 */
export function scoreCatalystTermShape(args: {
  strip: TermSlicePoint[];
  earningsYmd: string | null;
  listedExpirationsSorted: string[];
}): { score: number; reason: string | null } {
  const four = pickFourCurvePoints(args);
  const { preEvent, event: eventIv, postEvent, captureExpiry } = four;

  if (eventIv == null || preEvent == null) return { score: 0, reason: null };

  const kink = eventIv - preEvent;
  let score = 0;
  if (kink > 0) {
    if (kink <= 5) score = kink * 6;
    else if (kink <= 15) score = 30 + (kink - 5) * 4;
    else score = Math.min(100, 70 + (kink - 15) * 2);
  }

  const stripSorted = [...args.strip]
    .filter((p) => p.atm_iv != null && (p.days_to_exp ?? 0) > 0)
    .sort((a, b) => a.days_to_exp - b.days_to_exp);
  if (captureExpiry) {
    const idx = stripSorted.findIndex((p) => p.expiry === captureExpiry);
    if (idx >= 0) {
      const prevIv = idx > 0 ? stripSorted[idx - 1]!.atm_iv : null;
      const nextIv = idx < stripSorted.length - 1 ? stripSorted[idx + 1]!.atm_iv : null;
      if (
        prevIv != null
        && nextIv != null
        && eventIv < prevIv
        && eventIv < nextIv
      ) {
        score *= 0.35;
      }
    }
  }

  const reason =
    score > 50
      ? `earnings-capture kink ${kink.toFixed(1)} vol pts vs pre-event${captureExpiry ? ` @ ${captureExpiry}` : ""}`
      : null;

  return { score: clamp(score, 0, 100), reason };
}

export function scoreIvVsRealizedMulti(args: {
  atmIvFront: number | null;
  atmIvPreEvent: number | null;
  atmIvEvent: number | null;
  hv20: number | null;
  hv30: number | null;
}): { score: number; reason: string | null } {
  const hv20p = hvToVolPoints(args.hv20);
  const hv30p = hvToVolPoints(args.hv30);
  const gaps: number[] = [];
  const pushGap = (iv: number | null, hv: number | null) => {
    if (iv != null && hv != null && hv > 0) gaps.push(iv - hv);
  };
  pushGap(args.atmIvFront, hv20p);
  pushGap(args.atmIvFront, hv30p);
  pushGap(args.atmIvPreEvent, hv20p);
  pushGap(args.atmIvPreEvent, hv30p);
  pushGap(args.atmIvEvent, hv20p);
  pushGap(args.atmIvEvent, hv30p);

  if (gaps.length === 0) return { score: 0, reason: null };

  const maxGap = Math.max(...gaps.filter((g) => g > 0));
  if (!Number.isFinite(maxGap) || maxGap <= 0) return { score: 0, reason: null };

  const score = clamp(maxGap * 4.5, 0, 100);
  const reason =
    score > 60
      ? `IV rich vs HV: max positive gap ${maxGap.toFixed(1)} vol pts (HV20/HV30, multi-expiry)`
      : null;
  return { score, reason };
}

function scoreSkewAnomaly(skewPts: number | null): { score: number; reason: string | null } {
  if (skewPts == null || !Number.isFinite(skewPts)) return { score: 0, reason: null };
  const absSkew = Math.abs(skewPts);
  let score = 0;
  if (absSkew < 2) score = 0;
  else if (absSkew < 5) score = (absSkew - 2) * 15;
  else if (absSkew < 10) score = 45 + (absSkew - 5) * 8;
  else score = Math.min(100, 85 + (absSkew - 10) * 2);
  const reason =
    score > 50 ? `25Δ skew ${skewPts.toFixed(2)} vol pts (clean first expiry)` : null;
  return { score: Math.min(100, score), reason };
}

export function getIvRvAtmPoints(args: {
  strip: TermSlicePoint[];
  earningsYmd: string | null;
  listedExpirationsSorted: string[];
}): { front: number | null; preEvent: number | null; event: number | null } {
  const four = pickFourCurvePoints(args);
  return { front: four.near, preEvent: four.preEvent, event: four.event };
}

export function macroDensityInWindow(args: {
  now: Date;
  windowEndYmd: string | null;
}): { count: number; score: number; reason: string | null } {
  if (!args.windowEndYmd || !/^\d{4}-\d{2}-\d{2}$/.test(args.windowEndYmd)) {
    return { count: 0, score: 0, reason: null };
  }
  const start = args.now.toISOString().slice(0, 10);
  const count = countMacroHighMediumBetween(start, args.windowEndYmd);
  const score = clamp(count * 12, 0, 60);
  const reason = score > 55 ? `macro density ${count} HIGH/MEDIUM events before candidate expiry` : null;
  return { count, score, reason };
}

export function scoreFlowQualityV1(args: {
  tapeKind: "live" | "eod_fallback" | "none";
  sessionAggregateSource: "live_raw_trades" | "eod_volume_only" | "none";
  askNotionalUsd: number;
  tierThresholdUsd: number;
  totals: {
    askCount: number;
    bidCount: number;
    midCount: number;
    unknownCount: number;
    totalPrints: number;
    askNotionalUsd: number;
    bidNotionalUsd: number;
    midNotionalUsd: number;
    unknownNotionalUsd: number;
  } | null;
  topPrints: Array<{ strike: number; isBlock?: boolean; side?: string | null }> | null;
  tapeCoverageTier?: TapeCoverageTier;
}): { score: number; reason: string | null } {
  const tier = args.tapeCoverageTier ?? "not_run";
  if (tier === "not_run") {
    return { score: 0, reason: null };
  }
  if (args.tapeKind !== "live" || args.sessionAggregateSource !== "live_raw_trades") {
    return { score: 0, reason: null };
  }
  if (args.askNotionalUsd < args.tierThresholdUsd) return { score: 0, reason: null };

  const t = args.totals;
  const totalP = t && t.totalPrints > 0 ? t.totalPrints : 0;
  const knownSideCoverage =
    t && totalP > 0 ? (t.askCount + t.bidCount) / totalP : 0;

  const notionalTotal =
    t != null
      ? t.askNotionalUsd + t.bidNotionalUsd + t.midNotionalUsd + t.unknownNotionalUsd
      : args.askNotionalUsd;
  const askShare = notionalTotal > 0 ? args.askNotionalUsd / notionalTotal : 0;

  let base = 0;
  if (notionalTotal > 0) {
    const thrMult = clamp(args.askNotionalUsd / args.tierThresholdUsd, 1, 3);
    base = Math.min(100, askShare * 100 * (thrMult / 3));
  }

  const coverageFactor = clamp(0.55 + knownSideCoverage * 0.45, 0, 1);

  let repeatBonus = 0;
  if (args.topPrints && args.topPrints.length) {
    const blockSameSide = new Map<string, number>();
    for (const p of args.topPrints) {
      if (!p.isBlock) continue;
      const side = p.side === "ask" || p.side === "bid" ? p.side : "";
      if (!side) continue;
      const k = `${p.strike}|${side}`;
      blockSameSide.set(k, (blockSameSide.get(k) ?? 0) + 1);
    }
    const maxRepeat = Math.max(0, ...[...blockSameSide.values()]);
    if (maxRepeat >= 3) repeatBonus = 12;
    else if (maxRepeat === 2) repeatBonus = 6;
  }

  let score = clamp(base * coverageFactor + repeatBonus, 0, 100);

  const midShare =
    t && totalP > 0 ? t.midCount / totalP : 0;
  if (midShare > 0.4) {
    score *= clamp(1 - (midShare - 0.4) * 2.2, 0.35, 1);
  }

  const tapeTierMult = flowQualityTapeMultiplier(tier);
  score *= tapeTierMult;

  let flowReason: string | null = null;
  if (score > 60) {
    flowReason = `flow quality ${score.toFixed(0)} (coverage ${(knownSideCoverage * 100).toFixed(0)}%)`;
  }
  if (tier === "partial") {
    flowReason = flowReason ? `${flowReason}; flow_quality_low (tape coverage)` : "flow_quality_low (tape coverage)";
  }

  return { score, reason: flowReason };
}

export function buildEarningsEdgeSignature(bundle: FetchEarningsBundle): EarningsEdgeSignatureStored {
  const hist = [...bundle.earnings_history].filter(isUsableReaction).slice(0, 8);
  const usable = hist.slice(0, Math.min(8, Math.max(4, hist.length)));

  const gaps: number[] = [];
  const c2cs: number[] = [];
  const fives: number[] = [];
  const crushes: number[] = [];
  const ratios: number[] = [];
  const dirs: number[] = [];

  for (const row of usable) {
    const g = row.price_reaction.gap_open_pct;
    const c2c = row.price_reaction.close_to_close_pct;
    const f = row.price_reaction.five_day_return_pct;
    if (g != null) gaps.push(Math.abs(g));
    if (c2c != null) c2cs.push(Math.abs(c2c));
    if (f != null) fives.push(Math.abs(f));
    const crush = row.iv_reaction.iv_crush_pct;
    if (crush != null) crushes.push(Math.abs(crush));

    const implied = row.iv_reaction.implied_move_at_close_pct;
    const actual =
      g != null ? Math.abs(g)
      : c2c != null ? Math.abs(c2c)
      : null;
    if (implied != null && actual != null && implied > 0) {
      ratios.push(implied / actual);
    }

    if (g != null && g !== 0) dirs.push(Math.sign(g));
    else if (c2c != null && c2c !== 0) dirs.push(Math.sign(c2c));
    else if (f != null && f !== 0) dirs.push(Math.sign(f));
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  let streakMax = 0;
  if (dirs.length >= 2) {
    for (let w = Math.min(4, dirs.length); w >= 2; w--) {
      for (let i = 0; i + w <= dirs.length; i++) {
        const slice = dirs.slice(i, i + w);
        const s0 = slice[0]!;
        if (slice.every((d) => d === s0)) streakMax = Math.max(streakMax, w);
      }
    }
  }

  const sameDirTop4 =
    dirs.length >= 4 && dirs.slice(0, 4).every((d) => d === dirs[0]!) ? 1 : 0;

  let score = 0;
  const gapA = avg(gaps);
  const c2cA = avg(c2cs);
  const fiveA = avg(fives);
  const crushA = avg(crushes);
  if (gapA != null) score += clamp(gapA * 1.1, 0, 22);
  if (c2cA != null) score += clamp(c2cA * 1.0, 0, 22);
  if (fiveA != null) score += clamp(fiveA * 0.55, 0, 22);
  if (crushA != null) score += clamp(crushA * 0.35, 0, 18);

  const ratioMed =
    ratios.length ? ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)]! : null;
  if (ratioMed != null && Number.isFinite(ratioMed)) {
    const ratioScore = ratioMed >= 1 ? clamp((ratioMed - 1) * 55, 0, 22) : clamp((1 - ratioMed) * 40, 0, 14);
    score += ratioScore;
  }

  if (sameDirTop4 === 1) score += 18;
  else if (streakMax >= 3) score += 12;

  score = clamp(score, 0, 100);

  const consistencyRatio =
    dirs.length > 0 ? dirs.filter((d) => d === dirs[0]).length / dirs.length : null;

  return {
    quarters_used: usable.length,
    gap_avg_abs: gapA,
    c2c_avg_abs: c2cA,
    five_d_avg_abs: fiveA,
    iv_crush_avg_abs: crushA,
    directional_consistency_ratio: consistencyRatio,
    avg_implied_vs_actual_ratio: ratioMed,
    directional_streak_max: streakMax,
    score,
  };
}

export function scoreImpliedMoveRichness(args: {
  currentImpliedMovePct: number | null;
  historicalRows: EarningsHistoryRow[];
}): ImpliedMoveRichnessStored {
  const moves: number[] = [];
  for (const row of args.historicalRows) {
    const ivPre = row.iv_reaction.iv_at_close_pre_earnings;
    const dec =
      ivPre != null && ivPre > 1 ? ivPre / 100
      : ivPre != null && ivPre > 0 ? ivPre
      : null;
    const m = impliedMoveOneWeekFromIvDecimal(dec);
    if (m != null) moves.push(m);
  }

  const sorted = [...moves].sort((a, b) => a - b);
  const med =
    sorted.length === 0 ? null
    : sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;

  let percentile: number | null = null;
  let score = 0;
  const cur = args.currentImpliedMovePct;
  if (cur != null && sorted.length > 0 && med != null && med > 0) {
    let below = 0;
    for (const x of sorted) if (x < cur) below += 1;
    percentile = below / sorted.length;
    const ratio = cur / med;
    score = clamp((ratio - 1) * 55 + percentile * 28, 0, 100);
  }

  return {
    current_implied_move_pct: cur,
    historical_iv_proxy_moves_pct: moves.slice(0, 24),
    median_hist_pct: med,
    percentile_current_vs_hist: percentile,
    score,
    proxy_definition: IMPLIED_MOVE_PROXY_IV30_DOC,
  };
}

export function liquidityAnchorFromFrontExpiry(args: {
  calls: Array<{ strike: number; openInterest?: number | null }>;
  puts: Array<{ strike: number; openInterest?: number | null }>;
  spot: number;
}): { score: number; maxOi: number; deepestStrike: number | null } {
  if (!Number.isFinite(args.spot) || args.spot <= 0) return { score: 0, maxOi: 0, deepestStrike: null };
  const lo = args.spot * 0.95;
  const hi = args.spot * 1.05;
  let maxOi = 0;
  let deepestStrike: number | null = null;
  let deepestOi = 0;

  const consider = (strike: number, oi: number | null | undefined) => {
    if (oi == null || !Number.isFinite(oi) || oi <= 0) return;
    if (strike < lo || strike > hi) return;
    if (oi > maxOi) maxOi = Math.round(oi);
    if (oi > deepestOi) {
      deepestOi = oi;
      deepestStrike = strike;
    }
  };

  for (const c of args.calls) consider(c.strike, c.openInterest);
  for (const p of args.puts) consider(p.strike, p.openInterest);

  const score = clamp(Math.log10(1 + maxOi) * 14, 0, 62);
  return { score, maxOi: Math.round(maxOi), deepestStrike };
}

export function scannerCompositeV1(c: ScannerComponentScoresV1): number {
  const term = Number(c.catalyst_term_shape ?? 0);
  const ivRv = Number(c.iv_vs_realized ?? 0);
  const flow = Number(c.flow_quality ?? 0);
  const edge = Number(c.earnings_edge_signature ?? 0);
  const skew = Number(c.skew_anomaly ?? 0);
  const macro = Number(c.macro_density_in_window ?? 0);

  return clamp(
    term * 0.3 + ivRv * 0.25 + flow * 0.2 + edge * 0.15 + skew * 0.05 + macro * 0.05,
    0,
    100,
  );
}

export function surfacedSubScoresHigh(comps: ScannerComponentScoresV1): string[] {
  const keys = [
    "catalyst_term_shape",
    "iv_vs_realized",
    "flow_quality",
    "earnings_edge_signature",
    "skew_anomaly",
    "macro_density_in_window",
    "implied_move_richness",
    "liquidity_anchor_score",
  ] as const;
  const out: string[] = [];
  for (const k of keys) {
    const v = Number(comps[k] ?? 0);
    if (v >= SCANNER_SUB_SCORE_HIGH) out.push(k);
  }
  return out;
}
