/** Normalized history and the insights response. No vendor vocabulary. */

export type ActivityKind =
  | "trade"
  | "expiration"
  | "assignment"
  | "exercise"
  | "cash_settlement"
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "interest"
  | "fee"
  | "other";

export type AssetClass = "equity" | "option";

export type PositionStatus =
  | "open"
  | "partial"
  | "closed"
  | "expired"
  | "assigned"
  | "exercised"
  | "settled";

export interface NormalizedLeg {
  instrumentKey: string;
  assetClass: AssetClass | "other";
  underlying: string;
  putCall: "put" | "call" | null;
  strike: number | null;
  expiration: string | null;
  /** Signed contracts or shares. Positive buys / increases a long. */
  quantityDelta: number;
  price: number;
  multiplier: number;
  fees: number;
  effect: "open" | "close" | null;
}

export interface NormalizedActivity {
  id: string;
  accountRef: string;
  occurredAt: string;
  kind: ActivityKind;
  /** Cash into the book. Positive means cash received. */
  netAmount: number;
  fees: number;
  orderRef: string | null;
  description: string;
  legs: NormalizedLeg[];
  /** Shared structure id. Wings with the same id were opened as one strategy. */
  strategyRef?: string | null;
}

export interface NormalizedOrder {
  id: string;
  accountRef: string;
  enteredAt: string;
  closedAt: string | null;
  status: string;
  legs: NormalizedLeg[];
}

export interface BuiltLot {
  id: string;
  accountRef: string;
  positionId: string;
  instrumentKey: string;
  side: "long" | "short";
  openedAt: string;
  closedAt: string | null;
  openQty: number;
  remainingQty: number;
  openPrice: number;
  multiplier: number;
  fees: number;
  realizedPnl: number;
}

export interface BuiltPosition {
  id: string;
  accountRef: string;
  strategy: string;
  assetClass: AssetClass;
  underlying: string;
  label: string;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
  ticketAt: string;
  quantity: number;
  remainingQty: number;
  netPnl: number;
  grossPnl: number;
  fees: number;
  unrealizedPnl: number | null;
  rolledFromId: string | null;
  legs: NormalizedLeg[];
}

export interface CutStat {
  key: string;
  label: string;
  netPnl: number;
  trades: number;
  expectancy: number | null;
}

export interface CategoryStat {
  key: string;
  label: string;
  netPnl: number;
  trades: number;
  expectancy: number | null;
  sample: "enough" | "short";
  grossGains: number;
  fees: number;
}

export interface MetricBlock {
  expectancy: number | null;
  avgGain: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  closedTrades: number;
  pctClosedPositive: number | null;
  fees: number;
  maxDrawdown: number | null;
  grossGains: number;
  netPnl: number;
}

export interface ClosedTradeView {
  id: string;
  label: string;
  strategy: string;
  assetClass: AssetClass;
  status: PositionStatus;
  statusLabel: string;
  detail: string;
  netPnl: number;
  openedAt: string;
  closedAt: string;
  quantity: number;
}

export interface PositionView {
  id: string;
  label: string;
  strategy: string;
  assetClass: AssetClass;
  status: PositionStatus;
  statusLabel: string;
  detail: string;
  netPnl: number | null;
  unrealizedPnl: number | null;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
}

export interface InsightSlice {
  metrics: MetricBlock;
  timeCuts: CutStat[];
  holdingCuts: CutStat[];
  dayCuts: CutStat[];
  perspective: string;
  closedTrades: ClosedTradeView[];
}

export interface InsightsPayload {
  period: "ytd" | "lifetime";
  asOf: string;
  empty: boolean;
  emptyMessage: string | null;
  headline: { tone: "positive" | "negative" | "flat"; label: string; netPnl: number; closedTrades: number } | null;
  comparison: {
    accountReturn: number | null;
    benchmarkReturn: number | null;
    benchmarkStatus: "ok" | "unavailable";
    windowStart: string | null;
    windowEnd: string | null;
    openPositions: number;
    unrealizedPnl: number | null;
    footnote: string;
  };
  account: InsightSlice | null;
  assetClasses: CategoryStat[];
  strategies: CategoryStat[];
  byStrategy: Record<string, InsightSlice>;
  positions: PositionView[];
}

export const EMPTY_CLOSED = "No closed trades in this period.";
export const BENCHMARK_UNAVAILABLE = "Benchmark unavailable.";
/** Closed trades required before a category is treated as a stable sample. */
export const SAMPLE_FLOOR = 30;
/** Two opening tickets at or inside this gap can form one iron condor. */
export const PAIR_WINDOW_MS = 300_000;
export const HISTORY_START_MS = Date.parse("2000-01-01T00:00:00.000Z");
export const ORDER_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
export const ACTIVITY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
export const SYNC_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;
