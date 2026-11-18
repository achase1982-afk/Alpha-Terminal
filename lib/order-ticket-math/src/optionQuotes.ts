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

function positiveQuoteSide(v?: number | null): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

function pickSidePrice(
  field: "streamBid" | "streamAsk" | "contractBid" | "contractAsk",
  source: PairedQuoteSource,
  prefer: "stream" | "contract",
): number | null {
  const streamKey = field.startsWith("stream") ? (field === "streamBid" ? "streamBid" : "streamAsk") : null;
  const streamVal = positiveQuoteSide(streamKey ? source[streamKey] : undefined);
  const contractKey = field.startsWith("contract")
    ? field === "contractBid"
      ? "contractBid"
      : "contractAsk"
    : field === "streamBid"
      ? "contractBid"
      : "contractAsk";
  const contractVal = positiveQuoteSide(source[contractKey]);
  if (streamVal != null && contractVal != null) {
    const streamTs = source.streamTs ?? 0;
    const contractTs = source.contractTs ?? 0;
    if (streamTs > 0 && (contractTs <= 0 || streamTs >= contractTs)) return streamVal;
    if (contractTs > 0 && streamTs <= contractTs) return contractVal;
    return prefer === "stream" ? streamVal : contractVal;
  }
  return streamVal ?? contractVal;
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

  const bid = pickSidePrice("streamBid", source, "stream");
  const ask = pickSidePrice("streamAsk", source, "stream");
  if (bid == null && ask == null) return null;
  const resolvedBid = bid ?? 0;
  const resolvedAsk = ask ?? 0;
  const fromStream = bid != null && positiveQuoteSide(source.streamBid) === bid;
  return {
    bid: resolvedBid,
    ask: resolvedAsk,
    source: fromStream ? "stream" : "contract",
    crossed: bid != null && ask != null && resolvedBid > resolvedAsk,
  };
}

export interface SpreadNBBO {
  bid: number;
  ask: number;
  mid: number | null;
  crossed: boolean;
}

function gcdAll(nums: number[]): number {
  if (nums.length === 0) return 1;
  let g = Math.abs(Math.floor(nums[0]) || 1);
  for (let i = 1; i < nums.length; i++) {
    let y = Math.abs(Math.floor(nums[i]) || 1);
    while (y) {
      const t = y;
      y = g % y;
      g = t;
    }
  }
  return g || 1;
}

/**
 * Net spread bid/ask from leg quotes in the order's natural direction with positive magnitudes
 * for typical debit/credit structures; even-money nets may remain signed.
 * Each leg is weighted by `quantity / gcd(leg quantities)` (default quantity 1).
 * `crossed` is true only when an individual leg book is crossed — never when spread mid ≤ 0.
 */
export function aggregateSpreadNBBO(
  legs: Array<{ instruction: string; bid?: number | null; ask?: number | null; quantity?: number }>,
): SpreadNBBO | null {
  if (legs.length === 0) return null;
  const qtys = legs.map((l) => l.quantity ?? 1);
  const unit = gcdAll(qtys);
  let rawBid = 0;
  let rawAsk = 0;
  let buyBidSum = 0;
  let buyAskSum = 0;
  let sellBidSum = 0;
  let sellAskSum = 0;
  let haveAllLegs = true;
  let anyLegCrossed = false;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const st = quoteSideState(leg.bid, leg.ask);
    if (st === "incomplete") {
      haveAllLegs = false;
      break;
    }
    if (st === "crossed") anyLegCrossed = true;
    const w = (qtys[i] ?? 1) / unit;
    const isSell = leg.instruction.startsWith("SELL");
    const bid = leg.bid! * w;
    const ask = leg.ask! * w;
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