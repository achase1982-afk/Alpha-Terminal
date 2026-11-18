import type { Response } from "express";
import WebSocket from "ws";
import { db, schwabChartEquityBarsTable, sql } from "@workspace/db";
import { logger } from "./logger.js";
import { getValidAccessToken, forceRefresh } from "./tokenStore.js";
import { sendPushToAll } from "./pushService.js";
import { handleFillForExitStaging } from "./exitStaging.js";
import { logFailure } from "./telemetry.js";
import { emitTelemetry } from "./telemetryStore.js";
import {
  onSchwabConnectionOpened,
  onSchwabEvictedYielded,
  onSchwabInboundFrame,
  onSchwabOutboundFrame,
} from "./desk/deskStreamerTap.js";
import {
  deskLiveFlowTapeOnEquityL1,
  deskLiveFlowTapeOnFuturesL1,
  deskLiveFlowTapeOnTimesaleEquity,
  deskLiveFlowTapeOnTimesaleFutures,
} from "./desk/deskLiveFlowTape.js";
import { deskStreamerSyncDeskSymbols } from "./desk/deskStreamerDeskSync.js";
import {
  streamerSubHold,
  streamerSubMaxDeskBookKeys,
  streamerSubGetChainSortSpot,
  streamerSubMaxDeskOptionKeys,
  streamerSubLowestPriorityWireDropOrder,
  streamerSubParseRejection,
  streamerSubRecordRejection,
  streamerSubResolveLiveKey,
  streamerSubInferHoldTier,
  streamerSubMergeHold,
  streamerSubNotifyAppPlanWired,
  streamerSubReplaceHold,
  streamerSubScheduleManagedOptionsBookWire,
  streamerSubScheduleManagedOptionsWire,
  streamerSubSetUnderlyingSpotResolver,
} from "./streamerSubscriptionManager.js";
import {
  addFuturesDisplay,
  clearFuturesDisplayRegistry,
  futuresDisplayRegistrySnapshot,
  getFuturesDisplaysForKey,
  registerFuturesDisplay,
} from "./futuresDisplayRegistry.js";
import {
  clearFuturesActiveSymbolCache,
  futuresRootFromContract,
  getFuturesActiveSymbolForRoot,
  resolveMonthlyFrontMonth,
  resolveQuarterlyFrontMonth,
  setFuturesActiveSymbolForRoot,
} from "./futuresFrontMonth.js";
import {
  clearClassShareDisplayRegistry,
  getClassShareDisplaysForKey,
  registerClassShareDisplayFromCaller,
} from "./classShareDisplayRegistry.js";
import { classShareSchwabStreamKey, isClassShareSymbol } from "./classShareSymbology.js";
import {
  streamerWireSimulatorApplyPayload,
  streamerWireSimulatorDeskLevelOneKeysOnWire,
  streamerWireSimulatorLiveLevelOneOptionsCount,
  streamerWireSimulatorAllLevelOneKeysOnWire,
  streamerWireSimulatorAllOptionsBookKeysOnWire,
  streamerWireSimulatorDropLevelOneByPriority,
  streamerWireSimulatorRemoveLevelOneOptions,
  streamerWireSimulatorRemoveOptionsBook,
  streamerWireSimulatorResetForTests,
} from "./streamerWireSimulator.js";
import { trimKeysFurthestFromMoney } from "./streamerSubPlanSort.js";
import {
  SCHWAB_INDEX_STREAM_FRESH_MS,
  setSchwabIndexStreamFreshCheck,
} from "./schwabIndexQuotes.js";
import { registerDeskStreamerHealthReaders } from "./desk/deskSchwabStreamerBridge.js";

export interface LiveQuote {
  symbol:       string;
  last:         number | null;   // field 3  — last trade incl. extended hours
  regularLast:  number | null;   // field 29 — regular-session last (Schwab UI "Last")
  extendedLast: number | null;
  bid:          number | null;
  ask:          number | null;
  bidSize:      number | null;
  askSize:      number | null;
  change:       number | null;
  changePct:    number | null;
  volume:       number | null;
  high:         number | null;
  low:          number | null;
  close:        number | null;   // field 12 — PREVIOUS day's close (used for change calc)
  ts:           number;
  /** Quote origin for merge policy (Cboe One vs Schwab vs IBKR PRO breadth). */
  quoteSource?: "SCHWAB" | "IBKR_CBOE_ONE" | "IBKR_PRO";
}

/** One qualifying field-8 volume sample on this stream frame (not carried across merges). */
export type OptionVolumeSample = {
  cumulativeVol: number;
  tradeTimeMs: number;
};

export interface OptionTick {
  key:          string;
  bid:          number | null;
  ask:          number | null;
  last:         number | null;
  bidSize:      number | null;
  askSize:      number | null;
  volume:       number | null;
  openInterest: number | null;
  iv:           number | null;
  delta:        number | null;
  gamma:        number | null;
  theta:        number | null;
  vega:         number | null;
  mark:         number | null;
  change:       number | null;
  lastSize:     number | null;
  underlyingPrice: number | null;
  quoteTime:    number | null;
  tradeTime:    number | null;
  /** Trade time (field 39) tied to the last accepted cumulative volume sample. */
  lastVolumeTradeTimeMs: number | null;
  /** Set only when this frame delivered a new cumulative volume sample. */
  volumeSample: OptionVolumeSample | null;
  ts:           number;
}

/** App LEVELONE_OPTIONS field list (SUBS); partial updates merge into optionCache. */
export const APP_LEVELONE_OPTIONS_FIELDS =
  "0,2,3,4,8,9,10,16,17,18,19,28,29,30,31,35,37,38,39";

function schwabFieldPresent(item: Record<string, unknown>, fieldId: string): boolean {
  return Object.prototype.hasOwnProperty.call(item, fieldId);
}

/** Merge a Schwab partial LEVELONE_OPTIONS row onto a cached tick. */
export function mergeOptionTickFromSchwab(
  existing: OptionTick | undefined,
  item: Record<string, unknown>,
  key: string,
  now: number,
): OptionTick {
  let nextVolume = existing?.volume ?? null;
  let volumeSample: OptionVolumeSample | null = null;
  let lastVolumeTradeTimeMs = existing?.lastVolumeTradeTimeMs ?? null;

  if (schwabFieldPresent(item, "8")) {
    const field8 = numOrNull(item["8"]);
    if (field8 != null && field8 >= 0 && Number.isFinite(field8)) {
      nextVolume = field8;
      const trade39 = schwabFieldPresent(item, "39") ? numOrNull(item["39"]) : null;
      const prevVol = existing?.volume;
      const prevTrade = existing?.lastVolumeTradeTimeMs;
      const increased = prevVol == null || field8 > prevVol;
      const equalResend =
        prevVol === field8 && trade39 != null && trade39 > 0 && prevTrade != null && trade39 === prevTrade;
      if (trade39 != null && trade39 > 0 && increased && !equalResend) {
        volumeSample = { cumulativeVol: field8, tradeTimeMs: trade39 };
        lastVolumeTradeTimeMs = trade39;
      } else if (prevVol === field8 && trade39 != null && trade39 > 0) {
        lastVolumeTradeTimeMs = prevTrade ?? trade39;
      }
    }
  }

  return {
    key,
    bid: numOrNull(item["2"]) ?? existing?.bid ?? null,
    ask: numOrNull(item["3"]) ?? existing?.ask ?? null,
    last: numOrNull(item["4"]) ?? existing?.last ?? null,
    bidSize: numOrNull(item["16"]) ?? existing?.bidSize ?? null,
    askSize: numOrNull(item["17"]) ?? existing?.askSize ?? null,
    volume: nextVolume,
    openInterest: numOrNull(item["9"]) ?? existing?.openInterest ?? null,
    iv: numOrNull(item["10"]) ?? existing?.iv ?? null,
    delta: numOrNull(item["28"]) ?? existing?.delta ?? null,
    gamma: numOrNull(item["29"]) ?? existing?.gamma ?? null,
    theta: numOrNull(item["30"]) ?? existing?.theta ?? null,
    vega: numOrNull(item["31"]) ?? existing?.vega ?? null,
    mark: numOrNull(item["37"]) ?? existing?.mark ?? null,
    change: numOrNull(item["19"]) ?? existing?.change ?? null,
    lastSize: numOrNull(item["18"]) ?? existing?.lastSize ?? null,
    underlyingPrice: numOrNull(item["35"]) ?? existing?.underlyingPrice ?? null,
    quoteTime: numOrNull(item["38"]) ?? existing?.quoteTime ?? null,
    tradeTime: numOrNull(item["39"]) ?? existing?.tradeTime ?? null,
    lastVolumeTradeTimeMs,
    volumeSample,
    ts: now,
  };
}

const EQ_FIELDS = "0,1,2,3,4,5,8,10,11,12,15,28,29";

function leveloneEquityFieldsUnion(): string {
  const desk = Array.from({ length: 52 }, (_, i) => String(i));
  const ids = new Set<string>([...EQ_FIELDS.split(","), ...desk]);
  return [...ids].sort((a, b) => Number(a) - Number(b)).join(",");
}

const LEVELONE_EQUITIES_FIELDS = leveloneEquityFieldsUnion();
const FUT_FIELDS = "0,1,2,3,4,5,8,12,13,14,19,24,34";
let acctActivitySubscribed = false;

const MONTH_CODES = "FGHJKMNQUVXZ";
const QUARTERLY_ROOTS = new Set([
  "ES","NQ","RTY","YM","MYM","MES","MNQ","M2K",
  "6E","6J","6B","6A","6C","EMD",
  "ZB","ZN","ZF","ZT","UB",
]);

export { addFuturesDisplay } from "./futuresDisplayRegistry.js";

const FUTURES_ROOT_ALIAS: Record<string, string> = {
  "VIX": "VX",
};

/** Schwab stream / REST full contract, e.g. `/ESZ26`. */
export const SCHWAB_FUTURES_CONTRACT_RE = /^\/[A-Z0-9]{1,4}[FGHJKMNQUVXZ]\d{2}$/;

export function isSchwabFuturesContractSymbol(displaySymbol: string): boolean {
  return SCHWAB_FUTURES_CONTRACT_RE.test(displaySymbol.toUpperCase().trim());
}

export function schwabFuturesKey(displaySymbol: string): string {
  const upper = displaySymbol.toUpperCase().trim();
  if (isSchwabFuturesContractSymbol(upper)) {
    return upper;
  }
  const rawBare = upper.replace(/^\//, "");
  const bare = FUTURES_ROOT_ALIAS[rawBare] ?? rawBare;
  const now = new Date();
  const active =
    getFuturesActiveSymbolForRoot(upper) ??
    getFuturesActiveSymbolForRoot(`/${bare}`) ??
    getFuturesActiveSymbolForRoot(`/${rawBare}`);
  if (active) return active;

  if (QUARTERLY_ROOTS.has(bare)) {
    return resolveQuarterlyFrontMonth(bare, [2, 5, 8, 11], now);
  }
  return resolveMonthlyFrontMonth(bare, now);
}

const alertSeenSet = new Map<string, number>();
const ALERT_DEDUP_TTL_MS = 60_000;
let alertSeenSweepTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const cutoff = Date.now() - ALERT_DEDUP_TTL_MS;
  for (const [k, ts] of alertSeenSet) {
    if (ts < cutoff) alertSeenSet.delete(k);
  }
}, ALERT_DEDUP_TTL_MS);

export function markAlertSeen(orderId: string, eventType: string): void {
  const key = `${orderId}:${eventType}`;
  alertSeenSet.set(key, Date.now());
}

function isAlertSeen(orderId: string | null, eventType: string | null): boolean {
  if (!orderId || !eventType) return false;
  return alertSeenSet.has(`${orderId}:${eventType}`);
}

const quoteCache = new Map<string, LiveQuote>();
const optionCache = new Map<string, OptionTick>();
const sseClients = new Set<Response>();

const SCHWAB_INDEX_NORM: Record<string, string> = {
  "SPX": "$SPX", "VIX": "$VIX", "NDX": "$NDX", "RUT": "$RUT",
  "DJI": "$DJI", "DJIA": "$DJI", "COMP": "$COMP", "DXY": "$DXY",
  "TNX": "$TNX", "TYX": "$TYX", "VXN": "$VXN", "OEX": "$OEX",
  "MNX": "$MNX", "XSP": "$XSP", "TICK": "$TICK", "TRIN": "$TRIN",
  "ADD": "$ADD", "ADVN": "$ADVN", "DECN": "$DECN", "VVIX": "$VVIX",
  "VIX9D": "$VIX9D", "VIX3M": "$VIX3M", "RVX": "$RVX", "VXD": "$VXD",
  "UVOL": "$UVOL", "DVOL": "$DVOL", "UVOLQ": "$UVOLQ", "DVOLQ": "$DVOLQ",
  "ADDQ": "$ADDQ", "ADVNQ": "$ADVNQ", "DECNQ": "$DECNQ",
  "TRINQ": "$TRINQ", "TICKI": "$TICKI",
};

export function normalizeEquityKey(sym: string): string {
  const upper = sym.toUpperCase();
  return SCHWAB_INDEX_NORM[upper] ?? upper;
}

export function equityStreamKeyFromCaller(callerOrWire: string): string {
  const upper = callerOrWire.toUpperCase().trim();
  const indexed = normalizeEquityKey(upper);
  if (isClassShareSymbol(indexed)) return classShareSchwabStreamKey(indexed);
  return indexed;
}

function prepareEquitySubscribeFromCaller(callerSymbol: string): string {
  const upper = callerSymbol.toUpperCase().trim();
  registerClassShareDisplayFromCaller(upper);
  return equityStreamKeyFromCaller(upper);
}

