/** Shared contracts that cross every engine module boundary. */

export type RunMode = "shadow" | "live";
export type Action = "BUY" | "SELL";
export type ExitReason =
  | "TARGET_HIT"
  | "STOP_HIT"
  | "TIME_STOP"
  | "RISK_HALT"
  | "KILL_SWITCH";

export interface Bar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number; // cumulative session VWAP at close of this bar
}

export interface Features {
  orHigh: number;
  orLow: number;
  orRange: number;
  orComplete: boolean;
  rvol: number;
  atr: number;
  vwap: number;
  spread: number;
  spreadBps: number;
  minutesSinceOpen: number;
}

export interface Signal {
  timestamp: Date;
  symbol: string;
  action: Action;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  size: number;
  confidence: number;
  reason: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  stopPrice: number;
  targetPrice: number;
  isFlat: boolean;
}

export interface AccountState {
  netLiquidation: number;
  dailyPnlPct: number;
  dayTradesRemaining: number;
}

export interface RiskState {
  halted: boolean;
  haltReason?: string;
  dailyLossHalt: boolean;
  lossStreak: number;
  cooldownUntil?: Date;
  tradesToday: number;
  symbolsTradedToday: string[];
}

export interface Config {
  symbol: string;
  accountHash: string;
  orWindowMinutes: number;
  rvolThreshold: number;
  stopMode: "or_low" | "atr";
  atrK: number;
  rTarget: number;
  minTargetOverSpread: number;
  dailyLossHaltPct: number;
  riskPerTradePct: number;
  maxPositionSizePct: number;
  lossStreakLimit: number;
  cooldownMinutes: number;
  tradesPerDay: number;
  enableShorts: boolean;
  runMode: RunMode;
  cancelTimeoutSeconds: number;
  timeStop: string;
  startingEquity: number;
  logDb: string;
}

export interface Fill {
  orderId: string;
  symbol: string;
  action: Action;
  price: number;
  quantity: number;
  filledAt: Date;
}

export interface ExitRecord {
  entryOrderId: string;
  exitOrderId: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  exitReason: ExitReason;
  exitAt: Date;
}

export interface EngineStatus {
  running: boolean;
  runMode: RunMode;
  symbol: string;
  position: Position | null;
  features: Features;
  riskState: RiskState;
  lastBarAt: Date | null;
  startedAt: Date | null;
}
