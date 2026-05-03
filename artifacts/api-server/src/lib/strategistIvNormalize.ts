import { bsPrice } from "./bsmIV.js";

export const STRATEGIST_IV_CEILING_PCT = 400;

export type StrategistIvSource = "chain" | "reconstructed_from_straddle";

export interface NormalizedIv {
  /** Display IV in percent (e.g. 41.25). */
  pct: number;
  clamped: boolean;
  unreliable: boolean;
  source: StrategistIvSource;
}

export function isReliableIv(n: NormalizedIv): boolean {
  return !n.clamped && !n.unreliable;
}

/**
 * Unified IV normalization for strategist payloads (Item 16).
 * Raw chain IV is treated as decimal (0.4125 → 41.25%).
 */
export function normalizeStrategistIv(
  raw: number | null | undefined,
  source: StrategistIvSource = "chain",
): NormalizedIv {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return { pct: 0, clamped: false, unreliable: true, source };
  }
  const pct = Math.round(raw * 10000) / 100;
  if (pct > STRATEGIST_IV_CEILING_PCT) {
    return {
      pct: STRATEGIST_IV_CEILING_PCT,
      clamped: true,
      unreliable: true,
      source,
    };
  }
  return { pct, clamped: false, unreliable: false, source };
}

/**
 * Bisection on σ to match observed ATM straddle mid (call+put) / share (Item 18).
 * Returns annualized σ as decimal (e.g. 0.35), or null.
 */
export function impliedVolFromAtmStraddle(args: {
  spot: number;
  strike: number;
  dteCalendarDays: number;
  straddleMidPerShare: number;
  riskFreeAnnual: number;
  dividendYieldAnnual: number;
}): number | null {
  const { spot, strike, dteCalendarDays, straddleMidPerShare, riskFreeAnnual, dividendYieldAnnual } = args;
  if (!Number.isFinite(spot) || spot <= 0) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (dteCalendarDays < 1) return null;
  if (!Number.isFinite(straddleMidPerShare) || straddleMidPerShare <= 0) return null;
  const T = dteCalendarDays / 365;
  const r = riskFreeAnnual;
  const q = Math.max(0, dividendYieldAnnual);

  const price = (sigma: number) => {
    const c = bsPrice(spot, strike, T, r - q, sigma, true);
    const p = bsPrice(spot, strike, T, r - q, sigma, false);
    return c + p;
  };

  let lo = 0.02;
  let hi = 3.0;
  let pLo = price(lo) - straddleMidPerShare;
  let pHi = price(hi) - straddleMidPerShare;
  if (pLo > 0 || pHi < 0) return null;

  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const pm = price(mid) - straddleMidPerShare;
    if (Math.abs(pm) < straddleMidPerShare * 0.005 + 1e-4) {
      return Math.round(mid * 1e6) / 1e6;
    }
    if (pm > 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-5) {
      return Math.round(mid * 1e6) / 1e6;
    }
  }
  return null;
}