function numOrNull(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

let wsBroadcast: ((event: string, data: unknown) => void) | null = null;
let schwabWs: WebSocket | null = null;
let streamerInfo: StreamerInfo | null = null;
let subscribedSymbols = new Set<string>();
let subscribedFuturesSymbols = new Set<string>();
let subscribedOptionSymbols = new Set<string>();
/** Option underlyings subscribed for the active tuning watchlist (removed when watchlist changes). */
const tuningWatchlistOptionRoots = new Set<string>();
let subscribedFuturesOptionSymbols = new Set<string>();
let subscribedTimesaleEquitySymbols = new Set<string>();
let subscribedChartEquitySymbols = new Set<string>();
let subscribedNyseBookSymbols = new Set<string>();
let subscribedNasdaqBookSymbols = new Set<string>();
let subscribedOptionsBookSymbols = new Set<string>();

/** Desk tape universe — ADD-only keys (never merged into SUBS replacement sets). */
const deskAddedEquitySymbols = new Set<string>();
const deskAddedOptionSymbols = new Set<string>();
const deskAddedOptionsBookSymbols = new Set<string>();
const deskAddedTimesaleOptionSymbols = new Set<string>();
/** Desk wire key ownership (tape universe vs live-flow SSE); refcounts per key. */
type DeskWireOwner = "tape_universe" | "live_flow";
const deskEquityL1Owners = new Map<string, Set<DeskWireOwner>>();
const deskTimesaleEquityOwners = new Map<string, Set<DeskWireOwner>>();
const deskFuturesL1WireOwners = new Map<string, Set<DeskWireOwner>>();
const deskTimesaleFuturesWireOwners = new Map<string, Set<DeskWireOwner>>();

function deskOwnerHold(map: Map<string, Set<DeskWireOwner>>, key: string, owner: DeskWireOwner): boolean {
  let s = map.get(key);
  if (!s) {
    s = new Set();
    map.set(key, s);
  }
  const first = s.size === 0;
  s.add(owner);
  return first;
}

function deskOwnerRelease(map: Map<string, Set<DeskWireOwner>>, key: string, owner: DeskWireOwner): boolean {
  const s = map.get(key);
  if (!s?.has(owner)) return false;
  s.delete(owner);
  if (s.size === 0) {
    map.delete(key);
    return true;
  }
  return false;
}

export function deskStreamerReplayDeskFlowAdds(): void {
  if (connectionState !== "connected") return;
  const fut = [...deskFuturesL1WireOwners.keys()].filter((k) => !subscribedFuturesSymbols.has(k));
  if (fut.length > 0) batchDeskAdd(sendDeskFuturesAdd, fut);
  const tse = [...deskTimesaleEquityOwners.keys()].filter((k) => !subscribedTimesaleEquitySymbols.has(k));
  if (tse.length > 0) sendDeskTimesaleEquityAdd(tse);
  const tsf = [...deskTimesaleFuturesWireOwners.keys()];
  if (tsf.length > 0) sendDeskTimesaleFuturesAdd(tsf);
}

type TimesaleFuturesListener = (ev: SchwabTimesaleEquityEvent & { displaySymbol: string }) => void;
const timesaleFuturesListeners = new Set<TimesaleFuturesListener>();
const DESK_EQ_FIELDS = Array.from({ length: 52 }, (_, i) => i).join(",");
const DESK_OPT_FIELDS = Array.from({ length: 56 }, (_, i) => i).join(",");
const DESK_ADD_BATCH = 500;

export function getAppLevelOneOptionsCount(): number {
  return subscribedOptionSymbols.size;
}

export function getAppLevelOneOptionSymbols(): string[] {
  return [...subscribedOptionSymbols].sort();
}

export function getAppOptionsBookCount(): number {
  return subscribedOptionsBookSymbols.size;
}

export function getAppLevelOneEquitiesCount(): number {
  return subscribedSymbols.size;
}

/** Level 2 book — field IDs align with schwab-py `BookFields` (SYMBOL, BOOK_TIME, BIDS, ASKS). */
const NYSE_NASDAQ_OPTIONS_BOOK_FIELDS = "0,1,2,3";

/**
 * Equity time & sale — numeric field IDs per Schwab Trader API Streamer Guide (legacy TD streaming lineage).
 * See also schwab-py / official Schwab developer streaming documentation.
 */
const TIMESALE_EQUITY_FIELDS = "0,1,2,3,4";
/**
 * CHART_EQUITY — Schwab Streamer Guide / schwab-py ChartEquityFields:
 * 0 symbol, 1 sequence, 2 open, 3 high, 4 low, 5 close, 6 volume, 7 chart time (epoch ms), 8 chart day.
 */
const CHART_EQUITY_FIELDS = "0,1,2,3,4,5,6,7,8";

export interface SchwabTimesaleEquityEvent {
  symbol: string;
  lastPrice: number | null;
  lastSize: number | null;
  tradeTimeMs: number | null;
  sequence: number | null;
  raw: Record<string, unknown>;
}

export interface SchwabBookLevel2Event {
  symbol: string;
  bookTimeMs: number | null;
  bids: unknown;
  asks: unknown;
  raw: Record<string, unknown>;
}

type TimesaleListener = (ev: SchwabTimesaleEquityEvent) => void;
type BookListener = (ev: SchwabBookLevel2Event) => void;

const timesaleEquityListeners = new Set<TimesaleListener>();
const nyseBookListeners = new Set<BookListener>();
const nasdaqBookListeners = new Set<BookListener>();
const optionsBookListeners = new Set<BookListener>();

/** Rolling TIMESALE_EQUITY prints per symbol (strategist VWAP / block tape). */
export interface SchwabTimesaleStrategistPoint {
  ts: number;
  price: number;
  size: number;
}

interface StrategistTimesaleRingBuf {
  buf: SchwabTimesaleStrategistPoint[];
  head: number;
  size: number;
}

const strategistTimesaleRing = new Map<string, StrategistTimesaleRingBuf>();
const STRATEGIST_TIMESALE_MAX_POINTS_PER_SYMBOL = 120_000;
const STRATEGIST_TIMESALE_MAX_AGE_MS = 10 * 60 * 60 * 1000;

function appendStrategistTimesale(sym: string, pt: SchwabTimesaleStrategistPoint): void {
  const u = sym.toUpperCase();
  const cap = STRATEGIST_TIMESALE_MAX_POINTS_PER_SYMBOL;
  let r = strategistTimesaleRing.get(u);
  if (!r) {
    r = { buf: new Array<SchwabTimesaleStrategistPoint>(cap), head: 0, size: 0 };
    strategistTimesaleRing.set(u, r);
  }
  if (r.size === cap) {
    r.head = (r.head + 1) % cap;
    r.size--;
  }
  r.buf[(r.head + r.size) % cap] = pt;
  r.size++;
  const cutoffAge = Date.now() - STRATEGIST_TIMESALE_MAX_AGE_MS;
  while (r.size > 0 && r.buf[r.head]!.ts < cutoffAge) {
    r.head = (r.head + 1) % cap;
    r.size--;
  }
}

export function getStrategistTimesalePoints(symbol: string): SchwabTimesaleStrategistPoint[] {
  const r = strategistTimesaleRing.get(symbol.toUpperCase());
  if (!r || r.size === 0) return [];
  const cap = STRATEGIST_TIMESALE_MAX_POINTS_PER_SYMBOL;
  const out: SchwabTimesaleStrategistPoint[] = [];
  for (let i = 0; i < r.size; i++) {
    out.push(r.buf[(r.head + i) % cap]!);
  }
  return out;
}

/** CHART_EQUITY (1-minute aggregate): OHLCV per bar for strategist VWAP / RSI fallbacks. */
export interface SchwabChartEquityBarPoint {
  chartTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategistChartEquityBuf {
  /** Sorted ascending by chartTimeMs; deduped per chart bar key. */
  bars: SchwabChartEquityBarPoint[];
}

const strategistChartEquityRing = new Map<string, StrategistChartEquityBuf>();
const STRATEGIST_CHART_MAX_BARS_PER_SYMBOL = 8_000;

/** Debounced persist so CHART_EQUITY throughput stays smooth on live streams. */
const CHART_BAR_PERSIST_DEBOUNCE_MS = 250;
const chartBarPersistPending = new Map<
  string,
  {
    symbol: string;
    barTimeMs: number;
    high: string;
    low: string;
    close: string;
    volume: string;
    sessionDate: string;
  }
>();
let chartBarPersistFlushTimer: ReturnType<typeof setTimeout> | null = null;

function nySessionDateYmdFromBarMs(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function queuePersistSchwabChartBar(symbolUpper: string, bar: SchwabChartEquityBarPoint): void {
  const key = `${symbolUpper}:${bar.chartTimeMs}`;
  chartBarPersistPending.set(key, {
    symbol: symbolUpper,
    barTimeMs: bar.chartTimeMs,
    high: String(bar.high),
    low: String(bar.low),
    close: String(bar.close),
    volume: String(bar.volume),
    sessionDate: nySessionDateYmdFromBarMs(bar.chartTimeMs),
  });
  scheduleFlushSchwabChartBarPersist();
}

function scheduleFlushSchwabChartBarPersist(): void {
  if (chartBarPersistFlushTimer != null) return;
  chartBarPersistFlushTimer = setTimeout(() => {
    chartBarPersistFlushTimer = null;
    void flushSchwabChartBarPersistBatch();
  }, CHART_BAR_PERSIST_DEBOUNCE_MS);
}

async function flushSchwabChartBarPersistBatch(): Promise<void> {
  if (chartBarPersistPending.size === 0) return;
  const rows = [...chartBarPersistPending.values()];
  chartBarPersistPending.clear();
  const chunkSize = 250;
  try {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).map((r) => ({
        symbol: r.symbol,
        barTimeMs: r.barTimeMs,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        sessionDate: r.sessionDate,
      }));
      await db
        .insert(schwabChartEquityBarsTable)
        .values(chunk)
        .onConflictDoUpdate({
          target: [schwabChartEquityBarsTable.symbol, schwabChartEquityBarsTable.barTimeMs],
          set: {
            close: sql`excluded.close`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            volume: sql`excluded.volume`,
            sessionDate: sql`excluded.session_date`,
            insertedAt: sql`now()`,
          },
        });
    }
  } catch (err) {
    logger.warn({ err, batchRows: rows.length }, "Schwab streamer: CHART_EQUITY persist batch failed");
  }
}

function normalizeChartTimeMs(raw: number): number {
  if (!Number.isFinite(raw)) return NaN;
  /* TD/Schwab lineage sometimes sends seconds since epoch for chart time. */
  return raw > 1e12 ? raw : raw * 1000;
}

function appendStrategistChartEquity(sym: string, bar: SchwabChartEquityBarPoint): void {
  const u = sym.toUpperCase();
  let buf = strategistChartEquityRing.get(u);
  if (!buf) {
    buf = { bars: [] };
    strategistChartEquityRing.set(u, buf);
  }
  const arr = buf.bars;
  const idx = arr.findIndex((b) => b.chartTimeMs === bar.chartTimeMs);
  if (idx >= 0) {
    arr[idx] = bar;
    queuePersistSchwabChartBar(u, bar);
    return;
  }
  arr.push(bar);
  arr.sort((a, b) => a.chartTimeMs - b.chartTimeMs);
  const cap = STRATEGIST_CHART_MAX_BARS_PER_SYMBOL;
  if (arr.length > cap) {
    arr.splice(0, arr.length - cap);
  }
  queuePersistSchwabChartBar(u, bar);
}

/** Minute OHLCV bars from Schwab CHART_EQUITY stream cache (ascending). */
export function getStrategistChartEquityBars(symbol: string): SchwabChartEquityBarPoint[] {
  const buf = strategistChartEquityRing.get(symbol.toUpperCase());
  return buf ? [...buf.bars] : [];
}

/** Chronological closes for diagnostics / RSI helpers. */
export function getStrategistChartEquityCloses(symbol: string): Array<{ ts: number; close: number }> {
  return getStrategistChartEquityBars(symbol).map((b) => ({ ts: b.chartTimeMs, close: b.close }));
}

export interface SchwabVenueBookStrategistSnapshot {
  rawBids: unknown;
  rawAsks: unknown;
  bookTimeMs: number | null;
  recvTs: number;
}

const nyseBookStrategistCache = new Map<string, SchwabVenueBookStrategistSnapshot>();
const nasdaqBookStrategistCache = new Map<string, SchwabVenueBookStrategistSnapshot>();

export function getSchwabVenueBookStrategistSnapshot(
  symbol: string,
  venue: "NYSE" | "NASDAQ",
): SchwabVenueBookStrategistSnapshot | undefined {
  const u = symbol.toUpperCase();
  return venue === "NYSE" ? nyseBookStrategistCache.get(u) : nasdaqBookStrategistCache.get(u);
}

/** Extract price/size rows from Schwab book payload (nested arrays or objects). */
export function extractSchwabBookRows(side: unknown): Array<{ price: number; size: number }> {
  const out: Array<{ price: number; size: number }> = [];
  function walk(x: unknown): void {
    if (x == null) return;
    if (Array.isArray(x)) {
      if (
        x.length >= 2 &&
        (typeof x[0] === "number" || typeof x[0] === "string") &&
        (typeof x[1] === "number" || typeof x[1] === "string")
      ) {
        const price = Number(x[0]);
        const size = Number(x[1]);
        if (Number.isFinite(price) && Number.isFinite(size) && size >= 0) {
          out.push({ price, size });
        }
        return;
      }
      for (const el of x) walk(el);
      return;
    }
    if (typeof x === "object") {
      const o = x as Record<string, unknown>;
      const pRaw = o["price"] ?? o["Price"] ?? o["0"];
      const sRaw = o["size"] ?? o["Size"] ?? o["count"] ?? o["volume"] ?? o["1"];
      const price = numOrNull(pRaw);
      const size = numOrNull(sRaw);
      if (price !== null && size !== null && size >= 0) {
        out.push({ price, size });
      }
      for (const v of Object.values(o)) walk(v);
    }
  }
  walk(side);
  return out;
}

export interface SchwabParsedBookMetrics {
  topOfBookBidSize: number | null;
  topOfBookAskSize: number | null;
  bookImbalancePct: number | null;
  depthWithin1pctBid: number | null;
  depthWithin1pctAsk: number | null;
}

export function computeSchwabBookMetrics(bids: unknown, asks: unknown): SchwabParsedBookMetrics {
  const bidRows = extractSchwabBookRows(bids).filter((r) => r.price > 0 && r.size > 0);
  const askRows = extractSchwabBookRows(asks).filter((r) => r.price > 0 && r.size > 0);
  bidRows.sort((a, b) => b.price - a.price);
  askRows.sort((a, b) => a.price - b.price);
  const bestBid = bidRows[0];
  const bestAsk = askRows[0];
  const topBidSz = bestBid?.size ?? null;
  const topAskSz = bestAsk?.size ?? null;
  let bookImbalancePct: number | null = null;
  if (topBidSz != null && topAskSz != null && topBidSz + topAskSz > 0) {
    bookImbalancePct = Math.round(((topBidSz - topAskSz) / (topBidSz + topAskSz)) * 10_000) / 100;
  }
  let mid: number | null = null;
  if (bestBid && bestAsk) mid = (bestBid.price + bestAsk.price) / 2;
  let depthWithin1pctBid: number | null = null;
  let depthWithin1pctAsk: number | null = null;
  if (mid != null && mid > 0) {
    const lo = mid * 0.99;
    const hi = mid * 1.01;
    depthWithin1pctBid = bidRows.filter((r) => r.price >= lo && r.price <= mid).reduce((s, r) => s + r.size, 0);
    depthWithin1pctAsk = askRows.filter((r) => r.price <= hi && r.price >= mid).reduce((s, r) => s + r.size, 0);
    if (depthWithin1pctBid === 0) depthWithin1pctBid = null;
    if (depthWithin1pctAsk === 0) depthWithin1pctAsk = null;
  }
  return {
    topOfBookBidSize: topBidSz,
    topOfBookAskSize: topAskSz,
    bookImbalancePct,
    depthWithin1pctBid,
    depthWithin1pctAsk,
  };
}

export function getSchwabStreamEquityQuoteFresh(symbol: string, maxAgeMs: number): LiveQuote | null {
  const q = quoteCache.get(symbol.toUpperCase());
  if (!q) return null;
  const age = Date.now() - q.ts;
  if (age > maxAgeMs) return null;
  return q;
}

export function subscribeSchwabTimesaleEquityEvents(listener: TimesaleListener): () => void {
  timesaleEquityListeners.add(listener);
  return () => timesaleEquityListeners.delete(listener);
}

export function subscribeSchwabNyseBookEvents(listener: BookListener): () => void {
  nyseBookListeners.add(listener);
  return () => nyseBookListeners.delete(listener);
}

export function subscribeSchwabNasdaqBookEvents(listener: BookListener): () => void {
  nasdaqBookListeners.add(listener);
  return () => nasdaqBookListeners.delete(listener);
}

export function subscribeSchwabOptionsBookEvents(listener: BookListener): () => void {
  optionsBookListeners.add(listener);
  return () => optionsBookListeners.delete(listener);
}
let requestCounter = 0;

type StreamerWireTap = (payload: unknown) => void;
let streamerWireTap: StreamerWireTap | null = null;

/** Vitest-only: capture outbound streamer JSON before WebSocket send. */
export function __deskStreamerSetWireTap(tap: StreamerWireTap | null): void {
  streamerWireTap = tap;
}

function sendStreamerJson(payload: unknown): void {
  streamerWireSimulatorApplyPayload(payload);
  streamerWireTap?.(payload);
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN) return;
  const raw = JSON.stringify(payload);
  onSchwabOutboundFrame(raw);
  schwabWs.send(raw);
}
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 60_000;
let connectionState: "disconnected" | "connecting" | "connected" = "disconnected";
let loginRetried = false;
let lastConnectedAt: number | null = null;
let disconnectedAt: number | null = null;
let fiveMinCriticalSent = false;
let acctActivitySubTimeout: ReturnType<typeof setTimeout> | null = null;

