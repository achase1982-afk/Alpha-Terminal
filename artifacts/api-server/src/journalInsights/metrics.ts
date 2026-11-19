import { calendarDays, formatWindow, startOfYearEt } from "./clock.js";
import { isFlat } from "./ledger.js";
import {
  BENCHMARK_UNAVAILABLE,
  EMPTY_CLOSED,
  SAMPLE_FLOOR,
  type AssetClass,
  type BuiltPosition,
  type CategoryStat,
  type ClosedTradeView,
  type CutStat,
  type InsightSlice,
  type InsightsPayload,
  type MetricBlock,
  type NormalizedActivity,
  type PositionStatus,
  type PositionView,
} from "./types.js";

export interface EquityPoint {
  at: string;
  value: number;
  /** Owning account. Absent only for a book that was already one combined balance. */
  accountRef?: string;
}

export interface BenchmarkPoint {
  date: string;
  adjustedClose: number;
}

function day(value: string): string {
  return value.slice(0, 10);
}

export function modifiedDietz(input: {
  beginning: number;
  ending: number;
  start: string;
  end: string;
  flows: { at: string; amount: number }[];
}): number | null {
  const startMs = Date.parse(input.start);
  const endMs = Date.parse(input.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const span = calendarDays(input.start, input.end);
  const external = input.flows.filter((flow) => {
    const at = Date.parse(flow.at);
    return at > startMs && at <= endMs;
  });
  const flowSum = external.reduce((sum, flow) => sum + flow.amount, 0);
  const gain = input.ending - input.beginning - flowSum;
  const weighted = external.reduce((sum, flow) => {
    const remaining = Math.max(0, calendarDays(flow.at, input.end));
    const weight = span > 0 ? remaining / span : 0;
    return sum + flow.amount * weight;
  }, 0);
  const denominator = input.beginning + weighted;
  if (denominator <= 0) return null;
  return gain / denominator;
}

export function maxDrawdown(nets: { at: string; net: number }[]): number {
  const ordered = [...nets].sort((a, b) => a.at.localeCompare(b.at));
  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const point of ordered) {
    equity += point.net;
    if (equity > peak) peak = equity;
    const drop = equity - peak;
    if (drop < worst) worst = drop;
  }
  return roundMoney(worst);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function metricBlock(positions: BuiltPosition[]): MetricBlock {
  const closed = positions.filter((position) => isFlat(position.status) && position.closedAt);
  const nets = closed.map((position) => position.netPnl);
  const gains = nets.filter((net) => net > 0);
  const losses = nets.filter((net) => net < 0);
  const grossGains = closed.filter((position) => position.grossPnl > 0).reduce((sum, position) => sum + position.grossPnl, 0);
  const lossAbs = Math.abs(losses.reduce((sum, net) => sum + net, 0));
  const net = nets.reduce((sum, value) => sum + value, 0);
  return {
    netPnl: roundMoney(net),
    closedTrades: closed.length,
    expectancy: closed.length ? roundMoney(net / closed.length) : null,
    avgGain: gains.length ? roundMoney(mean(gains) ?? 0) : null,
    avgLoss: losses.length ? roundMoney(mean(losses) ?? 0) : null,
    profitFactor: lossAbs > 0 ? roundMoney(gains.reduce((sum, value) => sum + value, 0) / lossAbs) : null,
    pctClosedPositive: closed.length ? gains.length / closed.length : null,
    maxDrawdown: closed.length ? maxDrawdown(closed.map((position) => ({ at: position.closedAt!, net: position.netPnl }))) : null,
    fees: roundMoney(closed.reduce((sum, position) => sum + position.fees, 0)),
    grossGains: roundMoney(grossGains),
  };
}

function etDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function etMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

function holdingKey(position: BuiltPosition): "under30" | "session" | "overnight" {
  if (!position.closedAt) return "session";
  if (etDate(position.openedAt) !== etDate(position.closedAt)) return "overnight";
  const minutes = (Date.parse(position.closedAt) - Date.parse(position.openedAt)) / 60_000;
  return minutes < 30 ? "under30" : "session";
}

function timeKey(position: BuiltPosition): "before" | "after" {
  return etMinutes(position.ticketAt || position.openedAt) >= 14 * 60 ? "after" : "before";
}

function weekday(position: BuiltPosition): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date(position.ticketAt || position.openedAt));
}

