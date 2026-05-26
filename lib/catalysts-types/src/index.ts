import {
  DEFAULT_CATALYST_GATE_SETTINGS,
  normalizeCatalystGateSettings,
  type CatalystGateSettings,
} from "./gateSettings.js";

export {
  DEFAULT_CATALYST_GATE_SETTINGS,
  normalizeCatalystGateSettings,
  type CatalystGateSettings,
};

export const CATALYSTS_WINDOW_CALENDAR_DAYS = 10;

export type CatalystsFeedStatus = "ready" | "building" | "empty";

export type EarningsTiming = "BMO" | "AMC" | null;

/** Same reject reasons as Movers tradeability gate (shared implementation). */
export type CatalystTradeabilityRejectReason =
  | "LEVERAGED_ETF"
  | "SUB_5"
  | "MICRO_CAP"
  | "LOW_VOLUME"
  | "NO_OPTIONS";

export type CatalystFilterBreakdown = Record<CatalystTradeabilityRejectReason, number> & {
  /** Passed tradeability but missing 5 settled sessions in equity_daily. */
  NO_SESSION_DATA: number;
};

export interface CatalystsFeed {
  builtAt: string;
  status: CatalystsFeedStatus;
  windowDays: number;
  funnel: {
    /** Symbols with earnings in the 10-day window (from harvest table). */
    calendar: number;
    /** Removed by tradeability + options gates. */
    filtered: number;
    /** Cards shown on the tab. */
    tradeable: number;
    filterBreakdown: CatalystFilterBreakdown;
  };
  /** SPY settled-session cumulative 5d % — for vs-S&P column on cards. */
  benchmarkDrift5dPct: number | null;
  /** Gate profile used for this build (for UI + debugging). */
  gateSettings: CatalystGateSettings;
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
  /** Optional display tag — S&P Composite 1500 membership; does not gate inclusion. */
  inSp1500?: boolean;
  snapshot: CatalystSessionSnapshot;
}

export type CatalystsSortKey = "soonest" | "fiveDayMove" | "streak";

export function emptyCatalystFilterBreakdown(): CatalystFilterBreakdown {
  return {
    LEVERAGED_ETF: 0,
    SUB_5: 0,
    MICRO_CAP: 0,
    LOW_VOLUME: 0,
    NO_OPTIONS: 0,
    NO_SESSION_DATA: 0,
  };
}

export function emptyCatalystsFeed(): CatalystsFeed {
  return {
    builtAt: "",
    status: "empty",
    windowDays: CATALYSTS_WINDOW_CALENDAR_DAYS,
    funnel: {
      calendar: 0,
      filtered: 0,
      tradeable: 0,
      filterBreakdown: emptyCatalystFilterBreakdown(),
    },
    benchmarkDrift5dPct: null,
    gateSettings: { ...DEFAULT_CATALYST_GATE_SETTINGS },
    cards: [],
  };
}