// ── Reconnect resilience (fixes 1006 loop) ────────────────────────────
// The Schwab streamer frequently drops with WS code 1006 ("abnormal close,
// no close frame") due to NAT idle timeouts, TCP resets, or the server
// closing after a stale token during LOGIN. The original code had no
// keepalive, no connect/login timeouts, and only reset backoff on LOGIN
// success — so a 1006 during CONNECT produced unbounded backoff growth
// (capped at 60s) and never triggered a token refresh. These state vars
// + timers close those gaps. A separate counter covers LOGIN-then-immediate
// 1006 (duplicate session / credential issues) which pre-login 1006 logic
// never saw because WASCONNECTED was true.
const CONNECT_TIMEOUT_MS = 15_000;      // time to complete WS handshake
const LOGIN_RESPONSE_TIMEOUT_MS = 10_000; // time for LOGIN reply after open
const PING_INTERVAL_MS = 20_000;        // client-initiated ping cadence
const PONG_TIMEOUT_MS = 45_000;         // no pong → force-close
const ABNORMAL_CLOSE_REFRESH_THRESHOLD = 3; // 1006-before-login count → force token refresh
/** Post-LOGIN 1006 with session shorter than this is treated as a "flap" (server RST, duplicate session, etc.). */
const SHORT_LIVED_SESSION_ABNORMAL_MS = 5_000;
let connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let loginTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let pingIntervalTimer: ReturnType<typeof setInterval> | null = null;
let pongWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveAbnormalCloses = 0;
/** Counts rapid 1006 after successful LOGIN; same threshold triggers token refresh as pre-login 1006 streak. */
let consecutivePostLoginFlap1006 = 0;
let consecutiveLoginFailures = 0;     // tracks LOGIN-after-TCP-open failures
let forceTokenRefreshOnNextConnect = false;
let connectAttemptStartedAt: number | null = null; // when current handshake began (age-gates CONNECTING termination)

function clearLifecycleTimers(): void {
  if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }
  if (loginTimeoutTimer) { clearTimeout(loginTimeoutTimer); loginTimeoutTimer = null; }
  if (pingIntervalTimer) { clearInterval(pingIntervalTimer); pingIntervalTimer = null; }
  if (pongWatchdogTimer) { clearTimeout(pongWatchdogTimer); pongWatchdogTimer = null; }
}

interface StreamerInfo {
  streamerSocketUrl: string;
  schwabClientCustomerId: string;
  schwabClientCorrelId: string;
  schwabClientChannel: string;
  schwabClientFunctionId: string;
}

export function registerWsBroadcast(fn: (event: string, data: unknown) => void) {
  wsBroadcast = fn;
}

function sseWrite(res: Response, event: string, data: unknown) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

function broadcast(event: string, data: unknown) {
  for (const res of sseClients) {
    sseWrite(res, event, data);
  }
  if (wsBroadcast) {
    wsBroadcast(event, data);
  }
}

export function injectExternalQuote(sym: string, quote: LiveQuote) {
  quoteCache.set(sym, quote);
  broadcast("quote", quote);
}

function quoteSourceRank(source: LiveQuote["quoteSource"]): number {
  if (source === "IBKR_CBOE_ONE") return 3;
  if (source === "IBKR_PRO") return 2;
  if (source === "SCHWAB") return 1;
  return 1;
}

/**
 * Merges IBKR Cboe One BBO into the shared equity quote cache.
 * Policy: newer `ts` wins; on equal `ts`, priority is IBKR_CBOE_ONE > IBKR_PRO > Schwab (undefined treated as Schwab).
 */
export function injectCboeOneConsolidatedQuote(sym: string, quote: LiveQuote): void {
  const upper = sym.toUpperCase();
  const incoming = { ...quote, symbol: upper, quoteSource: "IBKR_CBOE_ONE" as const };
  const existing = quoteCache.get(upper);
  if (!existing) {
    quoteCache.set(upper, incoming);
    broadcast("quote", incoming);
    return;
  }
  const incTs = incoming.ts;
  const exTs = existing.ts;
  if (incTs > exTs) {
    quoteCache.set(upper, incoming);
    broadcast("quote", incoming);
    return;
  }
  if (incTs < exTs) return;
  if (quoteSourceRank(incoming.quoteSource) >= quoteSourceRank(existing.quoteSource)) {
    quoteCache.set(upper, incoming);
    broadcast("quote", incoming);
  }
}

export function addSseClient(res: Response): () => void {
  sseClients.add(res);
  logger.info({ total: sseClients.size }, "SSE client connected");

  sseWrite(res, "streamerStatus", { status: getStreamerStatus() });
  for (const quote of quoteCache.values()) {
    sseWrite(res, "quote", quote);
  }
  for (const tick of optionCache.values()) {
    sseWrite(res, "optionQuote", tick);
  }
  sseWrite(res, "heartbeat", { ts: Date.now() });

  return () => {
    sseClients.delete(res);
    logger.info({ total: sseClients.size }, "SSE client disconnected");
  };
}

export function getSnapshot(): LiveQuote[] {
  return [...quoteCache.values()];
}

export function getQuoteBySymbol(symbol: string): LiveQuote | undefined {
  const upper = symbol.toUpperCase().trim();
  const direct = quoteCache.get(upper);
  if (direct) return direct;
  if (isClassShareSymbol(upper)) {
    const streamKey = classShareSchwabStreamKey(upper);
    const viaStream = quoteCache.get(streamKey);
    if (viaStream) return { ...viaStream, symbol: upper };
    for (const d of getClassShareDisplaysForKey(streamKey)) {
      const cached = quoteCache.get(d);
      if (cached) return { ...cached, symbol: upper };
    }
  }
  if (!upper.startsWith("/")) return undefined;
  if (isSchwabFuturesContractSymbol(upper)) {
    const mapped = getFuturesDisplaysForKey(upper);
    for (const d of mapped) {
      const q = quoteCache.get(d);
      if (q) return q;
    }
    return quoteCache.get(upper);
  }
  const directRoot = quoteCache.get(upper);
  if (directRoot) return directRoot;
  const contract = schwabFuturesKey(upper);
  if (contract !== upper) {
    const viaContract = quoteCache.get(contract);
    if (viaContract) return viaContract;
  }
  for (const d of getFuturesDisplaysForKey(contract)) {
    if (d === upper) return quoteCache.get(d);
  }
  return undefined;
}

export function getOptionTick(key: string): OptionTick | undefined {
  return optionCache.get(key);
}

export function getAllOptionTicks(): Map<string, OptionTick> {
  return optionCache;
}

export function getSchwabCacheDiagnostics(): {
  equityCacheKeys: string[];
  futuresCacheKeys: string[];
  subscribedEquities: string[];
  subscribedFutures: string[];
  futuresKeyMap: Record<string, string>;
  totalCacheEntries: number;
  entriesWithLast: number;
  connectionState: string;
} {
  const equityCacheKeys: string[] = [];
  const futuresCacheKeys: string[] = [];
  let entriesWithLast = 0;
  for (const [key, q] of quoteCache.entries()) {
    if (key.startsWith("/")) {
      futuresCacheKeys.push(key);
    } else {
      equityCacheKeys.push(key);
    }
    if (q.last !== null) entriesWithLast++;
  }
  const fkMap: Record<string, string> = {};
  const snap = futuresDisplayRegistrySnapshot();
  for (const [k, displays] of Object.entries(snap)) {
    fkMap[k] = displays.join(",");
  }
  return {
    equityCacheKeys: equityCacheKeys.sort(),
    futuresCacheKeys: futuresCacheKeys.sort(),
    subscribedEquities: [...subscribedSymbols].sort(),
    subscribedFutures: [...subscribedFuturesSymbols].sort(),
    futuresKeyMap: fkMap,
    totalCacheEntries: quoteCache.size,
    entriesWithLast,
    connectionState,
  };
}

export function getStreamerStatus(): string {
  return connectionState === "connected" ? "connected" : connectionState === "connecting" ? "connecting" : "disconnected";
}

export function isConnected(): boolean {
  return connectionState === "connected";
}

async function fetchStreamerInfo(): Promise<StreamerInfo | null> {
  const token = getValidAccessToken("trader");
  if (!token) {
    logger.warn("Schwab streamer: no valid access token for userPreference");
    return null;
  }

  try {
    const res = await fetch("https://api.schwabapi.com/trader/v1/userPreference", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body: body.slice(0, 300) }, "Schwab streamer: userPreference request failed");
      return null;
    }

    const data = await res.json() as { streamerInfo?: StreamerInfo[] };
    if (!data.streamerInfo?.length) {
      logger.error("Schwab streamer: no streamerInfo in userPreference response");
      return null;
    }

    return data.streamerInfo[0];
  } catch (err) {
    logger.error({ err }, "Schwab streamer: failed to fetch userPreference");
    return null;
  }
}

function buildRequest(service: string, command: string, parameters: Record<string, string>) {
  if (!streamerInfo) return null;
  return {
    service,
    command,
    requestid: String(requestCounter++),
    SchwabClientCustomerId: streamerInfo.schwabClientCustomerId,
    SchwabClientCorrelId: streamerInfo.schwabClientCorrelId,
    parameters,
  };
}

function sendLogin() {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo) return;

  const token = getValidAccessToken("trader");
  if (!token) {
    logger.error("Schwab streamer: no valid token for LOGIN");
    return;
  }

  const loginReq = buildRequest("ADMIN", "LOGIN", {
    Authorization: token,
    SchwabClientChannel: streamerInfo.schwabClientChannel,
    SchwabClientFunctionId: streamerInfo.schwabClientFunctionId,
  });

  if (loginReq) {
    sendStreamerJson({ requests: [loginReq] });
    logger.info("Schwab streamer: LOGIN sent");
  }
}

function sendEquitySubscription(symbols: string[], opts?: { replayDeskEquities?: boolean }) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("LEVELONE_EQUITIES", "SUBS", {
    keys: symbols.join(","),
    fields: LEVELONE_EQUITIES_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info(
      { count: symbols.length, sample: symbols.slice(0, 5).join(","), fields: LEVELONE_EQUITIES_FIELDS },
      "Schwab streamer: LEVELONE_EQUITIES SUBS sent",
    );
    if (opts?.replayDeskEquities !== false && deskAddedEquitySymbols.size > 0) {
      const deskOnly = [...deskAddedEquitySymbols].filter((k) => !subscribedSymbols.has(k));
      if (deskOnly.length > 0) batchDeskAdd(sendDeskEquityAdd, deskOnly);
    }
    deskStreamerReplayDeskFlowAdds();
  }
}

function sendFuturesSubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("LEVELONE_FUTURES", "SUBS", {
    keys: symbols.join(","),
    fields: FUT_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: LEVELONE_FUTURES SUBS sent");
    deskStreamerReplayDeskFlowAdds();
  }
}

function sendLevelOneOptionsUnsubs(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("LEVELONE_OPTIONS", "UNSUBS", {
    keys: symbols.join(","),
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: LEVELONE_OPTIONS UNSUBS (app)");
  }
}

function sendOptionSubscription(symbols: string[], opts?: { replayDesk?: boolean }) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo) return;

  if (!symbols.length) return;

  const req = buildRequest("LEVELONE_OPTIONS", "SUBS", {
    keys: symbols.join(","),
    fields: APP_LEVELONE_OPTIONS_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: LEVELONE_OPTIONS SUBS sent");
    if (opts?.replayDesk === true) {
      deskStreamerReplayDeskOptionAdds();
    }
  }
}

function sendFuturesOptionSubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("LEVELONE_FUTURES_OPTIONS", "SUBS", {
    keys: symbols.join(","),
    fields: APP_LEVELONE_OPTIONS_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: LEVELONE_FUTURES_OPTIONS SUBS sent");
  }
}

function sendTimesaleEquitySubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("TIMESALE_EQUITY", "SUBS", {
    keys: symbols.join(","),
    fields: TIMESALE_EQUITY_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: TIMESALE_EQUITY SUBS sent");
    deskStreamerReplayDeskFlowAdds();
  }
}

function sendChartEquitySubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("CHART_EQUITY", "SUBS", {
    keys: symbols.join(","),
    fields: CHART_EQUITY_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: CHART_EQUITY SUBS sent");
  }
}

function sendNyseBookSubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("NYSE_BOOK", "SUBS", {
    keys: symbols.join(","),
    fields: NYSE_NASDAQ_OPTIONS_BOOK_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: NYSE_BOOK SUBS sent");
  }
}

function sendNasdaqBookSubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("NASDAQ_BOOK", "SUBS", {
    keys: symbols.join(","),
    fields: NYSE_NASDAQ_OPTIONS_BOOK_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: NASDAQ_BOOK SUBS sent");
  }
}

function sendOptionsBookUnsubs(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("OPTIONS_BOOK", "UNSUBS", { keys: symbols.join(",") });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: OPTIONS_BOOK UNSUBS (app)");
  }
}

