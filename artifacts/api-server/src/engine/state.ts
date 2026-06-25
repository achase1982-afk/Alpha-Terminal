/** Runtime singleton — one mutable object shared by all engine modules. */
import { initFeatures } from "./features.js";
import type {
  Bar,
  Position,
  Signal,
  RiskState,
  AccountState,
  EngineStatus,
  SymbolStatus,
  Features,
} from "./types.js";

/** Per-symbol live state. The engine runs one of these for each configured symbol. */
export interface SymbolState {
  symbol: string;
  sessionBars: Bar[];
  features: Features;
  position: Position | null;
  /** Historical per-minute volume profile (built once at start). */
  volumeProfile: Map<number, number>;
  /** Active entry order id + signal (cancel-timeout + fill simulation). */
  pendingEntryOrderId: string | null;
  pendingEntryAt: number | null;
  pendingSignal: Signal | null;
  lastBarAt: Date | null;
}

export interface EngineState {
  running: boolean;
  startedAt: Date | null;
  dayKey: string; // "YYYY-MM-DD" in ET — reset triggers at day boundary

  /** symbol → per-symbol state */
  symbols: Map<string, SymbolState>;

  // Account-wide risk (shared across all symbols).
  riskState: RiskState;
  account: AccountState;
}

export function newSymbolState(symbol: string): SymbolState {
  return {
    symbol,
    sessionBars: [],
    features: initFeatures(),
    position: null,
    volumeProfile: new Map(),
    pendingEntryOrderId: null,
    pendingEntryAt: null,
    pendingSignal: null,
    lastBarAt: null,
  };
}

export const state: EngineState = {
  running: false,
  startedAt: null,
  dayKey: "",

  symbols: new Map(),

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
};

export function etDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function toSymbolStatus(s: SymbolState): SymbolStatus {
  return {
    symbol: s.symbol,
    position: s.position ? { ...s.position } : null,
    features: { ...s.features },
    lastBarAt: s.lastBarAt,
  };
}

export function toEngineStatus(): EngineStatus {
  const symbols = [...state.symbols.values()].map(toSymbolStatus);
  const first = symbols[0];
  return {
    running: state.running,
    setup: "swing", // overwritten by index.ts with cfg.setup
    symbols,
    riskState: { ...state.riskState },
    startedAt: state.startedAt,
    // Backward-compatible scalars mirror the first symbol.
    symbol: first?.symbol ?? "",
    position: first?.position ?? null,
    features: first?.features ?? initFeatures(),
    lastBarAt: first?.lastBarAt ?? null,
  };
}
