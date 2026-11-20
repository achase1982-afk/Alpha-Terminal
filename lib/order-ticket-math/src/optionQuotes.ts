import { formatQuoteAsOfEt } from "./chainQuoteSession.js";

export type QuoteSideState = "ok" | "crossed" | "incomplete";

export interface TwoSidedQuote {
  bid: number | null | undefined;
  ask: number | null | undefined;
}

/** Valid two-sided book with bid === ask > 0 (Schwab locked / non-crossed). */
export function isLockedTwoSidedQuote(bid: number | null | undefined, ask: number | null | undefined): boolean {
  return quoteSideState(bid, ask) === "ok" && bid != null && ask != null && bid === ask;
}

export function quoteSideState(bid: number | null | undefined, ask: number | null | undefined): QuoteSideState {
  if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) return "incomplete";
  if (bid < 0 || ask <= 0) return "incomplete";
  if (bid > ask) return "crossed";
  return "ok";
}

/** Default threshold for marking an in-session chain / AT quote stale. */
export const CHAIN_QUOTE_FRESH_MS = 12_000;

export type ChainQuoteUiState = QuoteSideState | "stale" | "prior_session" | "ok";

/** Short UI status label for incomplete, crossed, or stale chain / AT quotes. */
export function chainQuoteReasonLabel(state: ChainQuoteUiState): string {
  switch (state) {
    case "crossed":
      return "Crossed";
    case "incomplete":
      return "No quote";
    case "stale":
      return "Stale";
    default:
      return "";
  }
}

export function chainDisplayQuoteState(
  bid: number | null | undefined,
  ask: number | null | undefined,
  rxMs: number | null | undefined,
  nowMs = Date.now(),
  staleAfterMs = CHAIN_QUOTE_FRESH_MS,
): QuoteSideState | "stale" {
  if (rxMs == null || !Number.isFinite(rxMs) || rxMs <= 0) return "stale";
  if (nowMs - rxMs > staleAfterMs) return "stale";
  if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) return "incomplete";
  if (bid <= 0 || ask <= 0) return "incomplete";
  if (bid > ask) return "crossed";
  return "ok";
}

/** Chain / AT cell: one rule for every strike — use Schwab quoteTime, not poll/socket time. */
export function resolveChainQuotePresentation(input: {
  bid: number | null | undefined;
  ask: number | null | undefined;
  quoteTimeMs: number | null | undefined;
  nowMs?: number;
  liveFreshMs?: number;
}): {
  displayState: ChainQuoteUiState;
  /** True when either displayed side can stage a leg. */
  tapable: boolean;
  bidTapable: boolean;
  askTapable: boolean;
  showBid: number | undefined;
  showAsk: number | undefined;
  asOfLabel: string | null;
  dimmed: boolean;
  locked: boolean;
} {
  const nowMs = input.nowMs ?? Date.now();
  const liveFreshMs = input.liveFreshMs ?? CHAIN_QUOTE_FRESH_MS;
  const side = quoteSideState(input.bid, input.ask);
  const showBid =
    input.bid != null && Number.isFinite(input.bid) && input.bid >= 0
      ? input.bid
      : undefined;
  const showAsk =
    input.ask != null && Number.isFinite(input.ask) && input.ask > 0
      ? input.ask
      : undefined;
  const bidTapable = showBid != null;
  const askTapable = showAsk != null;
  if (side !== "ok") {
    return {
      displayState: side,
      tapable: bidTapable || askTapable,
      bidTapable,
      askTapable,
      showBid,
      showAsk,
      asOfLabel: null,
      dimmed: false,
      locked: false,
    };
  }
  const bid = input.bid!;
  const ask = input.ask!;
  const locked = isLockedTwoSidedQuote(bid, ask);
  const qt = input.quoteTimeMs;
  const staleLive = qt != null && Number.isFinite(qt) && qt > 0 && nowMs - qt > liveFreshMs;

  if (staleLive) {
    return {
      displayState: "stale",
      tapable: true,
      bidTapable: true,
      askTapable: true,
      showBid: bid,
      showAsk: ask,
      asOfLabel: qt != null && qt > 0 ? formatQuoteAsOfEt(qt) : null,
      dimmed: true,
      locked,
    };
  }
  return {
    displayState: "ok",
    tapable: true,
    bidTapable: true,
    askTapable: true,
    showBid: bid,
    showAsk: ask,
    asOfLabel: null,
    dimmed: false,
    locked,
  };
}

/** Midpoint when ask > 0, bid ≥ 0, and bid ≤ ask; never normalizes crossed books. */
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
  streamQuoteTime?: number;
  contractBid?: number;
  contractAsk?: number;
  /** Schwab quoteTimeInLong for REST leg (ms). */
  contractQuoteTime?: number;
  /** Chain poll fetch time — fallback only when quote time missing. */
  contractTs?: number;
}

function pairComplete(bid?: number, ask?: number): bid is number {
  return (
    bid != null &&
    ask != null &&
    Number.isFinite(bid) &&
    Number.isFinite(ask) &&
    bid >= 0 &&
    ask > 0 &&
    bid <= ask
  );
}

function quoteSideBid(v?: number | null): number | null {
  return v != null && Number.isFinite(v) && v >= 0 ? v : null;
}

function quoteSideAsk(v?: number | null): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

function pickSidePrice(
  field: "streamBid" | "streamAsk" | "contractBid" | "contractAsk",
  source: PairedQuoteSource,
  prefer: "stream" | "contract",
): number | null {
  const streamKey = field.startsWith("stream") ? (field === "streamBid" ? "streamBid" : "streamAsk") : null;
  const pickBid = field.includes("Bid");
  const streamVal = pickBid
    ? quoteSideBid(streamKey ? source[streamKey] : undefined)
    : quoteSideAsk(streamKey ? source[streamKey] : undefined);
  const contractKey = field.startsWith("contract")
    ? field === "contractBid"
      ? "contractBid"
      : "contractAsk"
    : field === "streamBid"
      ? "contractBid"
      : "contractAsk";
  const contractVal = pickBid ? quoteSideBid(source[contractKey]) : quoteSideAsk(source[contractKey]);
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

  const streamQuoteMs = source.streamQuoteTime ?? source.streamTs ?? 0;
  const contractQuoteMs = source.contractQuoteTime ?? source.contractTs ?? 0;

  if (streamOk && contractOk) {
    if (streamQuoteMs > 0 && (contractQuoteMs <= 0 || streamQuoteMs >= contractQuoteMs)) {
      return pick(source.streamBid!, source.streamAsk!, "stream");
    }
    return pick(source.contractBid!, source.contractAsk!, "contract");
  }
  if (streamOk) return pick(source.streamBid!, source.streamAsk!, "stream");
  if (contractOk) return pick(source.contractBid!, source.contractAsk!, "contract");

  if (
    source.streamBid != null &&
    source.streamAsk != null &&
    quoteSideState(source.streamBid, source.streamAsk) === "crossed"
  ) {
    if (contractOk) {
      return pick(source.contractBid!, source.contractAsk!, "contract");
    }
    return { bid: source.streamBid, ask: source.streamAsk, source: "stream", crossed: true };
  }
  if (
    source.contractBid != null &&
    source.contractAsk != null &&
    quoteSideState(source.contractBid, source.contractAsk) === "crossed"
  ) {
    return { bid: source.contractBid, ask: source.contractAsk, source: "contract", crossed: true };
  }

  return null;
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