function sendOptionsBookSubscription(symbols: string[], opts?: { replayDesk?: boolean }) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo) return;
  if (!symbols.length) return;

  const req = buildRequest("OPTIONS_BOOK", "SUBS", {
    keys: symbols.join(","),
    fields: NYSE_NASDAQ_OPTIONS_BOOK_FIELDS,
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: OPTIONS_BOOK SUBS sent");
    if (opts?.replayDesk === true) {
      deskStreamerReplayDeskOptionsBookAdds();
    }
  }
}

function sendDeskEquityAdd(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("LEVELONE_EQUITIES", "ADD", {
    keys: symbols.join(","),
    fields: DESK_EQ_FIELDS,
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: desk LEVELONE_EQUITIES ADD");
  }
}

function sendDeskEquityUnsubs(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("LEVELONE_EQUITIES", "UNSUBS", {
    keys: symbols.join(","),
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: desk LEVELONE_EQUITIES UNSUBS");
  }
}

function sendDeskTimesaleEquityAdd(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("TIMESALE_EQUITY", "ADD", {
    keys: symbols.join(","),
    fields: TIMESALE_EQUITY_FIELDS,
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 3) }, "Schwab streamer: desk TIMESALE_EQUITY ADD");
  }
}

function sendDeskTimesaleEquityUnsubs(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("TIMESALE_EQUITY", "UNSUBS", {
    keys: symbols.join(","),
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: desk TIMESALE_EQUITY UNSUBS");
  }
}

function sendDeskFuturesAdd(wireKeys: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !wireKeys.length) return;
  const req = buildRequest("LEVELONE_FUTURES", "ADD", {
    keys: wireKeys.join(","),
    fields: FUT_FIELDS,
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: wireKeys.length, sample: wireKeys.slice(0, 3) }, "Schwab streamer: desk LEVELONE_FUTURES ADD");
  }
}

function sendDeskFuturesUnsubs(wireKeys: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !wireKeys.length) return;
  const req = buildRequest("LEVELONE_FUTURES", "UNSUBS", {
    keys: wireKeys.join(","),
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: wireKeys.length }, "Schwab streamer: desk LEVELONE_FUTURES UNSUBS");
  }
}

function sendDeskTimesaleFuturesAdd(wireKeys: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !wireKeys.length) return;
  const req = buildRequest("TIMESALE_FUTURES", "ADD", {
    keys: wireKeys.join(","),
    fields: TIMESALE_EQUITY_FIELDS,
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: wireKeys.length, sample: wireKeys.slice(0, 3) }, "Schwab streamer: desk TIMESALE_FUTURES ADD");
  }
}

function sendDeskTimesaleFuturesUnsubs(wireKeys: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !wireKeys.length) return;
  const req = buildRequest("TIMESALE_FUTURES", "UNSUBS", {
    keys: wireKeys.join(","),
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: wireKeys.length }, "Schwab streamer: desk TIMESALE_FUTURES UNSUBS");
  }
}

/** Returns true when this module performed the ADD (caller should release). */
export function deskFlowStreamerEnsureEquityL1(sym: string): boolean {
  const wire = prepareEquitySubscribeFromCaller(sym);
  const appHas = subscribedSymbols.has(wire);
  const first = deskOwnerHold(deskEquityL1Owners, wire, "live_flow");
  if (first && !appHas) {
    if (!deskAddedEquitySymbols.has(wire)) {
      deskAddedEquitySymbols.add(wire);
      if (connectionState === "connected") batchDeskAdd(sendDeskEquityAdd, [wire]);
    }
    return true;
  }
  return false;
}

export function deskFlowStreamerReleaseEquityL1(sym: string): void {
  const wire = equityStreamKeyFromCaller(sym);
  const last = deskOwnerRelease(deskEquityL1Owners, wire, "live_flow");
  if (!last || deskEquityL1Owners.has(wire)) return;
  deskAddedEquitySymbols.delete(wire);
  if (!subscribedSymbols.has(wire) && connectionState === "connected") {
    sendDeskEquityUnsubs([wire]);
  }
}

export function deskFlowStreamerEnsureTimesaleEquity(sym: string): boolean {
  const wire = prepareEquitySubscribeFromCaller(sym);
  const appHas = subscribedTimesaleEquitySymbols.has(wire);
  const first = deskOwnerHold(deskTimesaleEquityOwners, wire, "live_flow");
  if (first && !appHas && connectionState === "connected") {
    sendDeskTimesaleEquityAdd([wire]);
    return true;
  }
  return false;
}

export function deskFlowStreamerReleaseTimesaleEquity(sym: string): void {
  const wire = equityStreamKeyFromCaller(sym);
  const last = deskOwnerRelease(deskTimesaleEquityOwners, wire, "live_flow");
  if (!last || deskTimesaleEquityOwners.has(wire)) return;
  if (!subscribedTimesaleEquitySymbols.has(wire) && connectionState === "connected") {
    sendDeskTimesaleEquityUnsubs([wire]);
  }
}

export function deskFlowStreamerEnsureFuturesL1(displaySymbol: string): boolean {
  const ds = displaySymbol.trim().toUpperCase();
  const key = schwabFuturesKey(ds);
  addFuturesDisplay(key, ds);
  const appHas = subscribedFuturesSymbols.has(key);
  const first = deskOwnerHold(deskFuturesL1WireOwners, key, "live_flow");
  if (first && !appHas && connectionState === "connected") {
    sendDeskFuturesAdd([key]);
    return true;
  }
  return false;
}

export function deskFlowStreamerReleaseFuturesL1(displaySymbol: string): void {
  const ds = displaySymbol.trim().toUpperCase();
  const key = schwabFuturesKey(ds);
  const last = deskOwnerRelease(deskFuturesL1WireOwners, key, "live_flow");
  if (!last || deskFuturesL1WireOwners.has(key)) return;
  if (!subscribedFuturesSymbols.has(key) && connectionState === "connected") {
    sendDeskFuturesUnsubs([key]);
  }
}

export function deskFlowStreamerEnsureTimesaleFutures(displaySymbol: string): boolean {
  const ds = displaySymbol.trim().toUpperCase();
  const key = schwabFuturesKey(ds);
  addFuturesDisplay(key, ds);
  const first = deskOwnerHold(deskTimesaleFuturesWireOwners, key, "live_flow");
  if (first && connectionState === "connected") {
    sendDeskTimesaleFuturesAdd([key]);
    return true;
  }
  return false;
}

export function deskFlowStreamerReleaseTimesaleFutures(displaySymbol: string): void {
  const ds = displaySymbol.trim().toUpperCase();
  const key = schwabFuturesKey(ds);
  const last = deskOwnerRelease(deskTimesaleFuturesWireOwners, key, "live_flow");
  if (!last || deskTimesaleFuturesWireOwners.has(key)) return;
  if (connectionState === "connected") sendDeskTimesaleFuturesUnsubs([key]);
}

export function subscribeSchwabTimesaleFuturesEvents(listener: TimesaleFuturesListener): () => void {
  timesaleFuturesListeners.add(listener);
  return () => timesaleFuturesListeners.delete(listener);
}

function sendDeskOptionAdd(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("LEVELONE_OPTIONS", "ADD", {
    keys: symbols.join(","),
    fields: DESK_OPT_FIELDS,
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: desk LEVELONE_OPTIONS ADD");
  }
}

function sendDeskOptionsBookAdd(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("OPTIONS_BOOK", "ADD", {
    keys: symbols.join(","),
    fields: NYSE_NASDAQ_OPTIONS_BOOK_FIELDS,
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: desk OPTIONS_BOOK ADD");
  }
}

function sendDeskOptionsBookUnsubs(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("OPTIONS_BOOK", "UNSUBS", {
    keys: symbols.join(","),
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: desk OPTIONS_BOOK UNSUBS");
  }
}

function sendDeskTimesaleOptionAdd(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("TIMESALE_OPTIONS", "ADD", {
    keys: symbols.join(","),
    fields: "0,1,2,3,4,5,6,7,8,9,10",
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length, sample: symbols.slice(0, 3) }, "Schwab streamer: desk TIMESALE_OPTIONS ADD");
  }
}

/** Debug-only: ADD TIMESALE_OPTIONS on existing login (no second connection). */
export function deskStreamerAddTimesaleOptions(symbols: string[]): number {
  const added: string[] = [];
  for (const s of symbols) {
    const k = s.trim();
    if (!k || deskAddedTimesaleOptionSymbols.has(k)) continue;
    deskAddedTimesaleOptionSymbols.add(k);
    added.push(k);
  }
  if (added.length > 0 && connectionState === "connected") {
    sendDeskTimesaleOptionAdd(added);
  }
  return added.length;
}

export function deskStreamerUnsubTimesaleOptions(symbols: string[]): void {
  const removed: string[] = [];
  for (const s of symbols) {
    const k = s.trim();
    if (!deskAddedTimesaleOptionSymbols.has(k)) continue;
    deskAddedTimesaleOptionSymbols.delete(k);
    removed.push(k);
  }
  if (removed.length > 0 && connectionState === "connected") {
    const req = buildRequest("TIMESALE_OPTIONS", "UNSUBS", { keys: removed.join(",") });
    if (req) sendStreamerJson({ requests: [req] });
  }
}

function sendDeskOptionUnsubs(symbols: string[]): void {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;
  const req = buildRequest("LEVELONE_OPTIONS", "UNSUBS", {
    keys: symbols.join(","),
  });
  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info({ count: symbols.length }, "Schwab streamer: desk LEVELONE_OPTIONS UNSUBS");
  }
}

function batchDeskAdd(send: (batch: string[]) => void, all: string[]): void {
  for (let i = 0; i < all.length; i += DESK_ADD_BATCH) {
    send(all.slice(i, i + DESK_ADD_BATCH));
    noteWireLevelOneOptionsPeak();
  }
}

export function deskStreamerAddEquity(symbols: string[]): number {
  const added: string[] = [];
  for (const s of symbols) {
    const normalized = prepareEquitySubscribeFromCaller(s);
    const first = deskOwnerHold(deskEquityL1Owners, normalized, "tape_universe");
    if (first && !deskAddedEquitySymbols.has(normalized)) {
      deskAddedEquitySymbols.add(normalized);
      added.push(normalized);
    }
  }
  if (added.length > 0 && connectionState === "connected") {
    batchDeskAdd(sendDeskEquityAdd, added);
  }
  return added.length;
}

/** Drop desk ADD keys before an app SUBS transition (ordering: desk UNSUBS first). */
export function deskStreamerUnsubRemovedDeskOptions(symbols: string[]): void {
  const removed = symbols.filter((s) => deskAddedOptionSymbols.has(s));
  if (!removed.length) return;
  for (const s of removed) deskAddedOptionSymbols.delete(s);
  if (connectionState === "connected") {
    batchDeskAdd(sendDeskOptionUnsubs, removed);
    noteWireLevelOneOptionsPeak();
  }
}

export function getDeskAddedLevelOneOptionSymbols(): string[] {
  return [...deskAddedOptionSymbols];
}

export function __streamerWireServerLevelOneOptionsCount(): number {
  return streamerWireSimulatorLiveLevelOneOptionsCount();
}

export function __streamerWireDeskKeysOnServer(): Set<string> {
  return streamerWireSimulatorDeskLevelOneKeysOnWire();
}

let wirePeakLevelOneOptions = 0;

function noteWireLevelOneOptionsPeak(): void {
  const n = __streamerWireServerLevelOneOptionsCount();
  if (n > wirePeakLevelOneOptions) wirePeakLevelOneOptions = n;
}

export function __streamerWirePeakLevelOneOptionsForTests(): number {
  return wirePeakLevelOneOptions;
}

export function __streamerWirePeakResetForTests(): void {
  wirePeakLevelOneOptions = 0;
  streamerWireSimulatorResetForTests();
}

export function deskStreamerSetDeskOptions(symbols: string[]): number {
  const budget = streamerSubMaxDeskOptionKeys();
  const sync = deskStreamerSyncDeskSymbols(
    deskAddedOptionSymbols,
    symbols,
    budget,
    subscribedOptionSymbols,
  );

  for (const s of sync.yieldToApp) deskAddedOptionSymbols.delete(s);

  if (sync.unsub.length > 0 && connectionState === "connected") {
    for (const s of sync.unsub) deskAddedOptionSymbols.delete(s);
    batchDeskAdd(sendDeskOptionUnsubs, sync.unsub);
  }

  deskAddedOptionSymbols.clear();
  for (const k of sync.next) deskAddedOptionSymbols.add(k);

  if (sync.add.length > 0 && connectionState === "connected") {
    batchDeskAdd(sendDeskOptionAdd, sync.add);
  }
  noteWireLevelOneOptionsPeak();
  return sync.add.length;
}

/** @deprecated use deskStreamerSetDeskOptions with pre-trimmed list */
export function deskStreamerAddOptions(symbols: string[]): number {
  return deskStreamerSetDeskOptions(symbols);
}

export function deskStreamerSetDeskOptionsBook(symbols: string[]): number {
  const budget = streamerSubMaxDeskBookKeys();
  const sync = deskStreamerSyncDeskSymbols(
    deskAddedOptionsBookSymbols,
    symbols,
    budget,
    subscribedOptionsBookSymbols,
  );

  for (const s of sync.yieldToApp) deskAddedOptionsBookSymbols.delete(s);

  if (sync.unsub.length > 0 && connectionState === "connected") {
    for (const s of sync.unsub) deskAddedOptionsBookSymbols.delete(s);
    batchDeskAdd(sendDeskOptionsBookUnsubs, sync.unsub);
  }

  deskAddedOptionsBookSymbols.clear();
  for (const k of sync.next) deskAddedOptionsBookSymbols.add(k);

  if (sync.add.length > 0 && connectionState === "connected") {
    batchDeskAdd(sendDeskOptionsBookAdd, sync.add);
  }
  return sync.add.length;
}

export function deskStreamerAddOptionsBook(symbols: string[]): number {
  return deskStreamerSetDeskOptionsBook(symbols);
}

export function deskStreamerReplayDeskEquityAdds(): void {
  if (connectionState !== "connected") return;
  const deskOnly = [...deskAddedEquitySymbols].filter((k) => !subscribedSymbols.has(k));
  if (deskOnly.length > 0) batchDeskAdd(sendDeskEquityAdd, deskOnly);
}

export function deskStreamerReplayDeskOptionAdds(): void {
  if (connectionState !== "connected") return;
  if (deskAddedOptionSymbols.size > 0) {
    batchDeskAdd(sendDeskOptionAdd, [...deskAddedOptionSymbols]);
  }
}

/** After app SUBS (replace-all), re-ADD desk keys up to the dynamic desk budget. */
export function deskStreamerReplayDeskAfterAppLevelOneSub(): void {
  if (connectionState !== "connected") return;
  const maxDesk = streamerSubMaxDeskOptionKeys();
  const trimmed = trimKeysFurthestFromMoney(
    [...deskAddedOptionSymbols],
    maxDesk,
    streamerSubGetChainSortSpot(),
  );
  deskAddedOptionSymbols.clear();
  for (const k of trimmed) deskAddedOptionSymbols.add(k);
  if (trimmed.length > 0) batchDeskAdd(sendDeskOptionAdd, trimmed);
}

export function deskStreamerReplayDeskAfterAppOptionsBookSub(): void {
  if (connectionState !== "connected") return;
  const maxDesk = streamerSubMaxDeskBookKeys();
  const keys = [...deskAddedOptionsBookSymbols].slice(0, maxDesk);
  deskAddedOptionsBookSymbols.clear();
  for (const k of keys) deskAddedOptionsBookSymbols.add(k);
  if (keys.length > 0) batchDeskAdd(sendDeskOptionsBookAdd, keys);
}

export function deskStreamerReplayDeskOptionsBookAdds(): void {
  if (connectionState !== "connected") return;
  if (deskAddedOptionsBookSymbols.size > 0) {
    batchDeskAdd(sendDeskOptionsBookAdd, [...deskAddedOptionsBookSymbols]);
  }
}

export function deskStreamerReplayDeskAdds(): void {
  if (connectionState !== "connected") return;
  deskStreamerReplayDeskEquityAdds();
  deskStreamerReplayDeskOptionAdds();
  deskStreamerReplayDeskOptionsBookAdds();
  deskStreamerReplayDeskFlowAdds();
}

/** After LOGIN: app full SUBS (no desk replay), then one desk ADD replay — only login path. */
export function deskStreamerAfterLoginAppSubsThenDeskReplay(): void {
  if (connectionState !== "connected") return;
  if (subscribedSymbols.size > 0) {
    sendEquitySubscription([...subscribedSymbols], { replayDeskEquities: false });
  }
  if (subscribedFuturesSymbols.size > 0) {
    sendFuturesSubscription([...subscribedFuturesSymbols]);
  }
  if (subscribedOptionSymbols.size > 0) {
    sendOptionSubscription([...subscribedOptionSymbols], { replayDesk: false });
  }
  if (subscribedFuturesOptionSymbols.size > 0) {
    sendFuturesOptionSubscription([...subscribedFuturesOptionSymbols]);
  }
  if (subscribedTimesaleEquitySymbols.size > 0) {
    sendTimesaleEquitySubscription([...subscribedTimesaleEquitySymbols]);
  }
  if (subscribedChartEquitySymbols.size > 0) {
    sendChartEquitySubscription([...subscribedChartEquitySymbols]);
  }
  if (subscribedNyseBookSymbols.size > 0) {
    sendNyseBookSubscription([...subscribedNyseBookSymbols]);
  }
  if (subscribedNasdaqBookSymbols.size > 0) {
    sendNasdaqBookSubscription([...subscribedNasdaqBookSymbols]);
  }
  if (subscribedOptionsBookSymbols.size > 0) {
    sendOptionsBookSubscription([...subscribedOptionsBookSymbols], { replayDesk: false });
    deskStreamerReplayDeskAfterAppOptionsBookSub();
  }
  deskStreamerReplayDeskAfterAppLevelOneSub();
  deskStreamerReplayDeskEquityAdds();
  deskStreamerReplayDeskFlowAdds();
}

export function getDeskStreamerAddCounts(): {
  levelone_equities: number;
  levelone_options: number;
  options_book: number;
} {
  return {
    levelone_equities: deskAddedEquitySymbols.size,
    levelone_options: deskAddedOptionSymbols.size,
    options_book: deskAddedOptionsBookSymbols.size,
  };
}

function sendAcctActivitySubscription() {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo) return;
  if (acctActivitySubscribed) return;

  const req = buildRequest("ACCT_ACTIVITY", "SUBS", {
    keys: streamerInfo.schwabClientCorrelId,
    fields: "0,1,2,3",
  });

  if (req) {
    sendStreamerJson({ requests: [req] });
    logger.info("Schwab streamer: ACCT_ACTIVITY SUBS sent (awaiting confirmation)");
    if (acctActivitySubTimeout) clearTimeout(acctActivitySubTimeout);
    acctActivitySubTimeout = setTimeout(() => {
      if (!acctActivitySubscribed) {
        void logFailure("SCHWAB_STREAM", "ERROR", "ACCT_ACTIVITY subscription not confirmed within 10 seconds", {});
      }
    }, 10_000);
  }
}

