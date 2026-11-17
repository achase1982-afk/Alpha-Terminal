export type SpreadLegQuotes = {
  bid: number | null;
  ask: number | null;
};

export type SpreadNBBO = {
  /** Best natural price to SELL the vertical (receive credit when positive). */
  bid: number | null;
  /** Best natural price to BUY the vertical (pay debit when positive). */
  ask: number | null;
  /** Mid of bid/ask when both present */
  mid: number | null;
};

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

/**
 * NBBO for a defined-risk vertical with anchor (near) and wing (far) legs.
 * Both sides use the same sign convention as the order ticket:
 * - SELL spread: sum short leg bids − long leg asks (natural credit)
 * - BUY spread: sum long leg asks − short leg bids (natural debit)
 */
export function aggregateSpreadNBBO(near: SpreadLegQuotes, far: SpreadLegQuotes): SpreadNBBO {
  const { bid: nBid, ask: nAsk } = near;
  const { bid: fBid, ask: fAsk } = far;

  let sellNatural: number | null = null;
  let buyNatural: number | null = null;

  if (finite(nBid) && finite(fAsk)) {
    sellNatural = nBid - fAsk;
  }
  if (finite(nAsk) && finite(fBid)) {
    buyNatural = nAsk - fBid;
  }

  if (sellNatural != null && buyNatural != null && sellNatural > buyNatural) {
    const t = sellNatural;
    sellNatural = buyNatural;
    buyNatural = t;
  }

  let bid = sellNatural != null ? Math.abs(sellNatural) : null;
  let ask = buyNatural != null ? Math.abs(buyNatural) : null;
  if (bid != null && ask != null && bid > ask) {
    const t = bid;
    bid = ask;
    ask = t;
  }
  const mid = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask;
  return { bid, ask, mid };
}

export function verticalStrikes(anchor: number, width: number, type: "CALL" | "PUT"): { near: number; far: number } {
  if (type === "CALL") {
    return { near: anchor, far: anchor + width };
  }
  return { near: anchor, far: anchor - width };
}