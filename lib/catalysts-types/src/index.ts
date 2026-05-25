export const CATALYSTS_WINDOW_CALENDAR_DAYS = 10;

export type CatalystsFeedStatus = "ready" | "building" | "empty";

export type EarningsTiming = "BMO" | "AMC" | null;

export interface CatalystsFeed {
  builtAt: string;
  status: CatalystsFeedStatus;
  windowDays: number;
  funnel: {
    calendar: number;
    filtered: number;
    tradeable: number;
  };
  cards: CatalystCard[];
}

export interface CatalystSessionSnapshot {
  /** Settled session dates D-5..D-1 (oldest first). */
  sessionDates: string[];
  /** Official 4:00 PM ET closes for each sessionDates entry. */
  closes: number[];
  /** Per-session % move vs prior settled close (length 5, aligned with sessionDates). */
  sessionMovesPct: number[];
  cumulative1d: number;
  cumulative2d: number;
  cumulative3d: number;
  cumulative4d: number;
  cumulative5d: number;
  streak: number;
  upCount: number;
  downCount: number;
  patternRead: string;
}

export interface CatalystCard {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  earningsDate: string;
  earningsTiming: EarningsTiming;
  earningsConfirmed: boolean;
  /** ISO timestamp for client card-state / fall-off (BMO ≈ 09:30 ET, AMC ≈ 16:00 ET on earningsDate). */
  reportAtIso: string;
  lastPrice: number | null;
  /** ATM straddle % of spot for first expiry covering earnings; null when unavailable. */
  impliedMovePct: number | null;
  snapshot: CatalystSessionSnapshot;
}

export type CatalystsSortKey = "soonest" | "fiveDayMove" | "streak";

export type CatalystDriftClass = "trending_up" | "trending_down" | "choppy";

export type CatalystDirectionFilter = "all" | CatalystDriftClass;

/**
 * Classify pre-earnings drift from trailing session moves (5 settled + optional live = 6).
 * Thresholds match pattern-read templates in the cache job.
 */
export function classifyCatalystDrift(
  settledMovesPct: number[],
  liveMovePct: number | null,
): CatalystDriftClass {
  const moves =
    liveMovePct != null && Number.isFinite(liveMovePct)
      ? [...settledMovesPct, liveMovePct]
      : settledMovesPct;
  const ups = moves.filter((m) => m > 0).length;
  if (ups >= 5) return "trending_up";
  if (ups <= 1) return "trending_down";
  return "choppy";
}

export function emptyCatalystsFeed(): CatalystsFeed {
  return {
    builtAt: "",
    status: "empty",
    windowDays: CATALYSTS_WINDOW_CALENDAR_DAYS,
    funnel: { calendar: 0, filtered: 0, tradeable: 0 },
    cards: [],
  };
}