function processAcctActivity(content: Record<string, unknown>[]) {
  for (const item of content) {
    const seqNum = item["1"] as string | undefined;
    const msgType = item["2"] as string | undefined;
    const msgData = item["3"] as string | undefined;

    if (msgType === "SUBSCRIBED" || (!msgType && !msgData)) {
      logger.debug({ seqNum, msgType }, "Schwab ACCT_ACTIVITY heartbeat");
      continue;
    }

    logger.info({ seqNum, msgType, rawLength: msgData?.length ?? 0 },
      "Schwab ACCT_ACTIVITY event");
    if (msgType && msgType !== "SUBSCRIBED") {
      void import("./wsServer.js")
        .then((m) => m.requestPortfolioRefreshFromAcctActivity())
        .catch(() => undefined);
    }

    if (msgData) {
      logger.info({ msgData }, "Schwab ACCT_ACTIVITY raw payload");
    }

    let parsed: Record<string, unknown> = {};
    if (msgData) {
      try { parsed = JSON.parse(msgData); } catch { /* non-JSON fallback below */ }
    }

    const orderId = (parsed.SchwabOrderID as string) ?? null;

    if (isAlertSeen(orderId, msgType ?? null)) {
      logger.info({ orderId, msgType }, "Schwab ACCT_ACTIVITY dedup — skipping (already broadcast via REST)");
      void logFailure("SCHWAB_STREAM", "INFO", `ACCT_ACTIVITY dedup blocked event: ${msgType} for order ${orderId}`, { orderId, msgType });
      return;
    }

    const found = findKeysDeep(parsed, [
      "Symbol", "Instruction", "Side", "OrderSide",
      "Quantity", "FilledQuantity", "OriginalQuantity",
      "ExecutionPrice", "Price", "LimitPrice", "AveragePrice",
      "OrderType",
    ]);

    const symbol = (found["Symbol"] as string) ?? null;
    const side = (found["Instruction"] ?? found["Side"] ?? found["OrderSide"]) as string | undefined ?? null;
    const quantity = String(found["Quantity"] ?? found["FilledQuantity"] ?? found["OriginalQuantity"] ?? "");
    const price = String(found["ExecutionPrice"] ?? found["Price"] ?? found["LimitPrice"] ?? found["AveragePrice"] ?? "");
    const orderType = (found["OrderType"] as string) ?? null;

    const alertPayload: Record<string, unknown> = {
      type: msgType ?? "UNKNOWN",
      timestamp: Date.now(),
      orderId,
      symbol,
      side,
      quantity: quantity || null,
      price: price || null,
      orderType,
      raw: msgData ?? "",
    };

    const sym = symbol ?? "";
    const qty = quantity;
    const prc = price;

    let pushBody = "";
    let pushTag = "acct-activity";

    switch (msgType) {
      case "OrderCreated":
        pushBody = `${side ?? ""} ${qty} ${sym} order CREATED`.trim();
        pushTag = "OrderCreated";
        break;
      case "OrderAccepted":
        pushTag = "OrderAccepted";
        break;
      case "ExecutionCreated":
        pushBody = `${side ?? ""} ${qty} ${sym} FILLED @ $${prc}`.trim();
        pushTag = "ExecutionCreated";
        if (orderId && symbol) {
          void handleFillForExitStaging({
            schwabOrderId: orderId,
            symbol: symbol,
            side: side ?? "",
            quantity: qty,
            executionPrice: prc,
          });
        }
        break;
      case "OrderUROutCompleted":
        pushTag = "OrderUROutCompleted";
        break;
      case "CancelAccepted":
        pushBody = `${sym} order CANCELED`.trim();
        pushTag = "CancelAccepted";
        break;
      case "CancelRejected":
        pushBody = `${sym} cancel REJECTED`.trim();
        pushTag = "CancelRejected";
        break;
      case "OrderRejected":
        // No push notification — broker rejections are visible in the Orders tab.
        // A bell for every rejection creates noise, especially during reconnects.
        pushTag = "OrderRejected";
        break;
      case "OrderExpired":
        pushBody = `${sym} order EXPIRED`.trim();
        pushTag = "OrderExpired";
        break;
      case "OrderModified":
        pushBody = `${sym} order MODIFIED`.trim();
        pushTag = "OrderModified";
        break;
      default:
        pushBody = `Account activity: ${msgType ?? "unknown"} ${sym}`.trim();
        break;
    }

    if (orderId && msgType) {
      markAlertSeen(orderId, msgType);
    }

    logger.info({ orderId, msgType, symbol, wsClients: wsBroadcast ? "registered" : "null" },
      "ACCT_ACTIVITY broadcasting orderAlert");
    broadcast("orderAlert", alertPayload);

    if (pushBody) {
      void sendPushToAll({
        title: "ALPHA TERMINAL",
        body: pushBody,
        tag: pushTag,
        data: { orderId, symbol: sym },
      });
    }
  }
}

function findKeysDeep(
  obj: unknown,
  targetKeys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const remaining = new Set(targetKeys);

  function walk(node: unknown): void {
    if (remaining.size === 0) return;
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      for (const el of node) walk(el);
      return;
    }

    if (typeof node === "object") {
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (remaining.has(key) && val !== undefined && val !== null) {
          result[key] = val;
          remaining.delete(key);
        }
        if (remaining.size === 0) return;
        if (typeof val === "object" && val !== null) walk(val);
      }
    }
  }

  walk(obj);
  return result;
}

let equityTickSampleLogged = false;
let futuresTickSampleLogged = false;
let timesaleEquitySampleLogged = false;
let chartEquitySampleLogged = false;
let nyseBookSampleLogged = false;
let nasdaqBookSampleLogged = false;
let optionsBookSampleLogged = false;

function processEquityTick(content: Record<string, unknown>[]) {
  if (!equityTickSampleLogged && content.length > 0) {
    equityTickSampleLogged = true;
    const sample = content.slice(0, 3).map(c => ({ key: c["key"], "3": c["3"], "12": c["12"], "1": c["1"], "2": c["2"] }));
    logger.info({ count: content.length, sample }, "Schwab: first LEVELONE_EQUITIES data batch received");
  }
  const now = Date.now();
  for (const item of content) {
    const rawKey = item["key"] as string;
    if (!rawKey) continue;
    const streamKey = normalizeEquityKey(rawKey);

    const mappedDisplays = getClassShareDisplaysForKey(streamKey);
    const displayTargets =
      mappedDisplays.size > 0 ? [...mappedDisplays] : [streamKey];

    const existing = quoteCache.get(displayTargets[0]!) ?? quoteCache.get(streamKey);
    const last = numOrNull(item["3"]) ?? existing?.last ?? null;
    const regularLast = numOrNull(item["29"]) ?? existing?.regularLast ?? null;
    const close = numOrNull(item["12"]) ?? existing?.close ?? null;

    // Day change is from PREVIOUS close → today's regular-session last (or
    // extended last if regular not yet set).
    const refLast = regularLast ?? last;
    let change: number | null = existing?.change ?? null;
    let changePct: number | null = existing?.changePct ?? null;
    if (refLast !== null && close !== null && close !== 0) {
      change = refLast - close;
      changePct = (change / close) * 100;
    }

    const baseQuote: LiveQuote = {
      symbol: streamKey,
      last,
      regularLast,
      extendedLast: last,
      bid: numOrNull(item["1"]) ?? existing?.bid ?? null,
      ask: numOrNull(item["2"]) ?? existing?.ask ?? null,
      bidSize: numOrNull(item["4"]) ?? existing?.bidSize ?? null,
      askSize: numOrNull(item["5"]) ?? existing?.askSize ?? null,
      change,
      changePct,
      volume: numOrNull(item["8"]) ?? existing?.volume ?? null,
      high: numOrNull(item["10"]) ?? existing?.high ?? null,
      low: numOrNull(item["11"]) ?? existing?.low ?? null,
      close,
      ts: now,
      quoteSource: "SCHWAB",
    };

    if (streamKey !== displayTargets[0]) {
      quoteCache.set(streamKey, baseQuote);
    }
    for (const displaySymbol of displayTargets) {
      const quote: LiveQuote = { ...baseQuote, symbol: displaySymbol };
      quoteCache.set(displaySymbol, quote);
      broadcast("quote", quote);
    }
    deskLiveFlowTapeOnEquityL1(streamKey, item, now);
  }
}

function processOptionTick(content: Record<string, unknown>[]) {
  const now = Date.now();
  for (const item of content) {
    const key = item["key"] as string;
    if (!key) continue;

    const existing = optionCache.get(key);
    const tick = mergeOptionTickFromSchwab(existing, item, key, now);

    optionCache.set(key, tick);
    broadcast("optionQuote", tick);
  }
}

function processFuturesTick(content: Record<string, unknown>[]) {
  if (!futuresTickSampleLogged && content.length > 0) {
    futuresTickSampleLogged = true;
    const sample = content.slice(0, 3).map(c => ({ key: c["key"], "3": c["3"], "14": c["14"], "1": c["1"], "2": c["2"] }));
    logger.info({ count: content.length, sample }, "Schwab: first LEVELONE_FUTURES data batch received");
  }
  const now = Date.now();
  for (const item of content) {
    const rawKey = item["key"] as string;
    if (!rawKey) continue;

    const streamKey = rawKey.toUpperCase();
    const activeField = item["34"];
    if (typeof activeField === "string" && activeField.trim().startsWith("/")) {
      const active = activeField.toUpperCase().trim();
      const root = futuresRootFromContract(active) ?? futuresRootFromContract(streamKey);
      if (root) setFuturesActiveSymbolForRoot(root, active);
    }

    const mappedDisplays = getFuturesDisplaysForKey(streamKey);
    const displayTargets =
      mappedDisplays.size > 0 ? [...mappedDisplays] : [streamKey];
    if (mappedDisplays.size === 0) {
      logger.info(
        { rawKey: streamKey, knownKeys: Object.keys(futuresDisplayRegistrySnapshot()).slice(0, 5) },
        "Schwab futures: unmapped key received",
      );
    }

    const existing = quoteCache.get(displayTargets[0]!) ?? quoteCache.get(streamKey);
    const last = numOrNull(item["3"]) ?? existing?.last ?? null;
    const close = numOrNull(item["14"]) ?? existing?.close ?? null;

    let change: number | null = numOrNull(item["19"]) ?? existing?.change ?? null;
    let changePct: number | null = existing?.changePct ?? null;
    if (last !== null && close !== null && close !== 0) {
      change = last - close;
      changePct = (change / close) * 100;
    }

    const baseQuote: LiveQuote = {
      symbol: streamKey,
      last,
      regularLast: last,
      extendedLast: last,
      bid: numOrNull(item["1"]) ?? existing?.bid ?? null,
      ask: numOrNull(item["2"]) ?? existing?.ask ?? null,
      bidSize: numOrNull(item["4"]) ?? existing?.bidSize ?? null,
      askSize: numOrNull(item["5"]) ?? existing?.askSize ?? null,
      change,
      changePct,
      volume: numOrNull(item["8"]) ?? existing?.volume ?? null,
      high: numOrNull(item["12"]) ?? existing?.high ?? null,
      low: numOrNull(item["13"]) ?? existing?.low ?? null,
      close,
      ts: now,
      quoteSource: "SCHWAB",
    };

    if (streamKey !== displayTargets[0]) {
      quoteCache.set(streamKey, baseQuote);
    }
    for (const displaySymbol of displayTargets) {
      const quote: LiveQuote = { ...baseQuote, symbol: displaySymbol };
      quoteCache.set(displaySymbol, quote);
      broadcast("quote", quote);
      deskLiveFlowTapeOnFuturesL1(displaySymbol, item, now);
    }
  }
}

