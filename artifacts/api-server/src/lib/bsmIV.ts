const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function normCdf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function bsPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean,
): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const intrinsic = isCall ? Math.max(0, S - K) : Math.max(0, K - S);
    return intrinsic;
  }
  const sigmaSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;
  if (isCall) {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

export interface BsmIVInput {
  spot: number;
  strike: number;
  dte: number;
  isCall: boolean;
  optionPrice: number;
  riskFreeRate?: number;
}

const RISK_FREE_DEFAULT = 0.045;
const SIGMA_LOW = 0.01;
const SIGMA_HIGH = 5.0;
const TOL = 1e-4;
const MAX_ITER = 60;

export function impliedVolatilityBSM(input: BsmIVInput): number | null {
  const { spot, strike, dte, isCall, optionPrice } = input;
  const r = input.riskFreeRate ?? RISK_FREE_DEFAULT;
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || !Number.isFinite(optionPrice)) return null;
  if (spot <= 0 || strike <= 0 || optionPrice <= 0) return null;
  if (dte < 1) return null;
  const T = dte / 365;
  const intrinsic = isCall ? Math.max(0, spot - strike * Math.exp(-r * T)) : Math.max(0, strike * Math.exp(-r * T) - spot);
  if (optionPrice < intrinsic - 1e-6) return null;
  const upperBound = isCall ? spot : strike * Math.exp(-r * T);
  if (optionPrice >= upperBound) return null;

  let lo = SIGMA_LOW;
  let hi = SIGMA_HIGH;
  let pLo = bsPrice(spot, strike, T, r, lo, isCall) - optionPrice;
  let pHi = bsPrice(spot, strike, T, r, hi, isCall) - optionPrice;
  if (pLo > 0 || pHi < 0) return null;

  for (let i = 0; i < MAX_ITER; i++) {
    const mid = 0.5 * (lo + hi);
    const pMid = bsPrice(spot, strike, T, r, mid, isCall) - optionPrice;
    if (Math.abs(pMid) < TOL || (hi - lo) * 0.5 < TOL) {
      return Math.round(mid * 1e6) / 1e6;
    }
    if (pMid < 0) {
      lo = mid;
      pLo = pMid;
    } else {
      hi = mid;
      pHi = pMid;
    }
  }
  return Math.round(0.5 * (lo + hi) * 1e6) / 1e6;
}
