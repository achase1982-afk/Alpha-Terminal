export {
  CATALYST_GATE_LIMITS,
  DEFAULT_CATALYST_GATE_SETTINGS,
  formatMarketCapFloorLabel,
  formatVolumeFloorLabel,
  marketCapUsdToBillionsInput,
  normalizeCatalystGateSettings,
  parseMarketCapBillionsInput,
  parsePriceFloorInput,
  parseVolumeFloorInput,
  volumeFloorToInput,
  type CatalystGateSettings,
} from "./gateSettings.js";

import {
  DEFAULT_CATALYST_GATE_SETTINGS,
  type CatalystGateSettings,
} from "./gateSettings.js";

export { CATALYST_DRIFT_SESSION_COUNT } from "./constants.js";

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
  /** Passed tradeability but missing 10 settled Schwab sessions for drift. */
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
  /** SPY 10-session cumulative drift (sum of daily SPY %); null when SPY poll failed. */
  benchmarkDrift10dPct: number | null;
  /** Gate profile used for this build (for UI + debugging). */
  gateSettings: CatalystGateSettings;
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
    benchmarkDrift10dPct: null,
    gateSettings: { ...DEFAULT_CATALYST_GATE_SETTINGS },
    cards: [],
  };
}
