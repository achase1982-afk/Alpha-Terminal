import { SWEEP_CONDITION_CODES, BLOCK_MIN_SIZE } from "./optionsConditionCodes.js";
import { classifyAggressorFromNbbo, type AggressorSideTag } from "./flowAggressorSide.js";

const DEFAULT_LARGE_NOTIONAL_USD = 100_000;
const VOLUME_SPIKE_MULTIPLIER = 5;

export interface NbboSnapshotLike {
  bid: number;
  ask: number;
}

export type AggressorConfidence = "high" | "medium" | "low" | "unknown";

export interface ClassifiedPersistenceRow {
  isSweep: boolean;
  isBlockForDb: boolean;
  isLarge: boolean;
  shouldPersist: boolean;
  side: AggressorSideTag | null;
  notional: number;
  aggressorConfidence: AggressorConfidence;
  /** Contracts vs 20d avg daily volume when baseline exists. */
  volumeVsBaseline20d: number | null;
  /** size * 100 / openInterest when OI > 0. */
  volOiRatio: number | null;
  volumeSignificant: boolean;
}

function spreadPct(bid: number, ask: number): number {
  const mid = (bid + ask) / 2;
  if (mid <= 0) return Number.POSITIVE_INFINITY;
  return ((ask - bid) / mid) * 100;
}

/**
 * Live WebSocket watcher: keep only sweeps, blocks, large notional, or
 * volume-vs-baseline spikes so the unusual-flow pipeline is not flooded.
 */
export function shouldPersistLiveWatcherRow(cl: ClassifiedPersistenceRow): boolean {
  return cl.shouldPersist;
}

/**
 * REST tape backfill for Strategist: persist every parsed trade so session
 * rollups and aggressor totals reflect the full tape. Noise filtering is not
 * appropriate here (small prints still carry aggressor side when NBBO exists).
 */
export function shouldPersistBackfillRow(_cl: ClassifiedPersistenceRow): boolean {
  return true;
}

/**
 * Single source for live watcher and REST tape backfill so sweep, block,
 * large, aggressor, and notionals stay aligned with enqueueClassifiedTrade.
 * Call sites choose persistence with {@link shouldPersistLiveWatcherRow} or
 * {@link shouldPersistBackfillRow}.
 */
export function classifyForFlowPersistence(args: {
  price: number;
  size: number;
  conditions: number[];
  nbbo: NbboSnapshotLike | null | undefined;
  /** Tier-adjusted large-notional threshold (USD premium). */
  largeNotionalThresholdUsd?: number;
  /** Mean daily contract volume for this OCC (polygon_options_history). */
  avgDailyContractVolume20d?: number | null;
  /** Open interest snapshot for vol/OI ratio. */
  openInterest?: number | null;
}): ClassifiedPersistenceRow {
  const notional = args.price * args.size * 100;
  const threshold = args.largeNotionalThresholdUsd ?? DEFAULT_LARGE_NOTIONAL_USD;
  const isSweep = args.conditions.some((c) => SWEEP_CONDITION_CODES.has(c));
  const isBlock = args.size >= BLOCK_MIN_SIZE;
  const isLarge = notional >= threshold;
  const oi = args.openInterest;
  const avgVol = args.avgDailyContractVolume20d;
  let volumeVsBaseline20d: number | null = null;
  let volOiRatio: number | null = null;
  if (typeof oi === "number" && oi > 0) {
    volOiRatio = Math.round((args.size / oi) * 10_000) / 10_000;
  }
  if (typeof avgVol === "number" && avgVol > 0) {
    volumeVsBaseline20d = Math.round((args.size / avgVol) * 1000) / 1000;
  }
  const volumeSignificant =
    volumeVsBaseline20d != null && volumeVsBaseline20d >= VOLUME_SPIKE_MULTIPLIER;
  const shouldPersist = isSweep || isBlock || isLarge || volumeSignificant;

  const nb = args.nbbo;
  let side: AggressorSideTag | null = null;
  let aggressorConfidence: AggressorConfidence = "unknown";

  if (nb && nb.bid > 0 && nb.ask > 0 && nb.ask >= nb.bid) {
    const sp = spreadPct(nb.bid, nb.ask);
    const r = classifyAggressorFromNbbo(args.price, nb.bid, nb.ask);
    side = r.side;
    if (r.side == null) {
      aggressorConfidence = r.reason === "invalid_nbbo" ? "unknown" : "low";
    } else if (sp > 25) {
      aggressorConfidence = "low";
    } else if (sp > 10) {
      aggressorConfidence = "medium";
    } else {
      aggressorConfidence = "high";
    }
  }

  return {
    isSweep,
    isBlockForDb: isBlock && !isSweep,
    isLarge,
    shouldPersist,
    side,
    notional,
    aggressorConfidence,
    volumeVsBaseline20d,
    volOiRatio,
    volumeSignificant,
  };
}
