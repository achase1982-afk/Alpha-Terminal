export type QuoteSideState = "ok" | "crossed" | "incomplete";

export interface TwoSidedQuote {
  bid: number | null | undefined;
  ask: number | null | undefined;
}

export function quoteSideState(bid: number | null | undefined, ask: number | null | undefined): QuoteSideState {
  if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) return "incomplete";
  if (bid <= 0 || ask <= 0) return "incomplete";
  if (bid > ask) return "crossed";
  return "ok";
}

/** Midpoint only when bid ≤ ask and both sides are positive; never normalizes crossed books. */
export function midpointFromBidAsk(bid: number | null | undefined, ask: number | null | undefined): number | null {
  if (quoteSideState(bid, ask) !== "ok") return null;
  return (bid! + ask!) / 2;
}

export interface SpreadNBBO {
  bid: number;
  ask: number;
  mid: number | null;
  crossed: boolean;
}

/**
 * Net spread bid/ask from leg quotes (SELL legs add bid/ask; BUY legs subtract opposite side).
 * Normalizes net-debit (negative raw) and net-credit (positive raw) into a non-crossed pair when valid.
 */
export function aggregateSpreadNBBO(
  legs: Array<{ instruction: string; bid?: number | null; ask?: number | null }>,
): SpreadNBBO | null {
  if (legs.length === 0) return null;
  let rawBid = 0;
  let rawAsk = 0;
  for (const leg of legs) {
    const isSell = leg.instruction.startsWith("SELL");
    const bid = leg.bid ?? 0;
    const ask = leg.ask ?? 0;
    if (isSell) {
      rawBid += bid;
      rawAsk += ask;
    } else {
      rawBid -= ask;
      rawAsk -= bid;
    }
  }

  let spreadBid: number;
  let spreadAsk: number;
  if (rawBid < 0 && rawAsk < 0) {
    spreadBid = -rawAsk;
    spreadAsk = -rawBid;
  } else if (rawBid > 0 && rawAsk > 0) {
    spreadBid = rawBid;
    spreadAsk = rawAsk;
  } else {
    spreadBid = Math.abs(rawBid);
    spreadAsk = Math.abs(rawAsk);
  }

  const crossed = spreadBid > spreadAsk;
  const mid = crossed ? null : (spreadBid + spreadAsk) / 2;
  return { bid: spreadBid, ask: spreadAsk, mid, crossed };
}