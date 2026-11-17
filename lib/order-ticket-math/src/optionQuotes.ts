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

export interface PairedBidAsk {
  bid: number;
  ask: number;
  source: "stream" | "contract";
  crossed: boolean;
}

export interface PairedQuoteSource {
  streamBid?: number;
  streamAsk?: number;
  streamTs?: number;
  contractBid?: number;
  contractAsk?: number;
  /** When REST chain quote was fetched (ms); stream wins only if fresher. */
  contractTs?: number;
}

function pairComplete(bid?: number, ask?: number): bid is number {
  return (
    bid != null &&
    ask != null &&
    Number.isFinite(bid) &&
    Number.isFinite(ask) &&
    bid > 0 &&
    ask > 0
  );
}

/**
 * Bid and ask from the same source — never mix streamed and stored legs field-by-field.
 * Prefers the stream when it has a complete pair (assumed fresher when `streamTs` is set).
 */
export function resolvePairedBidAsk(source: PairedQuoteSource): PairedBidAsk | null {
  const streamOk = pairComplete(source.streamBid, source.streamAsk);
  const contractOk = pairComplete(source.contractBid, source.contractAsk);

  const pick = (bid: number, ask: number, from: "stream" | "contract"): PairedBidAsk => ({
    bid,
    ask,
    source: from,
    crossed: bid > ask,
  });

  if (streamOk && contractOk) {
    const streamTs = source.streamTs ?? 0;
    const contractTs = source.contractTs ?? 0;
    if (streamTs > 0 && (contractTs <= 0 || streamTs >= contractTs)) {
      return pick(source.streamBid!, source.streamAsk!, "stream");
    }
    return pick(source.contractBid!, source.contractAsk!, "contract");
  }
  if (streamOk) return pick(source.streamBid!, source.streamAsk!, "stream");
  if (contractOk) return pick(source.contractBid!, source.contractAsk!, "contract");
  return null;
}

export interface SpreadNBBO {
  bid: number;
  ask: number;
  mid: number | null;
  crossed: boolean;
}

/**
 * Net spread bid/ask from leg quotes in the order's natural direction with positive magnitudes
 * for typical debit/credit structures; even-money nets may remain signed.
 * `crossed` is true only when an individual leg book is crossed — never when spread mid ≤ 0.
 */
export function aggregateSpreadNBBO(
  legs: Array<{ instruction: string; bid?: number | null; ask?: number | null }>,
): SpreadNBBO | null {
  if (legs.length === 0) return null;
  let rawBid = 0;
  let rawAsk = 0;
  let buyBidSum = 0;
  let buyAskSum = 0;
  let sellBidSum = 0;
  let sellAskSum = 0;
  let haveAllLegs = true;
  let anyLegCrossed = false;
  for (const leg of legs) {
    const st = quoteSideState(leg.bid, leg.ask);
    if (st === "incomplete") {
      haveAllLegs = false;
      break;
    }
    if (st === "crossed") anyLegCrossed = true;
    const isSell = leg.instruction.startsWith("SELL");
    const bid = leg.bid!;
    const ask = leg.ask!;
    if (isSell) {
      sellBidSum += bid;
      sellAskSum += ask;
      rawBid += bid;
      rawAsk += ask;
    } else {
      buyBidSum += bid;
      buyAskSum += ask;
      rawBid -= ask;
      rawAsk -= bid;
    }
  }

  if (!haveAllLegs) {
    return null;
  }

  const debitBid = buyBidSum - sellAskSum;
  const debitAsk = buyAskSum - sellBidSum;
  const creditBid = sellBidSum - buyAskSum;
  const creditAsk = sellAskSum - buyBidSum;

  const debitOk = debitBid > 0 && debitAsk > 0 && debitBid <= debitAsk;
  const creditOk = creditBid > 0 && creditAsk > 0 && creditBid <= creditAsk;

  let spreadBid: number;
  let spreadAsk: number;
  if (debitOk) {
    spreadBid = debitBid;
    spreadAsk = debitAsk;
  } else if (creditOk) {
    spreadBid = creditBid;
    spreadAsk = creditAsk;
  } else {
    spreadBid = rawBid;
    spreadAsk = rawAsk;
  }

  const crossed = anyLegCrossed;
  const mid =
    !crossed && Number.isFinite(spreadBid) && Number.isFinite(spreadAsk) && spreadBid <= spreadAsk
      ? (spreadBid + spreadAsk) / 2
      : null;
  return { bid: spreadBid, ask: spreadAsk, mid, crossed };
}
