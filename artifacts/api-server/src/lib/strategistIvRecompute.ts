const SIGMA_LOW = 1e-6;
const SIGMA_HIGH = 5.0;
const MAX_ITER = 50;
const TOL_PRICE = 1e-5;

function bsPriceWithYield(
  spot: number,
  strike: number,
  T: number,
  riskFreeRate: number,
  dividendYield: number,
  sigma: number,
  isCall: boolean,
): number {
  const r = riskFreeRate;
  const q = Math.max(0, dividendYield);
  const sqrt = Math.sqrt(T);
  const sigmaSqrtT = sigma * sqrt;
  const d1 =
    (Math.log(spot / strike) + (r - q + 0.5 * sigma * sigma) * T) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;
  const eQT = Math.exp(-q * T);
  const eRT = Math.exp(-r * T);
  if (isCall) {
    return spot * eQT * normCdf(d1) - strike * eRT * normCdf(d2);
  }
  return strike * eRT * normCdf(-d2) - spot * eQT * normCdf(-d1);
}

function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax));
  return 0.5 * (1 + sign * y);
}

/**
 * Bisection IV from mid price (decimal σ). Logging-only; does not gate filtering.
 * Uses Black-Scholes-Merton with continuous dividend yield.
 */
export function recomputeImpliedVolFromMid(args: {
  optionType: "call" | "put";
  spot: number;
  strike: number;
  daysToExpiry: number;
  mid: number;
  riskFreeRate?: number;
  dividendYield?: number;
}): number | null {
  const {
    optionType,
    spot,
    strike,
    daysToExpiry,
    mid,
    riskFreeRate = 0.05,
    dividendYield = 0,
  } = args;
  const isCall = optionType === "call" || (optionType as string).toUpperCase() === "CALL";
  if (!Number.isFinite(spot) || spot <= 0) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (!Number.isFinite(mid) || mid <= 0) return null;
  if (!Number.isFinite(daysToExpiry) || daysToExpiry < 1) return null;
  const T = daysToExpiry / 365;
  const r = riskFreeRate;
  const q = Math.max(0, dividendYield);

  const intrinsic = isCall
    ? Math.max(0, spot * Math.exp(-q * T) - strike * Math.exp(-r * T))
    : Math.max(0, strike * Math.exp(-r * T) - spot * Math.exp(-q * T));
  const upperBound = isCall ? spot * Math.exp(-q * T) : strike * Math.exp(-r * T);
  if (mid < intrinsic - 1e-6) return null;
  if (mid >= upperBound - 1e-9) return null;

  let lo = SIGMA_LOW;
  let hi = SIGMA_HIGH;
  let pLo = bsPriceWithYield(spot, strike, T, r, q, lo, isCall) - mid;
  let pHi = bsPriceWithYield(spot, strike, T, r, q, hi, isCall) - mid;
  if (pLo > 0 || pHi < 0) return null;

  for (let i = 0; i < MAX_ITER; i++) {
    const sigma = 0.5 * (lo + hi);
    const pMid = bsPriceWithYield(spot, strike, T, r, q, sigma, isCall) - mid;
    if (Math.abs(pMid) < TOL_PRICE || (hi - lo) * 0.5 < 1e-8) {
      return Math.round(sigma * 1e8) / 1e8;
    }
    if (pMid < 0) {
      lo = sigma;
      pLo = pMid;
    } else {
      hi = sigma;
      pHi = pMid;
    }
  }
  return null;
}
