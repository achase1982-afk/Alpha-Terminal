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

export function emptyCatalystsFeed(): CatalystsFeed {
  return {
    builtAt: "",
    status: "empty",
    windowDays: CATALYSTS_WINDOW_CALENDAR_DAYS,
    funnel: { calendar: 0, filtered: 0, tradeable: 0 },
    cards: [],
  };
}
