/**
 * Probability of profit at expiration via risk-neutral lognormal (Black–Scholes style).
 * POP is expressed as 0–100 percent.
 */

import {
  payoffDollarsAtS,
  type ExpirationPayoffInput,
} from "./expirationPayoff.js";

/** Minimum T (year fraction) so 0DTE does not collapse variance (~1 hour of a 6.5h session). */
export const MIN_T_YEARS = 1 / (252 * 6.5);

/** Trading days per year for calendar fallback. */
export const TRADING_DAYS_PER_YEAR = 252;

export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax));
  return 0.5 * (1 + sign * erf);
}

function lognormalTailProbAbove(spot: number, strike: number, iv: number, tYears: number): number {
  const denom = iv * Math.sqrt(tYears);
  if (denom <= 0) return NaN;
  const d = (Math.log(strike / spot) + 0.5 * iv * iv * tYears) / denom;
  return 1 - normalCdf(d);
}

function lognormalTailProbBelow(spot: number, strike: number, iv: number, tYears: number): number {
  const denom = iv * Math.sqrt(tYears);
  if (denom <= 0) return NaN;
  const d = (Math.log(strike / spot) + 0.5 * iv * iv * tYears) / denom;
  return normalCdf(d);
}

export function lognormalProbBetween(
  spot: number,
  low: number,
  high: number,
  iv: number,
  tYears: number,
): number | null {
  if (
    !Number.isFinite(spot) ||
    spot <= 0 ||
    !Number.isFinite(iv) ||
    iv <= 0 ||
    !Number.isFinite(tYears) ||
    tYears <= 0 ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low >= high
  ) {
    return null;
  }
  const denom = iv * Math.sqrt(tYears);
  const drift = 0.5 * iv * iv * tYears;
  const d = (k: number) => (Math.log(k / spot) + drift) / denom;
  const p = normalCdf(d(high)) - normalCdf(d(low));
  if (!Number.isFinite(p)) return null;
  return Math.max(0, Math.min(1, p)) * 100;
}

function probabilityMassInInterval(
  lo: number,
  hi: number,
  spot: number,
  iv: number,
  tYears: number,
): number {
  const upperTail = spot * 2.5;
  if (hi >= upperTail) {
    const tail = lognormalTailProbAbove(spot, Math.max(lo, 1e-6), iv, tYears);
    return Number.isFinite(tail) ? tail * 100 : 0;
  }
  if (lo <= 0) {
    const p = lognormalTailProbBelow(spot, hi, iv, tYears);
    return Number.isFinite(p) ? p * 100 : 0;
  }
  return lognormalProbBetween(spot, lo, hi, iv, tYears) ?? 0;
}

function payoffUpperBound(payoff: ExpirationPayoffInput, spot: number): number {
  const strikes = payoff.legs.map((l) => l.strike).filter(Number.isFinite);
  return Math.max(spot * 2.5, ...(strikes.length ? strikes : [spot])) + 50;
}

export interface ComputeOptionPopPayoffInput {
  spot: number;
  iv: number;
  tYears: number;
  breakevens: number[];
  payoff: ExpirationPayoffInput;
}

/**
 * POP = P(payoff at expiration &gt; 0) under lognormal spot, by summing
 * probability mass over intervals between breakevens where payoff is positive.
 */
export function computeOptionPopFromPayoff(input: ComputeOptionPopPayoffInput): number | null {
  const { spot, iv, tYears, breakevens, payoff } = input;
  if (!Number.isFinite(spot) || spot <= 0 || iv <= 0 || tYears <= 0) return null;

  const hi = payoffUpperBound(payoff, spot);
  const bes = breakevens.filter(Number.isFinite).sort((a, b) => a - b);
  const bounds = [0, ...bes, hi];
  const unique: number[] = [];
  for (const b of bounds) {
    if (unique.length === 0 || b > unique[unique.length - 1] + 1e-9) unique.push(b);
  }

  let total = 0;
  for (let i = 0; i < unique.length - 1; i++) {
    const lo = unique[i];
    const hi_ = unique[i + 1];
    const mid = (lo + hi_) / 2;
    if (mid <= 0) continue;
    if (payoffDollarsAtS(payoff, mid) <= 0) continue;
    total += probabilityMassInInterval(lo, hi_, spot, iv, tYears);
  }

  if (!Number.isFinite(total)) return null;
  return Math.max(0, Math.min(100, total));
}

/** Parse YYYY-MM-DD (optional `:…` suffix) to US options-style close (16:00 America/New_York, rough UTC). */
export function expirationToMs(expiration: string): number | null {
  const datePart = expiration.split(":")[0].trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return Date.UTC(y, mo, d, 21, 0, 0, 0);
}

export function yearsToExpiration(expiration: string, asOfMs: number): number | null {
  const end = expirationToMs(expiration);
  if (end == null || !Number.isFinite(asOfMs)) return null;
  const ms = end - asOfMs;
  const yearMs = 365.25 * 24 * 60 * 60 * 1000;
  if (ms <= 0) return MIN_T_YEARS;
  return Math.max(MIN_T_YEARS, ms / yearMs);
}

export function averageLegIv(
  legs: Array<{ iv?: number | null }> | undefined,
  fallbackIv?: number | null,
): number | null {
  const vals: number[] = [];
  if (legs) {
    for (const l of legs) {
      if (l.iv != null && Number.isFinite(l.iv) && l.iv > 0) {
        vals.push(l.iv > 3 ? l.iv / 100 : l.iv);
      }
    }
  }
  if (vals.length > 0) return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (fallbackIv != null && Number.isFinite(fallbackIv) && fallbackIv > 0) {
    return fallbackIv > 3 ? fallbackIv / 100 : fallbackIv;
  }
  return null;
}

/** @deprecated Prefer computeOptionPopFromPayoff — kept for type compatibility. */
export interface ComputeOptionPopInput {
  spot: number;
  breakevens: number[];
  isCredit: boolean;
  iv: number;
  tYears: number;
  payoff?: ExpirationPayoffInput;
}

export function computeOptionPop(input: ComputeOptionPopInput): number | null {
  if (!input.payoff) return null;
  return computeOptionPopFromPayoff({
    spot: input.spot,
    iv: input.iv,
    tYears: input.tYears,
    breakevens: input.breakevens,
    payoff: input.payoff,
  });
}