function dispatchBookListeners(listeners: Set<BookListener>, ev: SchwabBookLevel2Event): void {
  for (const fn of listeners) {
    try {
      fn(ev);
    } catch (err) {
      logger.error({ err }, "Schwab streamer: OPTIONS/NASDAQ/NYSE book listener threw");
    }
  }
}

function emitTimesaleEquityListeners(ev: SchwabTimesaleEquityEvent): void {
  for (const fn of timesaleEquityListeners) {
    try {
      fn(ev);
    } catch (err) {
      logger.error({ err }, "Schwab streamer: TIMESALE_EQUITY listener threw");
    }
  }
}

function emitTimesaleFuturesListeners(ev: SchwabTimesaleEquityEvent & { displaySymbol: string }): void {
  for (const fn of timesaleFuturesListeners) {
    try {
      fn(ev);
    } catch (err) {
      logger.error({ err }, "Schwab streamer: TIMESALE_FUTURES listener threw");
    }
  }
}

function processTimesaleFutures(content: Record<string, unknown>[]) {
  if (content.length === 0) return;
  for (const item of content) {
    const rawKey = (item["key"] ?? item["0"]) as string | undefined;
    if (!rawKey) continue;
    const streamKey = rawKey.toUpperCase();
    const mappedDisplays = getFuturesDisplaysForKey(streamKey);
    const displayTargets = mappedDisplays.size > 0 ? [...mappedDisplays] : [streamKey];
    for (const displaySymbol of displayTargets) {
      const ev = {
        symbol: displaySymbol,
        displaySymbol,
        tradeTimeMs: numOrNull(item["1"]),
        lastPrice: numOrNull(item["2"]),
        lastSize: numOrNull(item["3"]),
        sequence: numOrNull(item["4"]),
        raw: item,
      };
      emitTimesaleFuturesListeners(ev);
      if (ev.lastPrice != null && ev.lastPrice > 0 && ev.lastSize != null && ev.lastSize > 0) {
        deskLiveFlowTapeOnTimesaleFutures(
          displaySymbol,
          ev.lastPrice,
          ev.lastSize,
          ev.tradeTimeMs,
          ev.sequence,
        );
      }
    }
  }
}

/**
 * Field mapping: 1 = trade time (ms), 2 = last price, 3 = last size, 4 = sequence (Streamer Guide / TD lineage).
 */
function processTimesaleEquity(content: Record<string, unknown>[]) {
  if (content.length === 0) return;
  if (!timesaleEquitySampleLogged) {
    timesaleEquitySampleLogged = true;
    logger.info(
      { event: "EXIT", phase: "schwab_timesale_equity_batch", batchSize: content.length },
      "Schwab streamer: TIMESALE_EQUITY batch handled",
    );
  }
  for (const item of content) {
    const rawKey = (item["key"] ?? item["0"]) as string | undefined;
    const symbol = rawKey ? normalizeEquityKey(rawKey) : "";
    if (!symbol) continue;
    const ev: SchwabTimesaleEquityEvent = {
      symbol,
      tradeTimeMs: numOrNull(item["1"]),
      lastPrice: numOrNull(item["2"]),
      lastSize: numOrNull(item["3"]),
      sequence: numOrNull(item["4"]),
      raw: item,
    };
    const tsMs = ev.tradeTimeMs ?? Date.now();
    if (ev.lastPrice != null && ev.lastPrice > 0 && ev.lastSize != null && ev.lastSize > 0) {
      appendStrategistTimesale(symbol, { ts: tsMs, price: ev.lastPrice, size: ev.lastSize });
      deskLiveFlowTapeOnTimesaleEquity(symbol, ev.lastPrice, ev.lastSize, ev.tradeTimeMs, ev.sequence);
    }
    emitTimesaleEquityListeners(ev);
  }
}

/**
 * CHART_EQUITY — one-minute bars; field **7** chart time (epoch ms), fields **2–6** OHLCV per Streamer Guide.
 */
function processChartEquity(content: Record<string, unknown>[]) {
  if (content.length === 0) return;
  if (!chartEquitySampleLogged) {
    chartEquitySampleLogged = true;
    logger.info(
      { event: "EXIT", phase: "schwab_chart_equity_batch", batchSize: content.length },
      "Schwab streamer: CHART_EQUITY batch handled",
    );
  }
  for (const item of content) {
    const rawKey = (item["key"] ?? item["0"]) as string | undefined;
    const symbol = rawKey ? normalizeEquityKey(rawKey) : "";
    if (!symbol) continue;
    const chartTimeRaw = numOrNull(item["7"]);
    const chartTimeMs = chartTimeRaw != null ? normalizeChartTimeMs(chartTimeRaw) : NaN;
    const open = numOrNull(item["2"]);
    const high = numOrNull(item["3"]);
    const low = numOrNull(item["4"]);
    const close = numOrNull(item["5"]);
    const volRaw = numOrNull(item["6"]);
    const volume = volRaw != null && volRaw >= 0 && Number.isFinite(volRaw) ? volRaw : 0;
    if (!Number.isFinite(chartTimeMs) || close == null || close <= 0) {
      continue;
    }
    if (open == null || high == null || low == null) {
      continue;
    }
    appendStrategistChartEquity(symbol, {
      chartTimeMs,
      open,
      high,
      low,
      close,
      volume,
    });
  }
}

function processNyseBook(content: Record<string, unknown>[]) {
  if (content.length === 0) return;
  if (!nyseBookSampleLogged) {
    nyseBookSampleLogged = true;
    logger.info(
      { event: "EXIT", phase: "schwab_nyse_book_batch", batchSize: content.length },
      "Schwab streamer: NYSE_BOOK batch handled",
    );
  }
  for (const item of content) {
    const rawKey = (item["key"] ?? item["0"]) as string | undefined;
    const symbol = rawKey ? normalizeEquityKey(rawKey) : "";
    if (!symbol) continue;
    const ev: SchwabBookLevel2Event = {
      symbol,
      bookTimeMs: numOrNull(item["1"]),
      bids: item["2"] ?? null,
      asks: item["3"] ?? null,
      raw: item,
    };
    nyseBookStrategistCache.set(symbol, {
      rawBids: ev.bids,
      rawAsks: ev.asks,
      bookTimeMs: ev.bookTimeMs,
      recvTs: Date.now(),
    });
    dispatchBookListeners(nyseBookListeners, ev);
  }
}

function processNasdaqBook(content: Record<string, unknown>[]) {
  if (content.length === 0) return;
  if (!nasdaqBookSampleLogged) {
    nasdaqBookSampleLogged = true;
    logger.info(
      { event: "EXIT", phase: "schwab_nasdaq_book_batch", batchSize: content.length },
      "Schwab streamer: NASDAQ_BOOK batch handled",
    );
  }
  for (const item of content) {
    const rawKey = (item["key"] ?? item["0"]) as string | undefined;
    const symbol = rawKey ? normalizeEquityKey(rawKey) : "";
    if (!symbol) continue;
    const ev: SchwabBookLevel2Event = {
      symbol,
      bookTimeMs: numOrNull(item["1"]),
      bids: item["2"] ?? null,
      asks: item["3"] ?? null,
      raw: item,
    };
    nasdaqBookStrategistCache.set(symbol, {
      rawBids: ev.bids,
      rawAsks: ev.asks,
      bookTimeMs: ev.bookTimeMs,
      recvTs: Date.now(),
    });
    dispatchBookListeners(nasdaqBookListeners, ev);
  }
}

function processOptionsBook(content: Record<string, unknown>[]) {
  if (content.length === 0) return;
  if (!optionsBookSampleLogged) {
    optionsBookSampleLogged = true;
    logger.info(
      { event: "EXIT", phase: "schwab_options_book_batch", batchSize: content.length },
      "Schwab streamer: OPTIONS_BOOK batch handled",
    );
  }
  for (const item of content) {
    const rawKey = (item["key"] ?? item["0"]) as string | undefined;
    const symbol = rawKey ? String(rawKey).trim() : "";
    if (!symbol) continue;
    const ev: SchwabBookLevel2Event = {
      symbol,
      bookTimeMs: numOrNull(item["1"]),
      bids: item["2"] ?? null,
      asks: item["3"] ?? null,
      raw: item,
    };
    dispatchBookListeners(optionsBookListeners, ev);
  }
}

function applyLevelOneOptionsCapRejection(msgText: string | undefined): void {
  const parsed = streamerSubParseRejection(msgText);
  if (parsed.kind !== "cap" || parsed.discarded <= 0 || parsed.service !== "LEVELONE_OPTIONS") return;
  streamerSubRecordRejection(
    parsed.service,
    `cap_discard_${parsed.discarded}`,
    "cap_discard",
  );
  const before = streamerWireSimulatorAllLevelOneKeysOnWire().size;
  const order = streamerSubLowestPriorityWireDropOrder();
  streamerWireSimulatorDropLevelOneByPriority(order, parsed.discarded);
  const after = streamerWireSimulatorAllLevelOneKeysOnWire().size;
  const dropped = before - after;
  if (dropped < parsed.discarded) {
    streamerSubRecordRejection(
      "LEVELONE_OPTIONS",
      `cap_discard_unattributed_${parsed.discarded - dropped}`,
      "cap_discard_unattributed",
    );
  }
}

/** Vitest: Schwab LEVELONE_OPTIONS ADD cap rejection (health + simulator). */
export function __schwabStreamerApplyLevelOneOptionsCapRejectionForTests(msgText: string): void {
  applyLevelOneOptionsCapRejection(msgText);
}

