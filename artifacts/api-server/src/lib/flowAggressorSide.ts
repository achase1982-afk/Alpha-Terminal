/**
 * NBBO-based aggressor tag for options prints (tape read).
 * Epsilon: max($0.01, 0.5% of NBBO midpoint) to avoid float edge cases.
 */
export type AggressorSideTag = "ask" | "bid" | "mid";

export function classifyAggressorFromNbbo(
  tradePrice: number,
  bid: number,
  ask: number,
): { side: AggressorSideTag | null; reason: "nbbo_unavailable" | "invalid_nbbo" | null } {
  if (!Number.isFinite(tradePrice) || !Number.isFinite(bid) || !Number.isFinite(ask)) {
    return { side: null, reason: "nbbo_unavailable" };
  }
  if (bid <= 0 || ask <= 0 || ask < bid) {
    return { side: null, reason: "invalid_nbbo" };
  }
  const mid = (bid + ask) / 2;
  const eps = Math.max(0.01, mid * 0.005);
  if (tradePrice >= ask - eps) return { side: "ask", reason: null };
  if (tradePrice <= bid + eps) return { side: "bid", reason: null };
  return { side: "mid", reason: null };
}

/**
 * Lee-Ready without spread epsilon: for exchange-fresh NBBO (e.g. sub-2s quote at ingest).
 * price >= ask → ask; price <= bid → bid; else mid.
 */
export function classifyAggressorFromNbboStrict(tradePrice: number, bid: number, ask: number): AggressorSideTag | null {
  if (!Number.isFinite(tradePrice) || !Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (bid <= 0 || ask <= 0 || ask < bid) return null;
  if (tradePrice >= ask) return "ask";
  if (tradePrice <= bid) return "bid";
  return "mid";
}
