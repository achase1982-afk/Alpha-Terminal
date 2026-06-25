/** Shared contracts that cross every engine module boundary. */

export type RunMode = "shadow" | "live";
export type Action = "BUY" | "SELL";
export type ExitReason =
  | "TARGET_HIT"
  | "STOP_HIT"
  | "TIME_STOP"
  | "RISK_HALT"
  | "KILL_SWITCH"
  | "RECONCILED"; // broker showed the position closed; engine corrected to match

export interface Bar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number; // cumulative session VWAP at close of this bar
}

export type TrendLabel =
  | "BULLISH"
  | "BEARISH"
  | "PULLBACK"
  | "RECOVERY"
  | "MIXED"
  | "UNDETERMINED";

export interface Features {
  // ── Opening range (used by the legacy ORB setup) ──
  orHigh: number;
  orLow: number;
  orRange: number;
  orComplete: boolean;

  // ── Session ──
  last: number;        // latest traded price (quote last, else last bar close)
  rvol: number;        // cumulative session volume / historical expected at this minute
  atr: number;         // ATR(14) from 1-min bars
  vwap: number;        // cumulative session VWAP
  vwapDist: number;    // last − vwap (signed)
  dayHigh: number;
  dayLow: number;
  rangePos: number;    // (last − dayLow) / (dayHigh − dayLow), 0–1
  spread: number;
  spreadBps: number;
  minutesSinceOpen: number;

  // ── Latest-bar shape ──
  body: number;        // close − open (signed)
  bodyFrac: number;    // |body| / bar range, 0–1
  bodyAtr: number;     // |body| / atr
  upperWick: number;   // high − max(open, close)
  lowerWick: number;   // min(open, close) − low
  volAvg: number;      // trailing N-bar average volume
  volRatio: number;    // latest bar volume / volAvg
  recentDirection: number; // −1..+1 over the last K bars (highs/lows sequence)
  bodyShrinking: boolean;  // latest |body| < prior |body|

  // ── Confirmation indicators (ported from lib/ta.ts) ──
  rsi: number;
  ema50: number;
  ema200: number;
  trend: TrendLabel;

  // ── Swing range rails (VWAP ± band) ──
  lowerRail: number;
  upperRail: number;
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

export type SetupName = "orb" | "swing";

export interface Config {
  // ── Symbols & account ──
  symbol: string;          // legacy single-symbol field (kept = symbols[0])
  symbols: string[];       // full watch list — the engine runs each independently
  accountHash: string;
  setup: SetupName;        // active strategy ("swing" by default)

  // ── Opening range (legacy ORB setup) ──
  orWindowMinutes: number;
  rvolThreshold: number;
  stopMode: "or_low" | "atr";
  atrK: number;
  rTarget: number;
  minTargetOverSpread: number;

  // ── Swing setup ──
  bodyAvgWindow: number;            // rolling window for body averaging
  volAvgWindow: number;             // trailing N-bar window for volume averaging
  directionLookback: number;        // K bars for short-term direction read
  vwapBandAtrMult: number;          // rail = VWAP ± (this × ATR)
  belowVwapStretchThreshold: number; // 0–1: how far toward the lower rail price must stretch
  volDryingThreshold: number;       // entry needs latest volRatio ≤ this (volume drying)
  rsiEntryMin: number;              // entry RSI lower gate
  rsiEntryMax: number;              // entry RSI upper gate
  swingTargetRail: "vwap" | "upper"; // take profit back to VWAP or the upper rail
  stopBelowRailAtrMult: number;     // hard stop = lower rail − (this × ATR)
  volumeProfileLookbackDays: number; // sessions of history for the RVOL baseline

  // ── Risk / sizing ──
  dailyLossHaltPct: number;
  riskPerTradePct: number;
  maxPositionSizePct: number;
  lossStreakLimit: number;
  cooldownMinutes: number;
  tradesPerDay: number;
  enableShorts: boolean;

  // ── Execution ──
  runMode: RunMode;        // "shadow" = paper (default) | "live" = real orders
  cancelTimeoutSeconds: number;
  timeStop: string;        // ET HH:MM — flatten all positions at/after this time
  startingEquity: number;  // account equity used for % sizing
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

export interface SymbolStatus {
  symbol: string;
  position: Position | null;
  features: Features;
  lastBarAt: Date | null;
}

export interface EngineStatus {
  running: boolean;
  runMode: RunMode;
  setup: SetupName;
  /** Per-symbol live state — the engine watches every configured symbol. */
  symbols: SymbolStatus[];
  riskState: RiskState;
  startedAt: Date | null;
  // ── Backward-compatible scalars (mirror symbols[0]) ──
  symbol: string;
  position: Position | null;
  features: Features;
  lastBarAt: Date | null;
}
