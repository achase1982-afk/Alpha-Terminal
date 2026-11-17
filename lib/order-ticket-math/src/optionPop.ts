/**
 * Probability of profit at expiration via risk-neutral lognormal (Black–Scholes style).
 * POP is expressed as 0–100 percent.
 */

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
  const sigma = iv;
  const denom = sigma * Math.sqrt(tYears);
  if (denom <= 0) return NaN;
  const d = (Math.log(strike / spot) + 0.5 * sigma * sigma * tYears) / denom;
  return 1 - normalCdf(d);
}

function lognormalTailProbBelow(spot: number, strike: number, iv: number, tYears: number): number {
  const sigma = iv;
  const denom = sigma * Math.sqrt(tYears);
  if (denom <= 0) return NaN;
  const d = (Math.log(strike / spot) + 0.5 * sigma * sigma * tYears) / denom;
  return normalCdf(d);
}

export function lognormalProbBetween(
  spot: number,
  lowExclusive: number,
  highExclusive: number,
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
    !Number.isFinite(lowExclusive) ||
    !Number.isFinite(highExclusive) ||
    lowExclusive >= highExclusive
  ) {
    return null;
  }
  const sigma = iv;
  const denom = sigma * Math.sqrt(tYears);
  const d = (k: number) => (Math.log(k / spot) + 0.5 * sigma * sigma * tYears) / denom;
  const p = normalCdf(d(highExclusive)) - normalCdf(d(lowExclusive));
  if (!Number.isFinite(p)) return null;
  return Math.max(0, Math.min(1, p)) * 100;
}

/** Parse YYYY-MM-DD (optional `:…` suffix) to US options-style close (16:00 America/New_York, rough UTC). */
export function expirationToMs(expiration: string): number | null {
  const datePart = expiration.split(":")[0].trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  // 16:00 ET ≈ 21:00 UTC (EST); close enough for POP horizon.
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

export interface PopLegHint {
  optionType: string;
  instruction: string;
}

export interface ComputeOptionPopInput {
  spot: number;
  breakevens: number[];
  isCredit: boolean;
  iv: number;
  tYears: number;
  legs?: PopLegHint[];
}

/**
 * POP at expiration: probability payoff ≥ 0 (same sign convention as ticket breakevens).
 */
export function computeOptionPop(input: ComputeOptionPopInput): number | null {
  const { spot, breakevens, isCredit, iv, tYears, legs } = input;
  const bes = breakevens.filter((b) => Number.isFinite(b)).sort((a, b) => a - b);
  if (bes.length === 0 || !Number.isFinite(spot) || spot <= 0 || iv <= 0 || tYears <= 0) {
    return null;
  }

  if (bes.length >= 2 && isCredit) {
    const between = lognormalProbBetween(spot, bes[0], bes[1], iv, tYears);
    return between;
  }

  if (bes.length === 1) {
    const be = bes[0];
    const onlyCalls =
      legs &&
      legs.length > 0 &&
      legs.every((l) => l.optionType === "CALL" || l.optionType === "call");
    const onlyPuts =
      legs &&
      legs.length > 0 &&
      legs.every((l) => l.optionType === "PUT" || l.optionType === "put");
    const netLong =
      legs && legs.length > 0
        ? legs.reduce((s, l) => s + (l.instruction.startsWith("BUY") ? 1 : -1), 0) > 0
        : !isCredit;

    if (onlyCalls) {
      const p = netLong ? lognormalTailProbAbove(spot, be, iv, tYears) : lognormalTailProbBelow(spot, be, iv, tYears);
      return Number.isFinite(p) ? p * 100 : null;
    }
    if (onlyPuts) {
      const p = netLong ? lognormalTailProbBelow(spot, be, iv, tYears) : lognormalTailProbAbove(spot, be, iv, tYears);
      return Number.isFinite(p) ? p * 100 : null;
    }
  }

  if (bes.length >= 2) {
    const between = lognormalProbBetween(spot, bes[0], bes[bes.length - 1], iv, tYears);
    if (between != null && !isCredit) {
      const outside = 100 - between;
      return Math.max(0, Math.min(100, outside));
    }
    return between;
  }

  return null;
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