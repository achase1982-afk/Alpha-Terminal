export type FlowAggressor = "buy" | "sell" | "mid";

export type FlowIncrement = {
  side: FlowAggressor;
  dollars: number;
  dVol: number;
  key: string;
  optionSide: "call" | "put";
  rxMs: number;
  lastPrice: number;
};

export type ContractFlowState = {
  prevBid: number | null;
  prevAsk: number | null;
  prevVolume: number | null;
  prevLast: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** At/above prior ask → buy; at/below prior bid → sell; else mid. */
export function classifyFlowAgainstPriorQuote(
  tradePrice: number,
  prevBid: number,
  prevAsk: number,
): FlowAggressor {
  if (tradePrice >= prevAsk) return "buy";
  if (tradePrice <= prevBid) return "sell";
  return "mid";
}

export type L1oRowInput = {
  key: string;
  optionSide: "call" | "put";
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number | null;
  rxMs: number;
};

/**
 * Apply one LEVELONE_OPTIONS partial row; returns increments (0..1 typical) and next state.
 */
export function applyL1oFlowTick(
  prev: ContractFlowState | undefined,
  row: L1oRowInput,
): { next: ContractFlowState; increments: FlowIncrement[] } {
  const prevBid = prev?.prevBid ?? null;
  const prevAsk = prev?.prevAsk ?? null;
  const prevVol = prev?.prevVolume ?? null;

  const bid = row.bid ?? prevBid;
  const ask = row.ask ?? prevAsk;
  const last = row.last ?? prev?.prevLast ?? null;
  const vol = row.volume;

  const next: ContractFlowState = {
    prevBid: bid,
    prevAsk: ask,
    prevVolume: vol ?? prevVol,
    prevLast: last,
  };

  const increments: FlowIncrement[] = [];

  if (vol == null) return { next, increments };
  if (prevVol == null) {
    next.prevVolume = vol;
    return { next, increments };
  }

  const dVol = vol - prevVol;
  if (dVol === 0) return { next, increments };
  if (dVol < 0) {
    next.prevVolume = vol;
    return { next, increments };
  }

  if (last == null || prevBid == null || prevAsk == null || prevAsk < prevBid) {
    next.prevVolume = vol;
    return { next, increments };
  }

  const side = classifyFlowAgainstPriorQuote(last, prevBid, prevAsk);
  const dollars = dVol * last * 100;
  increments.push({
    side,
    dollars,
    dVol,
    key: row.key,
    optionSide: row.optionSide,
    rxMs: row.rxMs,
    lastPrice: last,
  });
  next.prevVolume = vol;
  return { next, increments };
}

export function parseL1oSchwabRow(
  key: string,
  item: Record<string, unknown>,
  rxMs: number,
  optionSide: "call" | "put",
): L1oRowInput {
  return {
    key,
    optionSide,
    bid: num(item["2"]),
    ask: num(item["3"]),
    last: num(item["4"]),
    volume: num(item["8"]),
    rxMs,
  };
}