function cut(key: string, label: string, positions: BuiltPosition[]): CutStat {
  const metrics = metricBlock(positions);
  return { key, label, netPnl: metrics.netPnl, trades: metrics.closedTrades, expectancy: metrics.expectancy };
}

function cutsFor(positions: BuiltPosition[]): Pick<InsightSlice, "timeCuts" | "holdingCuts" | "dayCuts"> {
  const closed = positions.filter((position) => isFlat(position.status));
  return {
    timeCuts: [
      cut("before_2pm", "BEFORE 2:00 PM ET", closed.filter((position) => timeKey(position) === "before")),
      cut("after_2pm", "AT OR AFTER 2:00 PM ET", closed.filter((position) => timeKey(position) === "after")),
    ],
    holdingCuts: [
      cut("under_30", "UNDER 30 MIN", closed.filter((position) => holdingKey(position) === "under30")),
      cut("to_close", "30 MIN TO CLOSE", closed.filter((position) => holdingKey(position) === "session")),
      cut("overnight", "HELD OVERNIGHT", closed.filter((position) => holdingKey(position) === "overnight")),
    ],
    dayCuts: [
      ["mon", "Monday"],
      ["tue", "Tuesday"],
      ["wed", "Wednesday"],
      ["thu", "Thursday"],
      ["fri", "Friday"],
    ].map(([key, label]) => cut(key!, label!, closed.filter((position) => weekday(position) === label))),
  };
}

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

const STATUS_LABEL: Record<PositionStatus, string> = {
  open: "Open",
  partial: "Partial",
  closed: "Closed",
  expired: "Expired",
  assigned: "Assigned",
  exercised: "Exercised",
  settled: "Settled",
};

function qtyLabel(position: { assetClass: AssetClass; quantity: number }): string {
  if (position.assetClass === "equity") {
    const shares = Math.round(position.quantity);
    return shares === 1 ? "1 share" : `${shares.toLocaleString("en-US")} shares`;
  }
  const lots = Math.round(position.quantity);
  return lots === 1 ? "1 lot" : `${lots} lots`;
}

