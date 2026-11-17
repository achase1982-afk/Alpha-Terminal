/** Black–Scholes quotes for SPX 0DTE fixture ladder only (dev). */

const TWO_PI = 2 * Math.PI;

export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = (1 / Math.sqrt(TWO_PI)) * Math.exp(-(x * x) / 2);
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = d * poly;
  return x >= 0 ? 1 - p : p;
}

export function blackScholes(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean,
): number {
  if (T <= 1e-9) {
    return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (isCall) {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/** SPX strike tick: 0.05 under $3, else 0.10 */
export function roundSpxOptionPrice(price: number): number {
  const p = Math.max(price, 0.05);
  const tick = p < 3 ? 0.05 : 0.1;
  return Math.round(p / tick) * tick;
}

export function spxQuoteFromTheoretical(mid: number): { bid: number; ask: number; mark: number } {
  const m = Math.max(mid, 0.05);
  const half = m < 0.5 ? 0.05 : m < 3 ? 0.05 : m < 12 ? 0.1 : 0.15;
  const mark = roundSpxOptionPrice(m);
  let bid = roundSpxOptionPrice(m - half);
  let ask = roundSpxOptionPrice(m + half);
  const tick = mark < 3 ? 0.05 : 0.1;
  if (ask <= bid) ask = bid + tick;
  bid = Math.max(tick, bid);
  return { bid, ask, mark };
}

export const FIXTURE_BS = {
  spot: 7540,
  /** ~2h to cash close on a 0DTE */
  T: 2 / (252 * 6.5),
  r: 0.035,
  sigma: 0.15,
} as const;