export type JournalPeriod = "30d" | "90d" | "ytd" | "lifetime";
export type JournalView = "insights" | "trades";

export interface CutStat {
  key: string;
  label: string;
  netPnl: number;
  trades: number;
  expectancy: number | null;
}

export interface CurvePoint {
  at: string;
  cum: number;
}

export interface UnderlyingStat {
  symbol: string;
  netPnl: number;
  trades: number;
}

export interface HoldSummary {
  avgPositiveMin: number | null;
  avgNegativeMin: number | null;
}

export interface ExcursionView {
  record: "full" | "partial" | "none";
  mfe: number | null;
  mae: number | null;
  timeToMfeMin: number | null;
  peakCapturePct: number | null;
  bestAt: string | null;
  label: string;
}

export interface JournalBook {
  id: string;
  label: string;
  paper: boolean;
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
  assetClass: "equity" | "option";
  status: string;
  statusLabel: string;
  detail: string;
  netPnl: number;
  openedAt: string;
  closedAt: string;
  quantity: number;
  underlying?: string;
  fees?: number;
  excursion?: ExcursionView | null;
}

export interface PositionView {
  id: string;
  label: string;
  strategy: string;
  assetClass: "equity" | "option";
  status: string;
  statusLabel: string;
  detail: string;
  netPnl: number | null;
  unrealizedPnl: number | null;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  underlying?: string;
  fees?: number;
  accountRef?: string;
  excursion?: ExcursionView | null;
}

export interface InsightSlice {
  metrics: MetricBlock;
  timeCuts: CutStat[];
  holdingCuts: CutStat[];
  dayCuts: CutStat[];
  hourCuts?: CutStat[];
  dteCuts?: CutStat[];
  holdSummary?: HoldSummary;
  curve?: CurvePoint[];
  perspective: string;
  closedTrades: ClosedTradeView[];
  recordedLine?: string | null;
}

export interface InsightsPayload {
  period: JournalPeriod;
  accountId?: string;
  paper?: boolean;
  books?: JournalBook[];
  takeaway?: string | null;
  underlyings?: UnderlyingStat[];
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

export function money(value: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (value > 0) return `+$${abs}`;
  if (value < 0) return `-$${abs}`;
  return `$${abs}`;
}

export function signedPct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value * 100;
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return `+${abs}%`;
  if (pct < 0) return `-${abs}%`;
  return `${abs}%`;
}

export function signColor(value: number | null): string {
  if (value == null || value === 0) return "#e4e4e7";
  return value > 0 ? "#00d166" : "#dc2626";
}

export function unsignedMoney(value: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `$${abs}`;
}

export function holdPhrase(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}