function handleMessage(raw: string) {
  onSchwabInboundFrame(raw);
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg["response"]) {
    const responses = msg["response"] as Array<Record<string, unknown>>;
    for (const r of responses) {
      const service = r["service"] as string;
      const command = r["command"] as string;
      const content = r["content"] as Record<string, unknown>;
      const code = content?.["code"] as number;
      const msgText = content?.["msg"] as string;

      if (code === 12) {
        onSchwabEvictedYielded();
        reconnectDelay = MAX_RECONNECT_DELAY;
        logger.warn({ service, command, msg: msgText }, "Schwab streamer: connection evicted (code 12) — backing off");
      }

      if (service !== "ADMIN") {
        logger.info({ service, command, code, msg: msgText }, "Schwab streamer: subscription response");
      }
      if (
        service === "TIMESALE_OPTIONS" ||
        service === "TIMESALE_EQUITY" ||
        service === "TIMESALE_FUTURES"
      ) {
        void import("./desk/deskLiveFlowTimesale.js").then((m) =>
          m.deskLiveFlowTimesalePushStreamerResponse(service, r),
        );
      }
      if (command === "ADD" && code !== 0 && code !== 12 && msgText) {
        void import("./desk/deskStreamerBudget.js").then((m) => m.deskParseSchwabStreamerLimitMessage(msgText));
        if (
          (service === "LEVELONE_FUTURES" || service === "TIMESALE_FUTURES") &&
          msgText.toLowerCase().includes("entit")
        ) {
          void import("./desk/deskLiveFlowSubs.js").then((subs) => {
            const fsym = subs.deskLiveFlowSubsLastFuturesDisplay() ?? "/ES";
            void import("./desk/deskLiveFlowTape.js").then((m) =>
              m.deskLiveFlowTapeEmitNotice(fsym, "futures_not_entitled", "futures data not entitled"),
            );
          });
        }
      }
      if (
        command === "ADD" &&
        code !== 0 &&
        code !== 12 &&
        (service === "LEVELONE_OPTIONS" || service === "OPTIONS_BOOK" || service === "LEVELONE_EQUITIES")
      ) {
        if (service === "LEVELONE_OPTIONS" || service === "OPTIONS_BOOK") {
          const parsed = streamerSubParseRejection(msgText);
          if (parsed.kind === "cap" && parsed.discarded > 0) {
            if (parsed.service === "LEVELONE_OPTIONS") {
              applyLevelOneOptionsCapRejection(msgText);
            } else {
              streamerSubRecordRejection(
                parsed.service,
                `cap_discard_${parsed.discarded}`,
                "cap_discard",
              );
            }
          } else if (parsed.kind === "symbol") {
            streamerSubRecordRejection(
              service as "LEVELONE_OPTIONS" | "OPTIONS_BOOK",
              parsed.symbol,
              `code_${code}`,
            );
            if (service === "LEVELONE_OPTIONS") {
              const live = streamerWireSimulatorAllLevelOneKeysOnWire();
              const resolved = streamerSubResolveLiveKey(parsed.symbol, live);
              if (resolved) streamerWireSimulatorRemoveLevelOneOptions([resolved]);
            } else {
              const resolved = streamerSubResolveLiveKey(
                parsed.symbol,
                streamerWireSimulatorAllOptionsBookKeysOnWire(),
              );
              if (resolved) streamerWireSimulatorRemoveOptionsBook([resolved]);
            }
          } else {
            streamerSubRecordRejection(
              service as "LEVELONE_OPTIONS" | "OPTIONS_BOOK",
              "unknown",
              `code_${code}`,
            );
          }
        }
        void import("./desk/deskTapeUniverse.js").then((m) =>
          m.deskRecordStreamerRejection(`${service}:code_${code}:${msgText ?? "unknown"}`),
        );
      }
      if (service === "ACCT_ACTIVITY" && command === "SUBS") {
        if (code === 0) {
          acctActivitySubscribed = true;
          logger.info("Schwab streamer: ACCT_ACTIVITY subscription confirmed");
        } else {
          acctActivitySubscribed = false;
          logger.error({ code, msg: msgText }, "Schwab streamer: ACCT_ACTIVITY subscription failed — will retry on next reconnect");
          void logFailure("SCHWAB_STREAM", "ERROR", `ACCT_ACTIVITY subscription failed (code ${code})`, { code, msg: msgText });
        }
      }
      if (service === "ADMIN" && command === "LOGIN") {
        if (code === 0) {
          logger.info("Schwab streamer: LOGIN successful");
          if (loginTimeoutTimer) { clearTimeout(loginTimeoutTimer); loginTimeoutTimer = null; }
          connectionState = "connected";
          loginRetried = false;
          consecutiveLoginFailures = 0;
          consecutiveAbnormalCloses = 0;
          lastConnectedAt = Date.now();
          disconnectedAt = null;
          fiveMinCriticalSent = false;
          broadcast("streamerStatus", { status: "connected" });
          reconnectDelay = 2000;
          streamerWireSimulatorResetForTests();

          deskStreamerAfterLoginAppSubsThenDeskReplay();
          void import("./desk/deskTapeUniverse.js")
            .then((m) => m.deskTapeUniverseOnStreamerLogin())
            .catch(() => undefined);
          sendAcctActivitySubscription();
        } else {
          logger.error({ code, msg: msgText }, "Schwab streamer: LOGIN failed");
          consecutiveLoginFailures++;
          void logFailure("SCHWAB_STREAM", "ERROR", `Schwab WebSocket LOGIN failed (code ${code})`, { code, msg: msgText, consecutiveLoginFailures });
          connectionState = "disconnected";
          streamerWireSimulatorResetForTests();

          if (!loginRetried && (code === 3 || (msgText && msgText.toLowerCase().includes("expired")))) {
            // Code-3 / "expired" path takes priority over the 1006 counter
            // because it has explicit signal — but we still set the flag so
            // the next connect can refresh if THIS refresh's connect doesn't
            // reach LOGIN. Marking loginRetried guarantees we don't loop on
            // refresh within a single session.
            loginRetried = true;
            // Identity-snapshot the failed socket. The async refresh callback
            // below may resolve after a newer socket has been established
            // (e.g., a concurrent reconnect timer fired); without this guard
            // we would close that newer healthy socket.
            const failedWs = schwabWs;
            logger.info("Schwab streamer: token may be stale — force-refreshing and retrying");
            void forceRefresh("trader").then((ok) => {
              if (ok) {
                if (schwabWs && schwabWs === failedWs) {
                  try { schwabWs.close(); } catch {}
                  schwabWs = null;
                  void connectSchwabStreamer();
                } else {
                  logger.info("Schwab streamer: refresh complete but socket already replaced — skipping reconnect");
                }
              } else {
                logger.error("Schwab streamer: force refresh failed — cannot retry LOGIN");
                scheduleReconnect();
              }
            });
          } else {
            // Non-code-3 LOGIN failure (or already retried). If we've hit
            // the threshold, set the same refresh flag the 1006-counter
            // uses so connectSchwabStreamer rotates the token before the
            // next attempt. Both paths converge on a single refresh action.
            if (consecutiveLoginFailures >= ABNORMAL_CLOSE_REFRESH_THRESHOLD) {
              forceTokenRefreshOnNextConnect = true;
              logger.warn({ consecutiveLoginFailures, threshold: ABNORMAL_CLOSE_REFRESH_THRESHOLD },
                "Schwab streamer: hit LOGIN-failure threshold — will force token refresh on next connect");
            }
            scheduleReconnect();
          }
        }
      }
    }
  }

  if (msg["data"]) {
    const dataItems = msg["data"] as Array<{ service: string; content: Record<string, unknown>[] }>;
    for (const item of dataItems) {
      if (!item.content) continue;
      if (item.service === "LEVELONE_EQUITIES") {
        processEquityTick(item.content);
      } else if (item.service === "LEVELONE_FUTURES") {
        processFuturesTick(item.content);
      } else if (item.service === "LEVELONE_OPTIONS") {
        processOptionTick(item.content);
      } else if (item.service === "LEVELONE_FUTURES_OPTIONS") {
        processOptionTick(item.content);
      } else if (item.service === "ACCT_ACTIVITY") {
        processAcctActivity(item.content);
      } else if (item.service === "TIMESALE_EQUITY") {
        processTimesaleEquity(item.content);
      } else if (item.service === "TIMESALE_FUTURES") {
        processTimesaleFutures(item.content);
      } else if (item.service === "CHART_EQUITY") {
        processChartEquity(item.content);
      } else if (item.service === "NYSE_BOOK") {
        processNyseBook(item.content);
      } else if (item.service === "NASDAQ_BOOK") {
        processNasdaqBook(item.content);
      } else if (item.service === "OPTIONS_BOOK") {
        processOptionsBook(item.content);
      } else if (item.service === "TIMESALE_OPTIONS") {
        void import("./desk/deskLiveFlowTimesale.js").then((m) => {
          m.deskLiveFlowTimesalePushRaw(item.service, item.content);
        });
      } else {
        const keys = item.content?.map((c: Record<string, unknown>) => c["key"]).slice(0, 3);
        logger.info({ service: item.service, sampleKeys: keys }, "Schwab streamer: unhandled data service");
      }
    }
  }

  if (msg["notify"]) {
    const notifs = msg["notify"] as Array<Record<string, unknown>>;
    for (const n of notifs) {
      if (n["heartbeat"]) {
        logger.debug({ heartbeat: n["heartbeat"] }, "Schwab streamer: heartbeat");
      }
      const nCode = n["code"] as number | undefined;
      if (nCode === 12) {
        onSchwabEvictedYielded();
        reconnectDelay = MAX_RECONNECT_DELAY;
      }
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  logger.info({ delayMs: reconnectDelay }, "Schwab streamer: scheduling reconnect");
  if (disconnectedAt && !fiveMinCriticalSent) {
    const downMs = Date.now() - disconnectedAt;
    if (downMs > 5 * 60 * 1000) {
      const now = new Date();
      const etHour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
      const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 5 && etHour >= 9 && etHour < 16) {
        void logFailure("SCHWAB_STREAM", "CRITICAL", `Schwab WebSocket down for ${Math.round(downMs / 60000)} minutes during market hours`, { downMs });
        fiveMinCriticalSent = true;
      }
    }
  }
  void logFailure("SCHWAB_STREAM", "WARN", "Schwab WebSocket reconnect attempt scheduled", { delayMs: reconnectDelay });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectSchwabStreamer();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

async function connectSchwabStreamer() {
  // Cancel any pending reconnect timer — a direct connect call preempts it.
  // Without this, the timer can fire mid-handshake and call us again,
  // which would hit the CONNECTING branch below and kill our own legitimate
  // in-progress handshake (self-induced reconnect churn).
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (schwabWs) {
    if (schwabWs.readyState === WebSocket.OPEN) return;
    if (schwabWs.readyState === WebSocket.CONNECTING) {
      // Age-gate the termination: only kill a CONNECTING socket if it has
      // exceeded the handshake budget. A fresh handshake (e.g. one we just
      // started 50ms ago) deserves to finish — its own connectTimeoutTimer
      // will terminate it if it hangs. Without this gate, a concurrent
      // call to connectSchwabStreamer would clobber a legitimate in-flight
      // attempt.
      const age = connectAttemptStartedAt ? Date.now() - connectAttemptStartedAt : Number.POSITIVE_INFINITY;
      if (age < CONNECT_TIMEOUT_MS) {
        logger.debug({ ageMs: age }, "Schwab streamer: connect already in progress — deferring to existing handshake");
        return;
      }
      logger.warn({ ageMs: age }, "Schwab streamer: prior socket stuck in CONNECTING beyond timeout — terminating before retry");
      try { schwabWs.terminate(); } catch {}
      schwabWs = null;
    }
  }
  clearLifecycleTimers();
  connectAttemptStartedAt = Date.now();

  connectionState = "connecting";
  broadcast("streamerStatus", { status: "connecting" });

  // If repeated 1006-before-LOGIN hit the refresh threshold, rotate the token
  // before attempting again. Clear the flag regardless so we don't loop on
  // refresh.
  if (forceTokenRefreshOnNextConnect) {
    forceTokenRefreshOnNextConnect = false;
    logger.warn({ consecutiveAbnormalCloses }, "Schwab streamer: forcing token refresh before reconnect");
    try { await forceRefresh("trader"); } catch (err) {
      logger.error({ err }, "Schwab streamer: forced token refresh failed — retrying with current token");
    }
  }

  streamerInfo = await fetchStreamerInfo();
  if (!streamerInfo) {
    logger.warn("Schwab streamer: cannot connect — no streamer info");
    connectionState = "disconnected";
  streamerWireSimulatorResetForTests();
    scheduleReconnect();
    return;
  }

  logger.info({ url: streamerInfo.streamerSocketUrl }, "Schwab streamer: connecting");

  let ws: WebSocket;
  try {
    ws = new WebSocket(streamerInfo.streamerSocketUrl);
    schwabWs = ws;
  } catch (err) {
    logger.error({ err }, "Schwab streamer: WebSocket constructor failed");
    connectionState = "disconnected";
  streamerWireSimulatorResetForTests();
    scheduleReconnect();
    return;
  }

  // Identity guard: every handler/timer below captures `ws` in closure and
  // bails if `schwabWs !== ws`. This prevents stale events from a previous
  // socket (late close/error/timer) from clobbering the current socket's
  // state — a real risk because reconnects can replace `schwabWs` while
  // the old socket's event loop entries are still pending.
  const isCurrent = (): boolean => schwabWs === ws;

  // Hard timeout on the handshake itself. If 'open' never fires within
  // CONNECT_TIMEOUT_MS, terminate so 'close' fires and scheduleReconnect
  // kicks in. Without this, a half-open TCP state leaves us in CONNECTING
  // forever and the early-return above prevents ever retrying.
  connectTimeoutTimer = setTimeout(() => {
    if (!isCurrent()) return;
    if (ws.readyState === WebSocket.CONNECTING) {
      logger.warn({ timeoutMs: CONNECT_TIMEOUT_MS }, "Schwab streamer: handshake timeout — terminating");
      try { ws.terminate(); } catch {}
    }
  }, CONNECT_TIMEOUT_MS);

  const connectedUrl = streamerInfo.streamerSocketUrl;
  ws.on("open", () => {
    if (!isCurrent()) return;
    onSchwabConnectionOpened();
    logger.info("Schwab streamer: WebSocket connected");
    emitTelemetry("SCHWAB_STREAM", "INFO", "Schwab WebSocket connected", { url: connectedUrl });
    if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }

    // Reset *transport* backoff on handshake success — but only if we're not
    // currently stuck in a LOGIN-fail loop. If TCP keeps succeeding but LOGIN
    // keeps failing (credential rot / permissions revoked), we must NOT
    // hammer Schwab at 2s cadence; the auth-failure backoff (driven by
    // consecutiveLoginFailures) keeps the doubled delay in place until LOGIN
    // succeeds or the token-refresh threshold rotates the token.
    if (consecutiveLoginFailures === 0) {
      reconnectDelay = 2000;
    }

    // Start client-initiated keepalive. NAT/proxy layers between us and
    // Schwab may silently drop the TCP connection with no close frame —
    // that's the classic 1006 scenario. An active ws.ping() lets us detect
    // it via the pong watchdog.
    pingIntervalTimer = setInterval(() => {
      if (!isCurrent() || ws.readyState !== WebSocket.OPEN) return;
      try { ws.ping(); } catch {}
      if (pongWatchdogTimer) clearTimeout(pongWatchdogTimer);
      pongWatchdogTimer = setTimeout(() => {
        if (!isCurrent()) return;
        logger.warn({ timeoutMs: PONG_TIMEOUT_MS }, "Schwab streamer: pong timeout — terminating");
        try { ws.terminate(); } catch {}
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);

    // LOGIN response watchdog — if LOGIN ack never arrives, force close
    // so we don't sit in "connecting" state forever.
    loginTimeoutTimer = setTimeout(() => {
      if (!isCurrent()) return;
      if (connectionState !== "connected") {
        logger.warn({ timeoutMs: LOGIN_RESPONSE_TIMEOUT_MS }, "Schwab streamer: LOGIN response timeout — terminating");
        try { ws.terminate(); } catch {}
      }
    }, LOGIN_RESPONSE_TIMEOUT_MS);

    sendLogin();
  });

  ws.on("pong", () => {
    if (!isCurrent()) return;
    if (pongWatchdogTimer) { clearTimeout(pongWatchdogTimer); pongWatchdogTimer = null; }
  });

  ws.on("message", (data: Buffer | string) => {
    if (!isCurrent()) return;
    const raw = typeof data === "string" ? data : data.toString("utf-8");
    handleMessage(raw);
  });

  ws.on("close", (code, reason) => {
    // Stale close from a replaced socket — do NOT mutate global state.
    if (!isCurrent()) {
      logger.debug({ code }, "Schwab streamer: ignoring close from stale socket");
      return;
    }

    const sessionDuration = lastConnectedAt ? Date.now() - lastConnectedAt : null;
    const wasConnected = connectionState === "connected";

    // Counter management — kept tight so stale 1006s never accumulate:
    //   * 1006 BEFORE login-success → increment (might be credential rot
    //     manifesting as RST, e.g. server rejects token at handshake).
    //   * Any close AFTER successful login → reset (next session is a
    //     clean slate).
    //   * Any non-1006 close BEFORE login → reset (failure mode changed,
    //     don't carry an old streak forward).
    if (code === 1006 && !wasConnected) {
      consecutiveAbnormalCloses++;
      if (consecutiveAbnormalCloses >= ABNORMAL_CLOSE_REFRESH_THRESHOLD) {
        forceTokenRefreshOnNextConnect = true;
        logger.warn({ consecutiveAbnormalCloses, threshold: ABNORMAL_CLOSE_REFRESH_THRESHOLD },
          "Schwab streamer: hit 1006-before-LOGIN threshold — will force token refresh on next connect");
      }
    } else {
      consecutiveAbnormalCloses = 0;
    }

    const shortPostLoginFlap =
      code === 1006 &&
      wasConnected &&
      sessionDuration !== null &&
      sessionDuration < SHORT_LIVED_SESSION_ABNORMAL_MS;
    if (shortPostLoginFlap) {
      consecutivePostLoginFlap1006++;
      if (consecutivePostLoginFlap1006 >= ABNORMAL_CLOSE_REFRESH_THRESHOLD) {
        forceTokenRefreshOnNextConnect = true;
        logger.warn(
          { consecutivePostLoginFlap1006, threshold: ABNORMAL_CLOSE_REFRESH_THRESHOLD, sessionDurationMs: sessionDuration },
          "Schwab streamer: repeated short-lived session after LOGIN (1006) — will force token refresh on next connect",
        );
      }
    } else {
      consecutivePostLoginFlap1006 = 0;
    }

    logger.warn({
      code,
      reason: reason?.toString(),
      sessionDurationMs: sessionDuration,
      wasConnected,
      consecutiveAbnormalCloses,
      consecutivePostLoginFlap1006,
      consecutiveLoginFailures,
    }, "Schwab streamer: WebSocket closed");
    void logFailure("SCHWAB_STREAM", "WARN", `Schwab WebSocket disconnected (code ${code})`,
      {
        code,
        reason: reason?.toString(),
        sessionDurationMs: sessionDuration,
        wasConnected,
        consecutiveAbnormalCloses,
        consecutivePostLoginFlap1006,
        consecutiveLoginFailures,
      });

    clearLifecycleTimers();
    schwabWs = null;
    connectionState = "disconnected";
  streamerWireSimulatorResetForTests();
    acctActivitySubscribed = false;
    disconnectedAt = Date.now();
    fiveMinCriticalSent = false;
    connectAttemptStartedAt = null;
    broadcast("streamerStatus", { status: "disconnected" });
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    logger.error({ err }, "Schwab streamer: WebSocket error");
    // Force-terminate on error so 'close' is guaranteed to fire. Gated on
    // identity so we never terminate a successor socket from a stale error.
    // ws.terminate() is idempotent and won't double-fire 'close' (the close
    // handler runs at most once per socket instance).
    if (!isCurrent()) return;
    try { ws.terminate(); } catch {}
  });
}

export async function startStreamer(_token?: string, symbols?: string[]): Promise<void> {
  if (symbols?.length) {
    for (const s of symbols) {
      subscribedSymbols.add(prepareEquitySubscribeFromCaller(s));
    }
  }

  if (!getValidAccessToken("trader")) {
    logger.warn("Schwab streamer: no valid token — will connect when tokens become available");
    return;
  }

  await connectSchwabStreamer();
}

let quoteSummaryTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  if (connectionState !== "connected") return;
  const equityKeys: string[] = [];
  const futuresKeys: string[] = [];
  let withLast = 0;
  for (const [key, q] of quoteCache.entries()) {
    if (key.startsWith("/")) futuresKeys.push(key);
    else equityKeys.push(key);
    if (q.last !== null) withLast++;
  }
  logger.debug({
    total: quoteCache.size,
    withLast,
    equityCount: equityKeys.length,
    futuresCount: futuresKeys.length,
    equityKeys: equityKeys.sort(),
    futuresKeys: futuresKeys.sort(),
  }, "Schwab: quote cache summary");
}, 30_000);

export function stopStreamer() {
  logger.info("Schwab streamer: stopping");
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (quoteSummaryTimer) {
    clearInterval(quoteSummaryTimer);
    quoteSummaryTimer = null;
  }
  if (alertSeenSweepTimer) {
    clearInterval(alertSeenSweepTimer);
    alertSeenSweepTimer = null;
  }
  alertSeenSet.clear();
  if (schwabWs) {
    try { schwabWs.close(); } catch {}
    schwabWs = null;
  }
  connectionState = "disconnected";
  streamerWireSimulatorResetForTests();
  subscribedSymbols.clear();
  subscribedFuturesSymbols.clear();
  subscribedOptionSymbols.clear();
  tuningWatchlistOptionRoots.clear();
  subscribedFuturesOptionSymbols.clear();
  subscribedTimesaleEquitySymbols.clear();
  subscribedChartEquitySymbols.clear();
  subscribedNyseBookSymbols.clear();
  subscribedNasdaqBookSymbols.clear();
  subscribedOptionsBookSymbols.clear();
  deskAddedEquitySymbols.clear();
  deskAddedOptionSymbols.clear();
  deskAddedOptionsBookSymbols.clear();
  clearFuturesDisplayRegistry();
  clearFuturesActiveSymbolCache();
  clearClassShareDisplayRegistry();
  deskEquityL1Owners.clear();
  deskTimesaleEquityOwners.clear();
  deskFuturesL1WireOwners.clear();
  deskTimesaleFuturesWireOwners.clear();
  void import("./desk/deskLiveFlowSubs.js").then((m) => m.deskLiveFlowSubsOnStreamerStop());
  void import("./desk/deskLiveFlowTimesale.js").then((m) => m.deskLiveFlowTimesaleStopDebug());
  acctActivitySubscribed = false;
  consecutivePostLoginFlap1006 = 0;
}

export function addSymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    const normalized = prepareEquitySubscribeFromCaller(s);
    if (!subscribedSymbols.has(normalized)) {
      subscribedSymbols.add(normalized);
      newSyms.push(normalized);
    }
  }

  if (newSyms.length > 0 && connectionState === "connected") {
    sendEquitySubscription([...subscribedSymbols]);
  }
}

