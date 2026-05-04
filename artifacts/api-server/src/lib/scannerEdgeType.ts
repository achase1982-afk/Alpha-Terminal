/**
 * Deterministic edge labels shared by Discovery, Momentum, and Unusual Flow scanners.
 * Rules are applied in order; first match wins.
 */

export type ScannerEdgeType =
  | "premium_sale"
  | "premium_buy"
  | "directional_bullish"
  | "directional_bearish"
  | "calendar"
  | "no_clear_edge";

/** Inputs shared across scanners (null = unknown / skip that clause). */
export interface EdgeTypeClassifierInput {
  /** IV30 / HV20 when both are in comparable units (ratio is dimensionless). */
  iv30OverHv20: number | null;
  /** Calendar days to next known catalyst (e.g. earnings). Null if unknown. */
  daysToNextCatalyst: number | null;
  /** Implied vol rank 0–100. */
  ivr: number | null;
  /** Nearest non-trivial expiry ATM IV in volatility points (e.g. 32 for 32%). */
  frontAtmIvVolPoints: number | null;
  /** 30+ DTE ATM IV in volatility points. */
  backAtmIvVolPoints: number | null;
  /** Unusual / institutional-leaning call flow with ask-side bias signal. */
  unusualCallFlowAskBias: boolean;
  /** Unusual put flow with ask-side bias signal. */
  unusualPutFlowAskBias: boolean;
  /** Call-side size proxy notional (USD) for institutional / block-style participation. */
  blockNotionalCallUsd?: number;
  /** Put-side size proxy notional (USD). */
  blockNotionalPutUsd?: number;
  /** Directional synthesis from the scanner (BULLISH / BEARISH / MIXED / null). */
  directionalLean: "BULLISH" | "BEARISH" | "MIXED" | null;
}

/** Normalize Schwab / Polygon IV to percent points (0–200+). */
export function impliedVolToVolPoints(iv: number | null | undefined): number | null {
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return null;
  if (iv <= 3) return iv * 100;
  return iv;
}

/**
 * Apply edge-type rules in order (first match wins).
 * See product spec: premium_buy, premium_sale, calendar, directional_*, no_clear_edge.
 */
export function classifyEdgeType(input: EdgeTypeClassifierInput): ScannerEdgeType {
  const { iv30OverHv20, daysToNextCatalyst, ivr, frontAtmIvVolPoints, backAtmIvVolPoints } = input;

  // 1. premium_buy
  if (
    iv30OverHv20 != null &&
    iv30OverHv20 < 0.85 &&
    daysToNextCatalyst != null &&
    daysToNextCatalyst <= 14
  ) {
    return "premium_buy";
  }

  // 2. premium_sale
  if (
    ivr != null &&
    ivr > 70 &&
    daysToNextCatalyst != null &&
    daysToNextCatalyst > 30 &&
    iv30OverHv20 != null &&
    iv30OverHv20 > 1.05
  ) {
    return "premium_sale";
  }

  // 3. calendar (front IV minus back IV > 8 vol points — front elevated)
  if (
    frontAtmIvVolPoints != null &&
    backAtmIvVolPoints != null &&
    frontAtmIvVolPoints - backAtmIvVolPoints > 8
  ) {
    return "calendar";
  }

  // 4–5. directional (unusual flow + ask bias proxy + block notional + lean)
  const callN = input.blockNotionalCallUsd ?? 0;
  const putN = input.blockNotionalPutUsd ?? 0;
  if (
    input.unusualCallFlowAskBias &&
    callN > 250_000 &&
    input.directionalLean === "BULLISH"
  ) {
    return "directional_bullish";
  }
  if (
    input.unusualPutFlowAskBias &&
    putN > 250_000 &&
    input.directionalLean === "BEARISH"
  ) {
    return "directional_bearish";
  }

  return "no_clear_edge";
}

export interface StrikeIvRow {
  strike: number;
  dte: number | null;
  impliedVolatility: number | null;
}

/**
 * Pick ATM-ish IV (vol points) for a front window and a 30+ DTE window from per-strike snapshots.
 */
export function extractFrontBackAtmIvVolPoints(
  strikes: StrikeIvRow[],
  spot: number,
  opts?: { strikeBandPct?: number; frontDteMin?: number; frontDteMax?: number; backDteMin?: number },
): { front: number | null; back: number | null } {
  const band = opts?.strikeBandPct ?? 0.1;
  const frontMin = opts?.frontDteMin ?? 7;
  const frontMax = opts?.frontDteMax ?? 45;
  const backMin = opts?.backDteMin ?? 30;

  const near = strikes.filter((s) => {
    if (spot <= 0) return false;
    const d = s.dte ?? 0;
    if (d < frontMin || d > frontMax) return false;
    const ivp = impliedVolToVolPoints(s.impliedVolatility);
    if (ivp == null) return false;
    return Math.abs(s.strike - spot) / spot <= band;
  });
  const far = strikes.filter((s) => {
    if (spot <= 0) return false;
    const d = s.dte ?? 0;
    if (d < backMin) return false;
    const ivp = impliedVolToVolPoints(s.impliedVolatility);
    if (ivp == null) return false;
    return Math.abs(s.strike - spot) / spot <= band;
  });

  const pickMedianIv = (rows: StrikeIvRow[]): number | null => {
    if (rows.length === 0) return null;
    const ivs = rows
      .map((r) => impliedVolToVolPoints(r.impliedVolatility))
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b);
    if (ivs.length === 0) return null;
    const mid = Math.floor(ivs.length / 2);
    return ivs.length % 2 === 0 ? (ivs[mid - 1] + ivs[mid]) / 2 : ivs[mid];
  };

  return { front: pickMedianIv(near), back: pickMedianIv(far) };
}

export function calendarDaysToDate(fromYmd: string, toYmd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return null;
  const a = new Date(`${fromYmd}T00:00:00Z`).getTime();
  const b = new Date(`${toYmd}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.ceil((b - a) / 86_400_000);
}

/** Session tape ask vs bid mix when present; else fall back to unusual skew + volume. */
export function unusualFlowAskBiasFromHighlights(h: {
  unusualSkew: "bullish" | "bearish" | "balanced" | "none";
  unusualCallVolume: number;
  unusualPutVolume: number;
  sessionTape?: {
    aggressorSessionTotals?: { askCount: number; bidCount: number; totalPrints: number };
  } | null;
} | null): { callAsk: boolean; putAsk: boolean } {
  if (!h) return { callAsk: false, putAsk: false };
  const totals = h.sessionTape?.aggressorSessionTotals;
  if (totals && totals.totalPrints > 0) {
    const askHeavy = totals.askCount > totals.bidCount;
    return {
      callAsk: askHeavy && h.unusualSkew === "bullish" && h.unusualCallVolume > 0,
      putAsk: askHeavy && h.unusualSkew === "bearish" && h.unusualPutVolume > 0,
    };
  }
  return {
    callAsk: h.unusualSkew === "bullish" && h.unusualCallVolume > 0,
    putAsk: h.unusualSkew === "bearish" && h.unusualPutVolume > 0,
  };
}
