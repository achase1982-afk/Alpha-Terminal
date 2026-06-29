/** Shared contracts that cross every engine module boundary. */

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
  targetPrice: number;       // 0 = no fixed target (momentum uses a trailing stop)
  isFlat: boolean;
  // ── Trailing-stop / management state ──
  highWaterMark?: number;    // highest high seen since entry (drives the trail)
  entryAt?: number;          // epoch ms of entry (for minutes-held)
  stopOrderId?: string | null; // broker order id of the resting protective stop
  thesis?: string;           // entry rationale (LLM thesis / momentum reason)
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

/** Which auto-trader engine START launches. */
export type EngineKind = "deterministic" | "llm";

export interface Config {
  // ── Symbols & account ──
  symbol: string;          // legacy single-symbol field (kept = symbols[0])
  symbols: string[];       // full watch list — the engine runs each independently
  accountHash: string;
  setup: SetupName;        // active strategy ("swing" by default)

  // ── Engine selection ──
  engine: EngineKind;      // "deterministic" (momentum) | "llm"
  modelId: string;         // model used when engine === "llm"

  // ── Opening range (legacy ORB setup) ──
  orWindowMinutes: number;
  rvolThreshold: number;
  stopMode: "or_low" | "atr";
  atrK: number;
  rTarget: number;
  minTargetOverSpread: number;

  // ── Momentum setup (active "swing" strategy) ──
  breakoutLookback: number;         // N-bar high that price must break above to enter
  momVolRatioMin: number;           // entry bar volume ≥ this × trailing avg
  momRvolMin: number;               // cumulative RVOL ≥ this
  momRsiMin: number;                // entry RSI lower gate (strength band)
  momRsiMax: number;                // entry RSI upper gate (avoid blow-off top)
  momStopAtrMult: number;           // stop floor = entry − (this × ATR)
  momTrailAtrMult: number;          // trail = price − (this × ATR) on each new high
  volumeProfileLookbackDays: number; // sessions of history for the RVOL baseline

  // ── Legacy swing knobs (unused by momentum; kept for the ORB setup / back-compat) ──
  bodyAvgWindow: number;
  volAvgWindow: number;
  directionLookback: number;
  vwapBandAtrMult: number;
  belowVwapStretchThreshold: number;
  volDryingThreshold: number;
  reversalVolRatioMin: number;
  rsiEntryMin: number;
  rsiEntryMax: number;
  swingTargetRail: "vwap" | "upper";
  stopBelowRailAtrMult: number;

  // ── Dollar risk (operative controls for both engines) ──
  totalBudget: number;     // hard ceiling on total open exposure across all positions
  maxPerTrade: number;     // max notional per single entry
  dailyMaxLoss: number;    // halt the session when realized P/L drops by this many $
  pollIntervalSec: number; // per-symbol evaluation cadence

  // ── LLM exit protection (code-enforced; the LLM has no broker stop) ──
  profitLockArmPct: number;      // arm the profit-lock once a position is up ≥ this (0.005 = +0.5%)
  profitLockGiveBackPct: number; // once armed, exit if it gives back this fraction of the peak gain (0.4 = 40%)
  disasterStopPct: number;       // hard floor: cut a position down ≥ this from entry (0.02 = −2%)
  lossStreakLimit: number;
  cooldownMinutes: number;
  tradesPerDay: number;
  enableShorts: boolean;

  // ── Session controls ──
  enableExtendedHours: boolean; // 7AM–8PM ET via LIMIT orders
  flattenAtClose: boolean;      // market-close all open positions at 3:50 PM ET

  // ── Execution ── (always live — real Schwab orders)
  cancelTimeoutSeconds: number;
  timeStop: string;        // ET HH:MM — flatten all positions at/after this time
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
  setup: SetupName;
  /** Which engine is currently active (null when idle). */
  activeEngine: EngineKind | null;
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