function clockParts(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).formatToParts(new Date(iso));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${pick("month")} ${pick("day")}`,
    time: `${pick("hour")}:${pick("minute")} ${pick("dayPeriod").toUpperCase()}`,
  };
}

export function tradeDetail(position: BuiltPosition): string {
  const open = clockParts(position.openedAt);
  const qty = qtyLabel(position);
  if (!position.closedAt || position.status === "open" || position.status === "partial") {
    return `${open.date} · ${open.time} ET · ${position.status === "partial" ? "partial" : "open"} · ${qty}`;
  }
  if (position.status === "closed") {
    const close = clockParts(position.closedAt);
    return `${open.date} · ${open.time} ET · closed ${close.time} · ${qty}`;
  }
  return `${open.date} · ${open.time} ET · ${position.status} · ${qty}`;
}

function tradeView(position: BuiltPosition): ClosedTradeView {
  return {
    id: position.id,
    label: position.label,
    strategy: position.strategy,
    assetClass: position.assetClass,
    status: position.status,
    statusLabel: STATUS_LABEL[position.status],
    detail: tradeDetail(position),
    netPnl: position.netPnl,
    openedAt: position.openedAt,
    closedAt: position.closedAt ?? position.openedAt,
    quantity: position.quantity,
  };
}

function positionView(position: BuiltPosition): PositionView {
  return {
    id: position.id,
    label: position.label,
    strategy: position.strategy,
    assetClass: position.assetClass,
    status: position.status,
    statusLabel: STATUS_LABEL[position.status],
    detail: tradeDetail(position),
    netPnl: position.netPnl,
    unrealizedPnl: position.unrealizedPnl,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
    quantity: position.quantity,
  };
}

function feeSentence(fees: number, grossGains: number, scope: "account" | "category"): string {
  if (grossGains > 0) {
    const pct = ((fees / grossGains) * 100).toFixed(1);
    const tail = scope === "category" ? " in this category" : "";
    return `Fees totaled ${money(fees)}, equal to ${pct}% of gross gains${tail}.`;
  }
  return `Fees totaled ${money(fees)}.`;
}

function plural(count: number): string {
  return count === 1 ? "trade" : "trades";
}

export function perspectiveFor(input: {
  scope: "account" | "category";
  name: string;
  period: "ytd" | "lifetime";
  positions: BuiltPosition[];
  strategies: CategoryStat[];
  assets: CategoryStat[];
}): string {
  const metrics = metricBlock(input.positions);
  if (metrics.closedTrades === 0) return "";
  const periodWord = input.period === "ytd" ? " YTD" : "";
  const positive = metrics.pctClosedPositive == null ? null : `${Math.round(metrics.pctClosedPositive * 100)}%`;
  const avg = metrics.avgGain != null && metrics.avgLoss != null
    ? `Average gain ${money(metrics.avgGain)}; average loss ${money(metrics.avgLoss)}.`
    : metrics.avgGain != null
      ? `Average gain ${money(metrics.avgGain)}.`
      : metrics.avgLoss != null
        ? `Average loss ${money(metrics.avgLoss)}.`
        : "";
  if (input.scope === "category") {
    const before = cut("before", "before", input.positions.filter((position) => isFlat(position.status) && timeKey(position) === "before"));
    const after = cut("after", "after", input.positions.filter((position) => isFlat(position.status) && timeKey(position) === "after"));
    return [
      `${input.name}: ${money(metrics.netPnl)} net after fees on ${metrics.closedTrades} ${plural(metrics.closedTrades)}${periodWord}.`,
      `Before 2:00 PM ET: ${money(before.netPnl)} on ${before.trades} ${plural(before.trades)}.`,
      `At or after 2:00 PM ET: ${money(after.netPnl)} on ${after.trades} ${plural(after.trades)}.`,
      feeSentence(metrics.fees, metrics.grossGains, "category"),
    ].join(" ");
  }
  const eligible = input.strategies.filter((row) => row.sample === "enough").sort((a, b) => b.netPnl - a.netPnl);
  const worst = [...eligible].sort((a, b) => a.netPnl - b.netPnl)[0];
  const bestAsset = input.assets.filter((row) => row.sample === "enough").sort((a, b) => b.netPnl - a.netPnl)[0];
  const sentences: string[] = [];
  const best = eligible[0];
  if (best) {
    sentences.push(`${best.label}: ${money(best.netPnl)} net after fees on ${best.trades} ${plural(best.trades)}${periodWord}.`);
  } else {
    sentences.push(`Net after fees ${money(metrics.netPnl)} on ${metrics.closedTrades} closed ${plural(metrics.closedTrades)}${periodWord}.`);
  }
  if (best && worst && worst.key !== best.key) {
    sentences.push(`${worst.label}: ${money(worst.netPnl)} on ${worst.trades} ${plural(worst.trades)}.`);
  }
  if (bestAsset) {
    sentences.push(`Best eligible category: ${bestAsset.label}, ${money(bestAsset.netPnl)} on ${bestAsset.trades} ${plural(bestAsset.trades)}.`);
  }
  if (worst && (!bestAsset || worst.key !== bestAsset.key)) {
    sentences.push(`Worst: ${worst.label}.`);
  }
  if (positive) sentences.push(`${positive} of closed trades were positive.`);
  if (avg) sentences.push(avg);
  sentences.push(`Net is ${metrics.netPnl < 0 ? "still negative" : metrics.netPnl > 0 ? "positive" : "flat"}.`);
  sentences.push(feeSentence(metrics.fees, metrics.grossGains, "account"));
  const before = cut("before", "before", input.positions.filter((position) => isFlat(position.status) && timeKey(position) === "before"));
  const after = cut("after", "after", input.positions.filter((position) => isFlat(position.status) && timeKey(position) === "after"));
  sentences.push(`At or after 2:00 PM ET: ${money(after.netPnl)} on ${after.trades} ${plural(after.trades)}. Before 2:00 PM ET: ${money(before.netPnl)} on ${before.trades} ${plural(before.trades)}.`);
  return sentences.join(" ");
}

function footnote(input: {
  windowStart: string | null;
  windowEnd: string | null;
  openPositions: number;
  unrealized: number | null;
  benchmarkStatus: "ok" | "unavailable";
  accountReturn: number | null;
}): string {
  const window = input.windowStart && input.windowEnd ? formatWindow(day(input.windowStart), day(input.windowEnd)) : "the same dates";
  const mark = input.unrealized == null
    ? "unrealized not included above"
    : `unrealized ${money(input.unrealized)} at mid, not included above`;
  const bench = input.benchmarkStatus === "ok" ? "S&P 500 total return" : BENCHMARK_UNAVAILABLE.replace(/\.$/, "").toLowerCase();
  const openLabel = input.openPositions === 1 ? "1 open position" : `${input.openPositions} open positions`;
  const withheld = input.accountReturn == null ? "Account return unavailable. " : "";
  return `${withheld}Modified Dietz vs ${bench}, same dates ${window}. Deposits and withdrawals excluded. ${openLabel}, ${mark}.`;
}

const STRATEGY_ORDER = [
  "Credit spreads (puts)",
  "Debit spreads",
  "Credit spreads (calls)",
  "Iron condors (credit)",
  "Iron condors (debit)",
  "Single options",
  "Covered calls",
  "Equities",
  "Other",
];

function categoryRow(key: string, label: string, positions: BuiltPosition[]): CategoryStat {
  const metrics = metricBlock(positions);
  return {
    key,
    label,
    netPnl: metrics.netPnl,
    trades: metrics.closedTrades,
    expectancy: metrics.expectancy,
    sample: metrics.closedTrades >= SAMPLE_FLOOR ? "enough" : "short",
    grossGains: metrics.grossGains,
    fees: metrics.fees,
  };
}

function sliceFor(positions: BuiltPosition[], perspective: string): InsightSlice {
  return {
    metrics: metricBlock(positions),
    ...cutsFor(positions),
    perspective,
    closedTrades: positions
      .filter((position) => isFlat(position.status) && position.closedAt)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
      .map(tradeView),
  };
}

export function buildInsights(input: {
  positions: BuiltPosition[];
  activities: NormalizedActivity[];
  period: "ytd" | "lifetime";
  asOf: string;
  snapshots: EquityPoint[];
  benchmark: BenchmarkPoint[];
}): InsightsPayload {
  const startIso = input.period === "ytd" ? startOfYearEt(input.asOf) : null;
  const inPeriod = (position: BuiltPosition) => {
    if (!isFlat(position.status) || !position.closedAt) return false;
    if (!startIso) return true;
    return position.closedAt >= startIso && position.closedAt <= input.asOf;
  };
  const closed = input.positions.filter(inPeriod);
  const openPositions = input.positions.filter((position) => position.status === "open" || position.status === "partial");
  const unrealizedValues = openPositions.map((position) => position.unrealizedPnl);
  const unrealized = unrealizedValues.length > 0 && unrealizedValues.every((value) => value != null)
    ? roundMoney(unrealizedValues.reduce<number>((sum, value) => sum + (value ?? 0), 0))
    : null;

  const firstClose = closed.map((position) => position.closedAt!).sort()[0] ?? null;
  const requestedStart = startIso ?? firstClose;
  const requestedEnd = input.asOf;
  const compared = accountComparison({
    snapshots: input.snapshots,
    activities: input.activities,
    windowStart: requestedStart,
    windowEnd: requestedEnd,
  });
  const windowStart = compared.windowStart;
  const windowEnd = compared.windowEnd;
  const accountReturn = compared.accountReturn;
  const benchmarkReturnValue = windowStart && windowEnd ? benchmarkReturn(input.benchmark, windowStart, windowEnd) : null;
  const benchmarkStatus = benchmarkReturnValue == null ? "unavailable" as const : "ok" as const;
  const names = STRATEGY_ORDER.filter((name) => closed.some((position) => position.strategy === name));
  const strategyRows = names.map((name) => categoryRow(name, name, closed.filter((position) => position.strategy === name)));
  const assetRows = (["equity", "option"] as const)
    .map((asset) => categoryRow(asset, asset === "equity" ? "Equities" : "Options", closed.filter((position) => position.assetClass === asset)))
    .filter((row) => row.trades > 0);
  const accountMetrics = metricBlock(closed);
  const empty = accountMetrics.closedTrades === 0;
  const accountPerspective = perspectiveFor({
    scope: "account",
    name: "account",
    period: input.period,
    positions: closed,
    strategies: strategyRows,
    assets: assetRows,
  });
  const byStrategy: Record<string, InsightSlice> = {};
  for (const row of strategyRows) {
    const rows = closed.filter((position) => position.strategy === row.key);
    byStrategy[row.key] = sliceFor(rows, perspectiveFor({
      scope: "category",
      name: row.label,
      period: input.period,
      positions: rows,
      strategies: strategyRows,
      assets: assetRows,
    }));
  }
  const headline = empty ? null : {
    tone: accountMetrics.netPnl > 0 ? "positive" as const : accountMetrics.netPnl < 0 ? "negative" as const : "flat" as const,
    label: accountMetrics.netPnl > 0 ? "IN THE BLACK" : accountMetrics.netPnl < 0 ? "IN THE RED" : "FLAT",
    netPnl: accountMetrics.netPnl,
    closedTrades: accountMetrics.closedTrades,
  };
  return {
    period: input.period,
    asOf: input.asOf,
    empty,
    emptyMessage: empty ? EMPTY_CLOSED : null,
    headline,
    comparison: {
      accountReturn,
      benchmarkReturn: benchmarkReturnValue,
      benchmarkStatus,
      windowStart,
      windowEnd,
      openPositions: openPositions.length,
      unrealizedPnl: unrealized,
      footnote: footnote({
        windowStart,
        windowEnd,
        openPositions: openPositions.length,
        unrealized,
        benchmarkStatus,
        accountReturn,
      }),
    },
    account: empty ? null : sliceFor(closed, accountPerspective),
    assetClasses: assetRows,
    strategies: strategyRows,
    byStrategy,
    positions: [...input.positions]
      .sort((a, b) => (b.closedAt ?? b.openedAt).localeCompare(a.closedAt ?? a.openedAt))
      .map(positionView),
  };
}

const SNAPSHOT_MATCH_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSFER_MATCH_MS = 24 * 60 * 60 * 1000;

interface TaggedSnapshot extends EquityPoint {
  accountRef: string;
  id: number;
}

function tagSnapshots(points: EquityPoint[]): TaggedSnapshot[] {
  return points.map((point, id) => ({ ...point, accountRef: point.accountRef ?? "", id }));
}

function nearestTagged(points: TaggedSnapshot[], targetMs: number): TaggedSnapshot | null {
  let best: TaggedSnapshot | null = null;
  let bestGap = Infinity;
  for (const point of points) {
    const gap = Math.abs(Date.parse(point.at) - targetMs);
    if (gap < bestGap && gap <= SNAPSHOT_MATCH_MS) {
      best = point;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Both ends must be the same account, or every account present at the window
 * must be present at both ends. One snapshot is never both ends. The Dietz
 * window is the actual valuation timestamps.
 */
export function accountComparison(input: {
  snapshots: EquityPoint[];
  activities: NormalizedActivity[];
  windowStart: string | null;
  windowEnd: string;
}): { accountReturn: number | null; windowStart: string | null; windowEnd: string | null } {
  if (!input.windowStart) return { accountReturn: null, windowStart: null, windowEnd: input.windowEnd };
  const tagged = tagSnapshots(input.snapshots);
  const startMs = Date.parse(input.windowStart);
  const endMs = Date.parse(input.windowEnd);
  const inWindow = new Set<string>();
  for (const point of tagged) {
    const at = Date.parse(point.at);
    if (Math.abs(at - startMs) <= SNAPSHOT_MATCH_MS || Math.abs(at - endMs) <= SNAPSHOT_MATCH_MS) inWindow.add(point.accountRef);
  }
  if (inWindow.size === 0) {
    return { accountReturn: null, windowStart: input.windowStart, windowEnd: input.windowEnd };
  }
  const starts: TaggedSnapshot[] = [];
  const ends: TaggedSnapshot[] = [];
  for (const accountRef of inWindow) {
    const mine = tagged.filter((point) => point.accountRef === accountRef);
    const opening = nearestTagged(mine, startMs);
    const closing = nearestTagged(mine, endMs);
    if (!opening || !closing || opening.id === closing.id) {
      return { accountReturn: null, windowStart: input.windowStart, windowEnd: input.windowEnd };
    }
    starts.push(opening);
    ends.push(closing);
  }
  const startAt = starts[0]?.at;
  const endAt = ends[0]?.at;
  if (!startAt || !endAt || starts.some((point) => point.at !== startAt) || ends.some((point) => point.at !== endAt)) {
    return { accountReturn: null, windowStart: input.windowStart, windowEnd: input.windowEnd };
  }
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    return { accountReturn: null, windowStart: input.windowStart, windowEnd: input.windowEnd };
  }
  const accountReturn = modifiedDietz({
    beginning: starts.reduce((sum, point) => sum + point.value, 0),
    ending: ends.reduce((sum, point) => sum + point.value, 0),
    start: startAt,
    end: endAt,
    flows: externalFlows(input.activities, inWindow),
  });
  return { accountReturn, windowStart: startAt, windowEnd: endAt };
}

function externalFlows(activities: NormalizedActivity[], accounts: Set<string>): { at: string; amount: number }[] {
  const cash = activities.filter((activity) => activity.kind === "deposit" || activity.kind === "withdrawal");
  const scoped = accounts.has("") ? cash : cash.filter((activity) => accounts.has(activity.accountRef));
  const internal = new Set<string>();
  for (const out of scoped) {
    if (out.kind !== "withdrawal" || internal.has(out.id)) continue;
    const match = scoped.find((inn) =>
      inn.kind === "deposit" &&
      !internal.has(inn.id) &&
      inn.accountRef !== out.accountRef &&
      Math.abs(Math.abs(inn.netAmount) - Math.abs(out.netAmount)) < 0.005 &&
      Math.abs(Date.parse(inn.occurredAt) - Date.parse(out.occurredAt)) <= TRANSFER_MATCH_MS,
    );
    if (!match) continue;
    internal.add(out.id);
    internal.add(match.id);
  }
  return scoped
    .filter((activity) => !internal.has(activity.id))
    .map((activity) => ({
      at: activity.occurredAt,
      amount: activity.kind === "withdrawal" ? -Math.abs(activity.netAmount) : Math.abs(activity.netAmount),
    }));
}

export function benchmarkReturn(points: BenchmarkPoint[], start: string, end: string): number | null {
  const ordered = points.filter((point) => point.adjustedClose > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length < 2) return null;
  const startDate = day(start);
  const endDate = day(end);
  const first = [...ordered].reverse().find((point) => point.date <= startDate) ?? ordered.find((point) => point.date >= startDate);
  const last = [...ordered].reverse().find((point) => point.date <= endDate);
  if (!first || !last || last.date < first.date || first.date === last.date) return null;
  return last.adjustedClose / first.adjustedClose - 1;
}

export const copy = { EMPTY_CLOSED, BENCHMARK_UNAVAILABLE };
