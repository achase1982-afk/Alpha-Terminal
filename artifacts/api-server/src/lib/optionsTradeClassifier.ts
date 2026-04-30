import { SWEEP_CONDITION_CODES, BLOCK_MIN_SIZE } from "./optionsConditionCodes.js";
import { classifyAggressorFromNbbo, type AggressorSideTag } from "./flowAggressorSide.js";

const LARGE_NOTIONAL_USD = 100_000;

export interface NbboSnapshotLike {
  bid: number;
  ask: number;
}

export interface ClassifiedPersistenceRow {
  isSweep: boolean;
  isBlockForDb: boolean;
  isLarge: boolean;
  shouldPersist: boolean;
  side: AggressorSideTag | null;
  notional: number;
}

/**
 * Single source for live watcher and REST tape backfill so sweep, block,
 * large, and aggressor rules stay aligned with enqueueClassifiedTrade.
 */
export function classifyForFlowPersistence(args: {
  price: number;
  size: number;
  conditions: number[];
  nbbo: NbboSnapshotLike | null | undefined;
}): ClassifiedPersistenceRow {
  const notional = args.price * args.size * 100;
  const isSweep = args.conditions.some((c) => SWEEP_CONDITION_CODES.has(c));
  const isBlock = args.size >= BLOCK_MIN_SIZE;
  const isLarge = notional >= LARGE_NOTIONAL_USD;
  const shouldPersist = isSweep || isBlock || isLarge;

  let side: AggressorSideTag | null = null;
  const nb = args.nbbo;
  if (nb && nb.bid > 0 && nb.ask > 0 && nb.ask >= nb.bid) {
    const r = classifyAggressorFromNbbo(args.price, nb.bid, nb.ask);
    side = r.side;
  }

  return {
    isSweep,
    isBlockForDb: isBlock && !isSweep,
    isLarge,
    shouldPersist,
    side,
    notional,
  };
}
