/** Runtime singleton — one mutable object shared by all engine modules. */
import { initFeatures } from "./features.js";
import type { Bar, Position, RiskState, AccountState, EngineStatus, Features } from "./types.js";

export interface EngineState {
  running: boolean;
  startedAt: Date | null;
  lastBarAt: Date | null;
  symbol: string;

  sessionBars: Bar[];
  volumeProfile: Map<number, number>; // minute index → avg daily volume at that minute
  vwapAccum: { pv: number; vol: number }; // running VWAP accumulators

  features: Features;
  position: Position | null;
  riskState: RiskState;
  account: AccountState;

  // Used to detect whether we've already entered today
  enteredToday: boolean;
  dayKey: string; // "YYYY-MM-DD" in ET — reset triggers at day boundary

  // Active entry order ID (for cancel-timeout tracking)
  pendingEntryOrderId: string | null;
  pendingEntryAt: number | null; // Date.now() when order was placed
}

export const state: EngineState = {
  running: false,
  startedAt: null,
  lastBarAt: null,
  symbol: "",

  sessionBars: [],
  volumeProfile: new Map(),
  vwapAccum: { pv: 0, vol: 0 },

  features: initFeatures(),
  position: null,
  riskState: {
    halted: false,
    dailyLossHalt: false,
    lossStreak: 0,
    tradesToday: 0,
    symbolsTradedToday: [],
  },
  account: {
    netLiquidation: 0,
    dailyPnlPct: 0,
    dayTradesRemaining: 3,
  },

  enteredToday: false,
  dayKey: "",
  pendingEntryOrderId: null,
  pendingEntryAt: null,
};

export function etDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export function toEngineStatus(): EngineStatus {
  const { running, startedAt, lastBarAt, symbol, features, position, riskState } = state;
  return {
    running,
    startedAt,
    lastBarAt,
    symbol,
    features: { ...features },
    position: position ? { ...position } : null,
    riskState: { ...riskState },
    runMode: "shadow", // filled in by index.ts with cfg.runMode
  };
}
