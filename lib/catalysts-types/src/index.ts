export { CATALYST_DRIFT_SESSION_COUNT } from "./constants.js";

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
  /** SPY 10-session cumulative drift (sum of daily SPY %); null when SPY poll failed. */
  benchmarkDrift10dPct: number | null;
  cards: CatalystCard[];
}

export interface CatalystSessionSnapshot {
  /** Ten settled NYSE dates (oldest first), D-9 … D-0. */
  sessionDates: string[];
  closes: number[];
  /** Per session: stock daily % − SPY daily % (length 10). */
  sessionMovesPct: number[];
  /** Raw stock daily % (length 10) for display when SPY unavailable. */
  sessionMovesRawPct: number[];
  cumulative1d: number;
  cumulative3d: number;
  cumulative5d: number;
  cumulative10d: number;
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
  /** Optional display tag — S&P Composite 1500 membership; does not gate inclusion. */
  inSp1500?: boolean;
  /** Live options probe could not confirm chain — name kept per repair spec. */
  optionsChainUnconfirmed?: boolean;
  snapshot: CatalystSessionSnapshot;
}

export type CatalystsSortKey = "soonest" | "fiveDayMove" | "streak";

export function emptyCatalystsFeed(): CatalystsFeed {
  return {
    builtAt: "",
    status: "empty",
    windowDays: CATALYSTS_WINDOW_CALENDAR_DAYS,
    funnel: { calendar: 0, filtered: 0, tradeable: 0 },
    benchmarkDrift10dPct: null,
    cards: [],
  };
}