export function addFuturesSymbols(displaySymbols: string[]) {
  const newKeys: string[] = [];
  for (const ds of displaySymbols) {
    const isFuture = ds.startsWith("/");
    const normalized = ds.toUpperCase();
    const key = isFuture ? schwabFuturesKey(normalized) : normalized;
    registerFuturesDisplay(key, normalized);
    if (isFuture && isSchwabFuturesContractSymbol(normalized)) {
      registerFuturesDisplay(normalized, normalized);
    }
    if (!subscribedFuturesSymbols.has(key)) {
      subscribedFuturesSymbols.add(key);
      newKeys.push(key);
    }
  }

  if (newKeys.length > 0) {
    logger.info({ count: newKeys.length, sample: newKeys.slice(0, 5).join(",") }, "Schwab streamer: futures display→key mapping built");
    if (connectionState === "connected") {
      sendFuturesSubscription([...subscribedFuturesSymbols]);
    }
  }
}

const STRATEGIST_OPTIONS_HOLD = "strategist:underlyings";
const STREAM_HTTP_OPTIONS_HOLD = "stream:http-options";
const TUNING_WATCHLIST_HOLD = "tuning:watchlist-options";
const OPTIONS_BOOK_APP_HOLD = "app:options-book";

export function addOptionSymbols(symbols: string[], holderId?: string) {
  const cleaned = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  if (!cleaned.length) return;
  const id = holderId ?? STRATEGIST_OPTIONS_HOLD;
  const tier = streamerSubInferHoldTier(id);
  if (id === STRATEGIST_OPTIONS_HOLD) {
    streamerSubMergeHold(id, tier, "LEVELONE_OPTIONS", cleaned);
  } else {
    streamerSubReplaceHold(id, tier, "LEVELONE_OPTIONS", cleaned);
  }
  streamerSubScheduleManagedOptionsWire();
}

function managedSetsEqual(next: Set<string>, prev: Set<string>): boolean {
  if (next.size !== prev.size) return false;
  for (const s of next) {
    if (!prev.has(s)) return false;
  }
  return true;
}

export function replaceManagedLevelOneOptionSubscriptions(plan: string[]): void {
  const next = new Set(plan.map((s) => s.trim()).filter(Boolean));
  if (managedSetsEqual(next, subscribedOptionSymbols)) return;
  const prev = [...subscribedOptionSymbols];
  subscribedOptionSymbols.clear();
  for (const s of next) subscribedOptionSymbols.add(s);
  if (connectionState === "connected") {
    if (next.size === 0) {
      if (prev.length > 0) sendLevelOneOptionsUnsubs(prev);
    } else {
      sendOptionSubscription([...next], { replayDesk: false });
    }
    deskStreamerReplayDeskAfterAppLevelOneSub();
    noteWireLevelOneOptionsPeak();
  }
  streamerSubNotifyAppPlanWired([...next]);
}

export function replaceManagedOptionsBookSubscriptions(plan: string[]): void {
  const next = new Set(plan.map((s) => s.trim()).filter(Boolean));
  if (managedSetsEqual(next, subscribedOptionsBookSymbols)) return;
  const prev = [...subscribedOptionsBookSymbols];
  subscribedOptionsBookSymbols.clear();
  for (const s of next) subscribedOptionsBookSymbols.add(s);
  if (connectionState === "connected") {
    if (next.size === 0) {
      if (prev.length > 0) sendOptionsBookUnsubs(prev);
    } else {
      sendOptionsBookSubscription([...next], { replayDesk: false });
    }
    deskStreamerReplayDeskAfterAppOptionsBookSub();
  }
}

export function removeOptionSymbols(symbols: string[]) {
  const cleaned = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  if (!cleaned.length) return;
  let changed = false;
  for (const s of cleaned) {
    if (subscribedOptionSymbols.delete(s)) changed = true;
  }
  if (changed && connectionState === "connected") {
    sendOptionSubscription([...subscribedOptionSymbols], { replayDesk: false });
    deskStreamerReplayDeskAfterAppLevelOneSub();
    streamerSubNotifyAppPlanWired([...subscribedOptionSymbols]);
  }
}

/** Whether an equity/index symbol currently has a streaming L1 last. */
export function schwabSymbolHasStreamingMark(apiSymbol: string): boolean {
  const snap = getQuoteBySymbol(apiSymbol);
  return snap != null && snap.last != null;
}

/**
 * Replace LEVELONE_OPTIONS underlyings owned by the tuning watchlist selector.
 * Does not remove option roots subscribed from other pathways (e.g. client WS).
 */
export function setTuningWatchlistOptionUnderlyings(symbols: string[]): void {
  const next = [...new Set(symbols.map((s) => s.replace(/^\$/, "").toUpperCase()))];
  tuningWatchlistOptionRoots.clear();
  for (const s of next) tuningWatchlistOptionRoots.add(s);
  streamerSubReplaceHold(TUNING_WATCHLIST_HOLD, "user_visible", "LEVELONE_OPTIONS", next);
  streamerSubScheduleManagedOptionsWire();
  logger.info(
    { count: next.length, sample: next.slice(0, 8).join(",") },
    "Schwab streamer: tuning watchlist LEVELONE_OPTIONS refresh",
  );
}

export function addFuturesOptionSymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    if (!subscribedFuturesOptionSymbols.has(s)) {
      subscribedFuturesOptionSymbols.add(s);
      newSyms.push(s);
    }
  }

  if (newSyms.length > 0 && connectionState === "connected") {
    sendFuturesOptionSubscription([...subscribedFuturesOptionSymbols]);
  }
}

export function addTimesaleEquitySymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    const normalized = equityStreamKeyFromCaller(s);
    if (!subscribedTimesaleEquitySymbols.has(normalized)) {
      subscribedTimesaleEquitySymbols.add(normalized);
      newSyms.push(normalized);
    }
  }
  if (newSyms.length > 0 && connectionState === "connected") {
    sendTimesaleEquitySubscription([...subscribedTimesaleEquitySymbols]);
  }
}

/** Subscribe strategist symbols to CHART_EQUITY (1-minute bars; RSI fallback vs TIMESALE aggregation). */
export function addChartEquitySymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    const normalized = equityStreamKeyFromCaller(s);
    if (!subscribedChartEquitySymbols.has(normalized)) {
      subscribedChartEquitySymbols.add(normalized);
      newSyms.push(normalized);
    }
  }
  if (newSyms.length > 0 && connectionState === "connected") {
    sendChartEquitySubscription([...subscribedChartEquitySymbols]);
  }
}

export function addNyseBookSymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    const normalized = equityStreamKeyFromCaller(s);
    if (!subscribedNyseBookSymbols.has(normalized)) {
      subscribedNyseBookSymbols.add(normalized);
      newSyms.push(normalized);
    }
  }
  if (newSyms.length > 0 && connectionState === "connected") {
    sendNyseBookSubscription([...subscribedNyseBookSymbols]);
  }
}

export function addNasdaqBookSymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    const normalized = equityStreamKeyFromCaller(s);
    if (!subscribedNasdaqBookSymbols.has(normalized)) {
      subscribedNasdaqBookSymbols.add(normalized);
      newSyms.push(normalized);
    }
  }
  if (newSyms.length > 0 && connectionState === "connected") {
    sendNasdaqBookSubscription([...subscribedNasdaqBookSymbols]);
  }
}

/** On-demand OPTIONS_BOOK keys (OCC / Schwab option keys). Full replacement SUBS like other services. */
export function addOptionsBookSymbols(symbols: string[], holderId?: string) {
  const cleaned = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  if (!cleaned.length) return;
  streamerSubReplaceHold(holderId ?? OPTIONS_BOOK_APP_HOLD, "user_visible", "OPTIONS_BOOK", cleaned);
  streamerSubScheduleManagedOptionsBookWire();
}

export function onTokenRefreshed() {
  if (connectionState === "disconnected" && (subscribedSymbols.size > 0 || subscribedFuturesSymbols.size > 0)) {
    logger.info({ equityCount: subscribedSymbols.size, futuresCount: subscribedFuturesSymbols.size }, "Schwab streamer: token refreshed — attempting connection");
    void connectSchwabStreamer();
  }
}

/** Vitest: prime streamer WS + LOGIN context so desk wire calls emit requests. */
export function __deskStreamerWireTestPrime(): void {
  streamerInfo = {
    schwabClientCustomerId: "wire-test-customer",
    schwabClientCorrelId: "wire-test-correl",
    schwabClientChannel: "N9",
    schwabClientFunctionId: "APIAPP",
    streamerSocketUrl: "wss://streamer-wire-test.example/ws",
  };
  schwabWs = { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
  connectionState = "connected";
}

export function __deskStreamerWireTestUnprime(): void {
  __deskStreamerSetWireTap(null);
  stopStreamer();
  streamerInfo = null;
  schwabWs = null;
}

/** Vitest: reset futures quote registry + cache without tearing down the whole streamer. */
export function __schwabFuturesStreamerTestReset(): void {
  clearFuturesDisplayRegistry();
  clearFuturesActiveSymbolCache();
  clearClassShareDisplayRegistry();
  for (const key of [...quoteCache.keys()]) {
    if (key.startsWith("/")) quoteCache.delete(key);
  }
}

export function __schwabFuturesProcessTickForTests(content: Record<string, unknown>[]): void {
  processFuturesTick(content);
}

export function __schwabClassShareTestReset(): void {
  clearClassShareDisplayRegistry();
  for (const key of [...quoteCache.keys()]) {
    if (isClassShareSymbol(key)) quoteCache.delete(key);
  }
}

export function __schwabEquityProcessTickForTests(content: Record<string, unknown>[]): void {
  processEquityTick(content);
}

registerDeskStreamerHealthReaders(getStreamerStatus, isConnected);

streamerSubSetUnderlyingSpotResolver((root) => {
  const normalized = root.replace(/^\$/, "").toUpperCase();
  const snap = getQuoteBySymbol(normalized) ?? getQuoteBySymbol(`$${normalized}`);
  const last = snap?.last ?? snap?.regularLast ?? null;
  return last != null && Number.isFinite(last) ? last : null;
});

setSchwabIndexStreamFreshCheck((sym, now = Date.now()) => {
  const snap = getQuoteBySymbol(sym);
  const ts = snap?.ts ?? null;
  const schwabSourced = snap?.quoteSource === "SCHWAB" || snap?.quoteSource === undefined;
  return {
    fresh: schwabSourced && ts != null && now - ts <= SCHWAB_INDEX_STREAM_FRESH_MS,
    lastStreamMs: ts,
  };
});
