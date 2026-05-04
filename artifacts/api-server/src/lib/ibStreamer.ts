import { IBApi, EventName, Contract, SecType, type TickType } from "@stoqey/ib";
import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";
import { emitTelemetry } from "./telemetryStore.js";
import type { LiveQuote } from "./schwabStreamer.js";
import { getEnabledSymbols, type IBSymbolDef } from "./ibBreadthSymbols.js";
import { IMBALANCE_REQID_TO_SYMBOL, IMBALANCE_SYMBOLS, IMBALANCE_REQ_ID_BASE } from "./ibImbalanceSymbols.js";
import { enqueueImbalancePersist } from "./ibImbalancePersistence.js";
import { ES_DEPTH_SYMBOL_DEF, ES_DEPTH_REQ_ID } from "./ibEsDepthSymbols.js";
import { CBOE_ONE_EXCHANGE } from "./ibCboeOneSymbols.js";
import {
  dynamicCboeOneSymbolForReqId,
  dynamicTotalviewSymbolForReqId,
  isDynamicCboeOneReqId,
  isDynamicTotalviewReqId,
  markDynamicIbPoolSlotEntitlementFailed,
  registerIbDynamicPoolHandlers,
  resubscribeAllDynamicIbPools,
  startIbDynamicPoolSweeper,
  startIbDynamicPoolUtilizationLogger,
  stopIbDynamicPoolTimers,
  teardownDynamicIbPools,
  getDynamicIbPoolsStatus,
} from "./ibDynamicSubscriptionManager.js";
import { enqueueTotalviewPersist, type NasdaqTotalviewSummaryPayload } from "./ibTotalviewPersistence.js";
import { enqueueEsDepthPersist, type EsDepthSummaryPayload } from "./ibEsDepthPersistence.js";
import { injectExternalQuote, injectCboeOneConsolidatedQuote } from "./schwabStreamer.js";

export type { IBSymbolDef } from "./ibBreadthSymbols.js";

/** Generic tick list id 225 — auction volume / price / imbalance / regulatory (IBKR TWS API tick types). */
const GENERIC_TICK_IMBALANCE = "225";

const IMB_TT = {
  AUCTION_VOLUME: 34,
  AUCTION_PRICE: 35,
  AUCTION_IMBALANCE: 36,
  REGULATORY_IMBALANCE: 61,
} as const;

/** Latest NYSE closing-imbalance fields per symbol (from generic tick 225 stream). */
export interface IbImbalanceState {
  imbalanceShares: bigint | null;
  indicativePrice: number | null;
  pairedShares: bigint | null;
  regulatoryImbalance: bigint | null;
  timestamp: number;
}

const ibImbalanceCache = new Map<string, IbImbalanceState>();

function emptyImbalanceState(): IbImbalanceState {
  return {
    imbalanceShares: null,
    indicativePrice: null,
    pairedShares: null,
    regulatoryImbalance: null,
    timestamp: Date.now(),
  };
}

function getOrCreateImbalanceState(symbol: string): IbImbalanceState {
  let s = ibImbalanceCache.get(symbol);
  if (!s) {
    s = emptyImbalanceState();
    ibImbalanceCache.set(symbol, s);
  }
  return s;
}

function emitImbalanceUpdate(symbol: string, state: IbImbalanceState): void {
  state.timestamp = Date.now();
  ibImbalanceCache.set(symbol, { ...state });
  const snap = { ...state, symbol };
  if (broadcastFn) {
    broadcastFn("nyseImbalance", snap);
  }
  enqueueImbalancePersist(symbol, state);
}

export function getIbImbalanceSnapshotForSymbol(symbol: string): IbImbalanceState | null {
  const s = ibImbalanceCache.get(symbol.toUpperCase());
  return s ? { ...s } : null;
}

export function getIbImbalanceSubscriptionCount(): number {
  return IMBALANCE_SYMBOLS.length;
}

export interface DepthRow {
  price: number;
  size: number;
  mm: string;
}

export interface DepthBook {
  symbol: string;
  bids: DepthRow[];
  asks: DepthRow[];
  ts: number;
}

const DEPTH_SYMBOLS = [
  { symbol: "/NQ",  ibSymbol: "NQ",  secType: "FUT", exchange: "CME",   category: "FUTURES" },
  { symbol: "SPY",  ibSymbol: "SPY", secType: "STK", exchange: "SMART", category: "EQUITY" },
];

const DEPTH_NUM_ROWS = 10;
const DEPTH_REQ_ID_BASE = 6000;
const DEPTH_THROTTLE_MS = 250;

const depthReqIdToSymbol = new Map<number, string>();
/** Smart depth flag per reqId (required for cancelMktDepth). */
const depthReqSmartDepth = new Map<number, boolean>();
const depthBooks = new Map<string, { bids: DepthRow[]; asks: DepthRow[] }>();
const depthDirty = new Set<string>();
let depthThrottleTimer: ReturnType<typeof setInterval> | null = null;

const dynamicDepthSymbols = new Map<string, { reqId: number; contract: Contract; isSmartDepth: boolean }>();
let dynamicDepthReqCounter = 6500;

const dynamicQuoteSymbols = new Map<string, number>(); // symbol → reqId
const dynamicQuoteReqIdToSymbol = new Map<number, string>(); // reqId → symbol
const dynamicQuoteInsertOrder: string[] = []; // LRU order (oldest first)
let dynamicQuoteReqCounter = 7000;
const MAX_DYNAMIC_QUOTE_SLOTS = 95;

/** reqIds that returned IB error 101 (missing market data permissions) — skip on reconnect until process restart. */
const skippedMarketDataReqIds = new Set<number>();

const TOTALVIEW_DEPTH_ROWS = 5;
const ES_DEPTH_ROWS = 5;
const TOTALVIEW_BOOK_PREFIX = "TV:";

/** In-memory latest TotalView summary per symbol (for strategist cold-start before DB flush). */
const totalviewSummaryMemCache = new Map<string, NasdaqTotalviewSummaryPayload>();
const cboeOneLastTickAtBySymbol = new Map<string, number>();

const permanentSymbolSet = new Set<string>();

export function registerPermanentSymbols(symbols: string[]): void {
  for (const s of symbols) permanentSymbolSet.add(s.toUpperCase());
}

const ibCompanyNames = new Map<string, string>(); // symbol → long name

export function getIBCompanyName(symbol: string): string | null {
  return ibCompanyNames.get(symbol.toUpperCase()) ?? null;
}

export interface IBNewsHeadline {
  time: string;
  providerCode: string;
  articleId: string;
  headline: string;
  extraData?: string;
  source: "historical" | "live";
}

const ibNewsProviders: string[] = [];
const ibLiveNews: IBNewsHeadline[] = [];
const MAX_LIVE_NEWS = 200;

const TT = {
  BID: 1, ASK: 2, LAST: 4, HIGH: 6, LOW: 7, VOLUME: 8, CLOSE: 9,
  BID_SIZE: 0, ASK_SIZE: 3,
  DELAYED_BID: 66, DELAYED_ASK: 67, DELAYED_LAST: 68,
  DELAYED_BID_SIZE: 69, DELAYED_ASK_SIZE: 70,
  DELAYED_HIGH: 72, DELAYED_LOW: 73, DELAYED_VOLUME: 74, DELAYED_CLOSE: 75,
} as const;

function parseGatewayUrl(): { host: string; port: number; wsUrl: string | null } {
  const raw = process.env.IBKR_GATEWAY_URL || process.env.IB_HOST;
  if (!raw) return { host: "127.0.0.1", port: 4001, wsUrl: null };
  try {
    const url = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    if (url.protocol === "https:" || url.protocol === "wss:") {
      const wsTarget = `wss://${url.hostname}${url.port ? ":" + url.port : ""}${url.pathname || "/"}`;
      return { host: "127.0.0.1", port: 4001, wsUrl: wsTarget };
    }
    if (url.protocol === "http:" || url.protocol === "ws:") {
      const wsTarget = `ws://${url.hostname}${url.port ? ":" + url.port : ""}${url.pathname || "/"}`;
      return { host: "127.0.0.1", port: 4001, wsUrl: wsTarget };
    }
    const host = url.hostname || "127.0.0.1";
    const port = url.port ? Number(url.port) : 4001;
    return { host, port, wsUrl: null };
  } catch {
    return { host: raw, port: Number(process.env.IB_PORT ?? "4001"), wsUrl: null };
  }
}

export function getWsBridgeUrl(): string | null {
  return parseGatewayUrl().wsUrl;
}

const { host: IB_HOST, port: IB_PORT } = parseGatewayUrl();
const IB_CLIENT_ID = Number(process.env.IB_CLIENT_ID ?? "1");

const RECONNECT_INTERVAL_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

// Active client ID rotates when a 326 (already-in-use) conflict is detected.
// Slots IB_CLIENT_ID through IB_CLIENT_ID+9 are available.
let activeClientId = IB_CLIENT_ID;

type ConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

const BREADTH_SYMBOLS: IBSymbolDef[] = getEnabledSymbols();

const reqIdToSymbol = new Map<number, IBSymbolDef>();
for (const def of BREADTH_SYMBOLS) {
  reqIdToSymbol.set(def.reqId, def);
}

interface IBQuoteState {
  last: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change: number | null;
  changePct: number | null;
  ts: number;
}

const ibQuoteCache = new Map<string, IBQuoteState>();

let ib: IBApi | null = null;
let connState: ConnectionState = "DISCONNECTED";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_INTERVAL_MS;
let intentionalDisconnect = false;
let reconnectAttempt = 0;
let summaryTimer: ReturnType<typeof setInterval> | null = null;
let broadcastFn: ((event: string, data: unknown) => void) | null = null;
let quoteCacheInjector: ((sym: string, quote: LiveQuote) => void) | null = null;
let connectedAt = 0;
let connectionEpoch = 0;

export function registerIBBroadcast(fn: (event: string, data: unknown) => void) {
  broadcastFn = fn;
}

export function registerQuoteCacheInjector(fn: (sym: string, quote: LiveQuote) => void) {
  quoteCacheInjector = fn;
}

function emitStatus(status: string) {
  if (broadcastFn) {
    broadcastFn("ibStatus", { status });
  }
}

const QUARTERLY_MONTHS = [3, 6, 9, 12];
const BIMONTHLY_MONTHS = [2, 4, 6, 8, 10, 12];

function getFrontMonth(symbol: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  if (symbol === "CL" || symbol === "HG") {
    let m = month + 1;
    let y = year;
    if (m > 12) { m = 1; y++; }
    return y.toString() + String(m).padStart(2, "0");
  }

  if (symbol === "ZQ") {
    let m = month;
    let y = year;
    if (day > 20) { m = month + 1; }
    if (m > 12) { m = 1; y++; }
    return y.toString() + String(m).padStart(2, "0");
  }

  if (symbol === "GC") {
    for (const bm of BIMONTHLY_MONTHS) {
      if (month < bm || (month === bm && day <= 20)) {
        return year.toString() + String(bm).padStart(2, "0");
      }
    }
    return (year + 1).toString() + "02";
  }

  for (const q of QUARTERLY_MONTHS) {
    if (month < q || (month === q && day <= 20)) {
      return year.toString() + String(q).padStart(2, "0");
    }
  }
  return (year + 1).toString() + "03";
}

function setFutureFrontMonth(contract: Contract, ibSymbol: string): void {
  contract.lastTradeDateOrContractMonth = getFrontMonth(ibSymbol);
}

function buildContract(def: IBSymbolDef): Contract {
  const contract: Contract = {
    symbol: def.ibSymbol,
    secType: def.secType as SecType,
    exchange: def.exchange,
    currency: "USD",
  };
  
  if (def.secType === "FUT") {
    setFutureFrontMonth(contract, def.ibSymbol);
  }
  
  return contract;
}

let dynamicIbHandlersRegistered = false;

function ensureDynamicIbHandlersRegistered(): void {
  if (dynamicIbHandlersRegistered) return;
  dynamicIbHandlersRegistered = true;
  registerIbDynamicPoolHandlers({
    onDynamicPoolSlotCleared(_name, reqId) {
      skippedMarketDataReqIds.delete(reqId);
    },
    subscribeTotalview(reqId, symbol) {
      if (!ib || connState !== "CONNECTED") return;
      if (skippedMarketDataReqIds.has(reqId)) return;
      const bookKey = `${TOTALVIEW_BOOK_PREFIX}${symbol}`;
      depthReqIdToSymbol.set(reqId, bookKey);
      depthReqSmartDepth.set(reqId, false);
      depthBooks.set(bookKey, { bids: [], asks: [] });
      const contract: Contract = {
        symbol,
        secType: SecType.STK,
        exchange: "NASDAQ",
        currency: "USD",
      };
      try {
        ib.reqMktDepth(reqId, contract, TOTALVIEW_DEPTH_ROWS, false);
      } catch (err) {
        logger.warn({ err, symbol }, "IB: TotalView depth subscribe failed (dynamic)");
      }
    },
    unsubscribeTotalview(reqId) {
      if (!ib) return;
      const bookKey = depthReqIdToSymbol.get(reqId);
      try {
        ib.cancelMktDepth(reqId, false);
      } catch {
        /* ignore */
      }
      depthReqIdToSymbol.delete(reqId);
      depthReqSmartDepth.delete(reqId);
      if (bookKey) depthBooks.delete(bookKey);
    },
    subscribeCboeOne(reqId, symbol) {
      if (!ib || connState !== "CONNECTED") return;
      if (skippedMarketDataReqIds.has(reqId)) return;
      const contract: Contract = {
        symbol,
        secType: SecType.STK,
        exchange: CBOE_ONE_EXCHANGE,
        currency: "USD",
      };
      try {
        ib.reqMktData(reqId, contract, "", false, false);
      } catch (err) {
        logger.warn({ err, symbol }, "IB: Cboe One subscribe failed (dynamic)");
      }
    },
    unsubscribeCboeOne(reqId) {
      if (!ib) return;
      try {
        ib.cancelMktData(reqId);
      } catch {
        /* ignore */
      }
    },
  });
  startIbDynamicPoolSweeper();
  startIbDynamicPoolUtilizationLogger();
}

function emitQuote(def: IBSymbolDef, state: IBQuoteState) {
  let effectiveLast: number | null;
  switch (def.sourceField) {
    case "bid":
      effectiveLast = state.bid;
      break;
    case "ask":
      effectiveLast = state.ask;
      break;
    case "net_bid_ask":
      effectiveLast = (state.bid !== null && state.ask !== null)
        ? state.bid - state.ask
        : null;
      break;
    default:
      effectiveLast = state.last;
      break;
  }
  const quote: LiveQuote = {
    symbol: def.displaySymbol,
    last: effectiveLast,
    regularLast: effectiveLast,
    extendedLast: effectiveLast,
    bid: state.bid,
    ask: state.ask,
    bidSize: state.bidSize,
    askSize: state.askSize,
    change: state.change,
    changePct: state.changePct,
    volume: state.volume,
    high: state.high,
    low: state.low,
    close: state.close,
    ts: state.ts,
    quoteSource: "IBKR_PRO",
  };
  if (quoteCacheInjector) {
    quoteCacheInjector(def.displaySymbol, quote);
  }
}

function emitRawQuote(displaySymbol: string, state: IBQuoteState) {
  const effectiveLast = state.last;
  const quote: LiveQuote = {
    symbol: displaySymbol,
    last: effectiveLast,
    regularLast: effectiveLast,
    extendedLast: effectiveLast,
    bid: state.bid,
    ask: state.ask,
    bidSize: state.bidSize,
    askSize: state.askSize,
    change: state.change,
    changePct: state.changePct,
    volume: state.volume,
    high: state.high,
    low: state.low,
    close: state.close,
    ts: state.ts,
    quoteSource: "IBKR_PRO",
  };
  if (quoteCacheInjector) quoteCacheInjector(displaySymbol, quote);
}

function getOrCreateState(sym: string): IBQuoteState {
  let s = ibQuoteCache.get(sym);
  if (!s) {
    s = {
      last: null, bid: null, ask: null, bidSize: null, askSize: null,
      volume: null, high: null, low: null, close: null,
      change: null, changePct: null, ts: Date.now(),
    };
    ibQuoteCache.set(sym, s);
  }
  return s;
}

function buildImbalanceContract(def: IBSymbolDef): Contract {
  return {
    symbol: def.ibSymbol,
    secType: "STK" as SecType,
    exchange: "NYSE",
    currency: "USD",
  };
}

function subscribeAll() {
  if (!ib) return;
  try {
    ib.reqMarketDataType(1);
    logger.info("IB: requested LIVE market data type (type 1)");
  } catch (err) {
    logger.warn({ err }, "IB: failed to set market data type");
  }

  let permCount = 0;
  for (const def of BREADTH_SYMBOLS) {
    if (!permanentSymbolSet.has(def.displaySymbol)) continue;
    const contract = buildContract(def);
    try {
      ib.reqMktData(def.reqId, contract, "", false, false);
      permCount++;
    } catch (err) {
      logger.warn({ err, symbol: def.displaySymbol }, "IB: failed to subscribe breadth symbol");
    }
  }
  logger.info({ permanent: permCount, registered: permanentSymbolSet.size }, "IB: permanently subscribed indicator symbols at connect");

  subscribeTotalviewEsCboeOne();

  let imbCount = 0;
  for (const def of IMBALANCE_SYMBOLS) {
    if (skippedMarketDataReqIds.has(def.reqId)) continue;
    const contract = buildImbalanceContract(def);
    try {
      ib.reqMktData(def.reqId, contract, GENERIC_TICK_IMBALANCE, false, false);
      imbCount++;
    } catch (err) {
      logger.warn({ err, symbol: def.displaySymbol }, "IB: failed to subscribe NYSE imbalance");
    }
  }
  logger.info({ count: imbCount, reqIdBase: IMBALANCE_REQ_ID_BASE }, "IB: subscribed NYSE imbalance pool (generic tick 225)");

  for (const [symbol, reqId] of dynamicQuoteSymbols) {
    const contract = buildDynamicContract(symbol);
    try {
      ib.reqMktData(reqId, contract, "", false, false);
      logger.info({ symbol, reqId }, "IB: resubscribed dynamic quote after reconnect");
    } catch (err) {
      logger.warn({ err, symbol }, "IB: failed to resubscribe dynamic quote");
    }
  }
  subscribeDepth();
}

function buildDynamicContract(symbol: string): Contract {
  const breadthDef = BREADTH_SYMBOLS.find(d => d.displaySymbol === symbol);
  if (breadthDef) return buildContract(breadthDef);

  const isFut = symbol.startsWith("/");
  const isIdx = symbol.startsWith("$");
  const ibSym = symbol.replace(/^[\/$]/, "");
  const FUT_EXCHANGE: Record<string, string> = {};
  const contract: Contract = {
    symbol: ibSym,
    secType: (isFut ? "FUT" : isIdx ? "IND" : "STK") as SecType,
    exchange: isFut ? (FUT_EXCHANGE[ibSym] ?? "CME") : "SMART",
    currency: isFut && FUT_EXCHANGE[ibSym] === "IPE" ? "USD" : "USD",
  };
  if (isFut) setFutureFrontMonth(contract, ibSym);
  return contract;
}

function subscribeTotalviewEsCboeOne(): void {
  if (!ib) return;
  ensureDynamicIbHandlersRegistered();
  resubscribeAllDynamicIbPools();

  if (!skippedMarketDataReqIds.has(ES_DEPTH_REQ_ID)) {
    const d = ES_DEPTH_SYMBOL_DEF;
    const contract = buildContract(d);
    depthReqIdToSymbol.set(ES_DEPTH_REQ_ID, "/ES");
    depthReqSmartDepth.set(ES_DEPTH_REQ_ID, false);
    depthBooks.set("/ES", { bids: [], asks: [] });
    try {
      ib.reqMktDepth(ES_DEPTH_REQ_ID, contract, ES_DEPTH_ROWS, false);
      logger.info({ reqId: ES_DEPTH_REQ_ID }, "IB: subscribed ES CME depth");
    } catch (err) {
      logger.warn({ err }, "IB: ES depth subscribe failed");
    }
  }

  logger.info("IB: ES depth + dynamic TotalView/Cboe One pools (re)wired after connect");
}

function sumDepthInBand(
  rows: DepthRow[],
  side: "bid" | "ask",
  mid: number,
  pct: number,
): number {
  if (rows.length === 0 || mid <= 0) return 0;
  const lo = mid * (1 - pct);
  const hi = mid * (1 + pct);
  let sum = 0;
  for (const r of rows) {
    if (r.size <= 0) continue;
    if (side === "bid" && r.price >= lo && r.price <= mid) sum += r.size;
    if (side === "ask" && r.price >= mid && r.price <= hi) sum += r.size;
  }
  return sum;
}

function computeTotalviewSummary(symbol: string, book: { bids: DepthRow[]; asks: DepthRow[] }): NasdaqTotalviewSummaryPayload | null {
  const bids = [...book.bids].sort((a, b) => b.price - a.price);
  const asks = [...book.asks].sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  if (bestBid == null || bestAsk == null) return null;
  const spotMid = (bestBid + bestAsk) / 2;
  if (spotMid <= 0) return null;
  const bidDepth5pct = sumDepthInBand(bids, "bid", spotMid, 0.05);
  const askDepth5pct = sumDepthInBand(asks, "ask", spotMid, 0.05);
  const bidDepth1pct = sumDepthInBand(bids, "bid", spotMid, 0.01);
  const askDepth1pct = sumDepthInBand(asks, "ask", spotMid, 0.01);
  const denom = bidDepth5pct + askDepth5pct;
  const bookImbalanceRatio = denom > 0 ? bidDepth5pct / denom : 0.5;
  const topBidSize = bids[0]?.size ?? 0;
  const topAskSize = asks[0]?.size ?? 0;
  const nowIso = new Date().toISOString();
  return {
    symbol,
    spotMid,
    bidDepth5pct,
    askDepth5pct,
    bidDepth1pct,
    askDepth1pct,
    bookImbalanceRatio,
    topBidSize,
    topAskSize,
    updatedAt: nowIso,
  };
}

function sumEsDepthTicks(rows: DepthRow[], side: "bid" | "ask", mid: number, ticks: number): number {
  const tick = 0.25;
  const band = ticks * tick;
  let sum = 0;
  for (const r of rows) {
    if (r.size <= 0) continue;
    if (side === "bid" && r.price >= mid - band && r.price <= mid) sum += r.size;
    if (side === "ask" && r.price >= mid && r.price <= mid + band) sum += r.size;
  }
  return sum;
}

function computeEsDepthSummary(book: { bids: DepthRow[]; asks: DepthRow[] }): EsDepthSummaryPayload | null {
  const bids = [...book.bids].sort((a, b) => b.price - a.price);
  const asks = [...book.asks].sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  if (bestBid == null || bestAsk == null) return null;
  const midPrice = (bestBid + bestAsk) / 2;
  const bidDepth5ticks = sumEsDepthTicks(bids, "bid", midPrice, 5);
  const askDepth5ticks = sumEsDepthTicks(asks, "ask", midPrice, 5);
  const bidDepth1tick = sumEsDepthTicks(bids, "bid", midPrice, 1);
  const askDepth1tick = sumEsDepthTicks(asks, "ask", midPrice, 1);
  const denom = bidDepth5ticks + askDepth5ticks;
  const bookImbalanceRatio = denom > 0 ? bidDepth5ticks / denom : 0.5;
  const contractMonth = getFrontMonth("ES");
  return {
    symbol: "ES",
    contractMonth,
    midPrice,
    bidDepth5ticks,
    askDepth5ticks,
    bidDepth1tick,
    askDepth1tick,
    bookImbalanceRatio,
    topBidSize: bids[0]?.size ?? 0,
    topAskSize: asks[0]?.size ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

function subscribeDepth() {
  if (!ib) return;
  for (let i = 0; i < DEPTH_SYMBOLS.length; i++) {
    const d = DEPTH_SYMBOLS[i];
    const reqId = DEPTH_REQ_ID_BASE + i;
    const contract: Contract = {
      symbol: d.ibSymbol,
      secType: d.secType as SecType,
      exchange: d.exchange,
      currency: "USD",
    };
    if (d.secType === "FUT") {
      setFutureFrontMonth(contract, d.ibSymbol);
    }
    const isSmartDepth = d.exchange === "SMART";
    depthReqIdToSymbol.set(reqId, d.symbol);
    depthReqSmartDepth.set(reqId, isSmartDepth);
    depthBooks.set(d.symbol, { bids: [], asks: [] });
    try {
      ib.reqMktDepth(reqId, contract, DEPTH_NUM_ROWS, isSmartDepth);
      logger.info({ symbol: d.symbol, reqId, isSmartDepth }, "IB: subscribed to market depth");
    } catch (err) {
      logger.error({ err, symbol: d.symbol }, "IB: failed to subscribe depth");
    }
  }

  if (!depthThrottleTimer) {
    depthThrottleTimer = setInterval(flushDepthUpdates, DEPTH_THROTTLE_MS);
  }
}

function flushDepthUpdates() {
  if (depthDirty.size === 0 || !broadcastFn) return;
  for (const sym of depthDirty) {
    const book = depthBooks.get(sym);
    if (!book) continue;
    broadcastFn("depth", {
      symbol: sym,
      bids: [...book.bids],
      asks: [...book.asks],
      ts: Date.now(),
    });
  }
  depthDirty.clear();
}

function applyDepthUpdate(reqId: number, position: number, operation: number, side: number, price: number, size: number, mm: string) {
  const sym = depthReqIdToSymbol.get(reqId);
  if (!sym) return;
  let book = depthBooks.get(sym);
  if (!book) {
    book = { bids: [], asks: [] };
    depthBooks.set(sym, book);
  }
  const maxRows = sym.startsWith(TOTALVIEW_BOOK_PREFIX) ? 5 : sym === "/ES" ? ES_DEPTH_ROWS : DEPTH_NUM_ROWS;
  const rows = side === 1 ? book.bids : book.asks;
  const row: DepthRow = { price, size, mm };

  switch (operation) {
    case 0:
      rows.splice(position, 0, row);
      if (rows.length > maxRows) rows.length = maxRows;
      break;
    case 1:
      if (position < rows.length) rows[position] = row;
      break;
    case 2:
      if (position < rows.length) rows.splice(position, 1);
      break;
  }
  if (!sym.startsWith(TOTALVIEW_BOOK_PREFIX)) {
    depthDirty.add(sym);
  }

  if (sym.startsWith(TOTALVIEW_BOOK_PREFIX)) {
    const und = sym.slice(TOTALVIEW_BOOK_PREFIX.length);
    const summary = computeTotalviewSummary(und, book);
    if (summary) {
      totalviewSummaryMemCache.set(und.toUpperCase(), summary);
      enqueueTotalviewPersist(summary);
      if (broadcastFn) broadcastFn("totalviewUpdate", summary);
    }
  } else if (sym === "/ES") {
    const esSummary = computeEsDepthSummary(book);
    if (esSummary) {
      enqueueEsDepthPersist(esSummary);
      if (broadcastFn) broadcastFn("esDepthUpdate", esSummary);
    }
  }
}

function teardownIB() {
  if (ib) {
    for (const def of BREADTH_SYMBOLS) {
      try { ib.cancelMktData(def.reqId); } catch { /* ignore */ }
    }
    teardownDynamicIbPools();
    for (const def of IMBALANCE_SYMBOLS) {
      try { ib.cancelMktData(def.reqId); } catch { /* ignore */ }
    }
    for (const [reqId] of depthReqIdToSymbol) {
      const isSmartDepth = depthReqSmartDepth.get(reqId) ?? false;
      try { ib.cancelMktDepth(reqId, isSmartDepth); } catch { /* ignore */ }
    }
    for (const [, info] of dynamicDepthSymbols) {
      try { ib.cancelMktDepth(info.reqId, info.isSmartDepth); } catch { /* ignore */ }
    }
    for (const [, reqId] of dynamicQuoteSymbols) {
      try { ib.cancelMktData(reqId); } catch { /* ignore */ }
    }
    try { ib.disconnect(); } catch { /* ignore */ }
    ib.removeAllListeners();
    ib = null;
  }
  depthReqIdToSymbol.clear();
  depthReqSmartDepth.clear();
  depthBooks.clear();
  depthDirty.clear();
  dynamicDepthSymbols.clear();
  dynamicQuoteSymbols.clear();
  dynamicQuoteReqIdToSymbol.clear();
  dynamicQuoteInsertOrder.length = 0;
  cboeOneLastTickAtBySymbol.clear();
  totalviewSummaryMemCache.clear();
  ibImbalanceCache.clear();
  if (depthThrottleTimer) {
    clearInterval(depthThrottleTimer);
    depthThrottleTimer = null;
  }
  if (summaryTimer) {
    clearInterval(summaryTimer);
    summaryTimer = null;
  }
  stopIbDynamicPoolTimers();
}

function scheduleReconnect(immediate = false) {
  if (intentionalDisconnect) return;
  if (reconnectTimer) {
    if (immediate) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    } else {
      return;
    }
  }
  reconnectAttempt++;
  const delay = immediate ? 0 : reconnectDelay + Math.random() * 1000;
  logger.info({ attempt: reconnectAttempt, delayMs: Math.round(delay), immediate }, "IB: reconnect scheduled");
  if (immediate) {
    reconnectDelay = RECONNECT_INTERVAL_MS;
    void connectIB();
  } else {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectIB();
    }, delay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
  }
}

function handleDisconnectOrError(immediate = false) {
  teardownIB();
  connState = "DISCONNECTED";
  emitStatus("disconnected");
  scheduleReconnect(immediate);
}

export async function connectIB(): Promise<void> {
  if (connState === "CONNECTING" || connState === "CONNECTED") return;
  intentionalDisconnect = false;
  connState = "CONNECTING";
  emitStatus("connecting");

  teardownIB();
  const thisEpoch = ++connectionEpoch;

  try {
    ib = new IBApi({ host: IB_HOST, port: IB_PORT, clientId: activeClientId });
    logger.info({ host: IB_HOST, port: IB_PORT, clientId: activeClientId, epoch: thisEpoch }, "IB: connecting to gateway");

    let allEventCount = 0;
    ib.on(EventName.all, (...args: unknown[]) => {
      allEventCount++;
      if (allEventCount <= 10) {
        const eventName = typeof args[0] === "string" ? args[0] : "unknown";
        logger.debug({ eventName, argCount: args.length, allEventCount }, "IB: raw event received");
      }
      if (allEventCount === 50) {
        logger.debug({ allEventCount }, "IB: suppressing further raw event logs");
      }
    });

    ib.on(EventName.info, (msg: string, code: number) => {
      if (code === 326) {
        if (thisEpoch !== connectionEpoch) {
          logger.info({ epoch: thisEpoch, currentEpoch: connectionEpoch }, "IB: ignoring stale 326 from old connection epoch");
          return;
        }
        const oldId = activeClientId;
        activeClientId = ((activeClientId - IB_CLIENT_ID + 1) % 10) + IB_CLIENT_ID;
        if (activeClientId === oldId) activeClientId = oldId + 1;
        logger.warn({ oldId, newId: activeClientId, epoch: thisEpoch }, "IB: client ID conflict (326) — rotating client ID, reconnecting in 6s");
        intentionalDisconnect = true;
        teardownIB();
        connState = "DISCONNECTED";
        emitStatus("disconnected");
        intentionalDisconnect = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectIB();
        }, 6_000);
        return;
      }
      logger.info({ msg, code }, "IB: info event");
    });

    ib.on(EventName.marketDataType, (reqId: number, marketDataType: number) => {
      logger.debug({ reqId, marketDataType }, "IB: marketDataType event");
    });

    ib.on(EventName.tickReqParams, (reqId: number, minTick: number, bboExchange: string, snapshotPermissions: number) => {
      const def = reqIdToSymbol.get(reqId);
      logger.debug({ symbol: def?.displaySymbol, reqId, minTick, bboExchange, snapshotPermissions }, "IB: tickReqParams received");
    });

    ib.on(EventName.connected, () => {
      connState = "CONNECTED";
      connectedAt = Date.now();
      reconnectDelay = RECONNECT_INTERVAL_MS;
      logger.info({ host: IB_HOST, port: IB_PORT, clientId: activeClientId, attempt: reconnectAttempt, epoch: thisEpoch }, "IB: connected to gateway");
      emitTelemetry("IBKR", "INFO", "IBKR Gateway connected", { host: IB_HOST, port: IB_PORT, clientId: activeClientId });
      reconnectAttempt = 0;
      emitStatus("connected");
      subscribeAll();
      for (const cb of ibConnectedCallbacks) {
        try { cb(); } catch {}
      }
      try {
        ib!.reqNewsProviders();
        logger.info("IB: requested news providers");
      } catch (err) {
        logger.warn({ err }, "IB: failed to request news providers");
      }
      try {
        ib!.reqNewsBulletins(true);
        logger.info("IB: subscribed to news bulletins");
      } catch (err) {
        logger.warn({ err }, "IB: failed to subscribe news bulletins");
      }
    });

    ib.on(EventName.disconnected, () => {
      const wasConnectedMs = connectedAt ? Date.now() - connectedAt : 0;
      const hadData = ibQuoteCache.size > 0;
      if (wasConnectedMs < 8_000 && !hadData) {
        logger.warn({ wasConnectedMs }, "IB: disconnected shortly after connect with no data — using delayed reconnect");
        void logFailure("IBKR", "WARN", "IBKR Gateway disconnected (rapid, no data)", { host: IB_HOST, port: IB_PORT, wasConnectedMs });
        handleDisconnectOrError(false);
      } else {
        logger.warn("IB: disconnected from gateway — triggering immediate reconnect");
        void logFailure("IBKR", "WARN", "IBKR Gateway disconnected", { host: IB_HOST, port: IB_PORT });
        handleDisconnectOrError(true);
      }
    });

    ib.on(EventName.error, (err: Error, code: number, reqId: number) => {
      if (code === 2104 || code === 2106 || code === 2158 || code === 10167) {
        logger.info({ code, msg: err.message }, "IB: info/status message");
        return;
      }
      if (code === 200 && reqId > 0) {
        const def = reqIdToSymbol.get(reqId);
        const imb = IMBALANCE_REQID_TO_SYMBOL.get(reqId);
        logger.warn(
          { code, reqId, symbol: def?.ibSymbol ?? imb, msg: err.message },
          "IB: no security definition",
        );
        return;
      }

      if (code === 101 && reqId > 0) {
        if (IMBALANCE_REQID_TO_SYMBOL.has(reqId)) {
          skippedMarketDataReqIds.add(reqId);
          const sym = IMBALANCE_REQID_TO_SYMBOL.get(reqId);
          logger.error(
            { code, reqId, symbol: sym },
            "IB: error 101 — market data subscription missing for NYSE imbalance stream; skipping this reqId until process restart.",
          );
          return;
        }
        if (isDynamicTotalviewReqId(reqId) || reqId === ES_DEPTH_REQ_ID) {
          skippedMarketDataReqIds.add(reqId);
          const sym =
            reqId === ES_DEPTH_REQ_ID
              ? "ES"
              : dynamicTotalviewSymbolForReqId(reqId) ?? String(reqId);
          if (isDynamicTotalviewReqId(reqId)) {
            markDynamicIbPoolSlotEntitlementFailed("totalview", reqId);
          }
          logger.error(
            { code, reqId, symbol: sym },
            "IB: error 101 — market data subscription missing for depth; skipping this reqId until process restart. Enable NASDAQ TotalView / CME depth in IBKR Client Portal.",
          );
          return;
        }
        if (isDynamicCboeOneReqId(reqId)) {
          skippedMarketDataReqIds.add(reqId);
          const sym = dynamicCboeOneSymbolForReqId(reqId) ?? String(reqId);
          markDynamicIbPoolSlotEntitlementFailed("cboeOne", reqId);
          logger.error(
            { code, reqId, symbol: sym },
            "IB: error 101 — market data subscription missing for Cboe One stream; skipping this reqId until process restart. Enable relevant US equity top-of-book subscription in IBKR Client Portal.",
          );
          return;
        }
        if (dynamicQuoteReqIdToSymbol.has(reqId)) {
          const sym = dynamicQuoteReqIdToSymbol.get(reqId);
          if (sym) {
            dynamicQuoteSymbols.delete(sym);
            dynamicQuoteReqIdToSymbol.delete(reqId);
            const idx = dynamicQuoteInsertOrder.indexOf(sym);
            if (idx !== -1) dynamicQuoteInsertOrder.splice(idx, 1);
            logger.warn({ reqId, symbol: sym }, "IB: max tickers — cleaned up failed dynamic sub");
          }
          return;
        }
      }

      if (code === 326) {
        if (thisEpoch !== connectionEpoch) {
          logger.info({ epoch: thisEpoch, currentEpoch: connectionEpoch }, "IB: ignoring stale 326 error from old connection epoch");
          return;
        }
        const oldId = activeClientId;
        activeClientId = ((activeClientId - IB_CLIENT_ID + 1) % 10) + IB_CLIENT_ID;
        if (activeClientId === oldId) activeClientId = oldId + 1;
        logger.warn({ oldId, newId: activeClientId, epoch: thisEpoch }, "IB: client ID conflict (326) — rotating client ID, reconnecting in 6s");
        intentionalDisconnect = true;
        teardownIB();
        connState = "DISCONNECTED";
        emitStatus("disconnected");
        intentionalDisconnect = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectIB();
        }, 6_000);
        return;
      }

      const isImmediateReconnect = code === 2110;
      if (code === 504) {
        logger.warn({ code, msg: err.message }, "IB: transport/connectivity error — delayed reconnect");
        void logFailure("IBKR", "ERROR", `IBKR connection error (code ${code}): ${err.message}`, { code, message: err.message });
        handleDisconnectOrError(false);
        return;
      }
      if (isImmediateReconnect) {
        logger.warn({ code, msg: err.message }, "IB: transport/connectivity error — immediate reconnect");
        void logFailure("IBKR", "ERROR", `IBKR connection error (code ${code}): ${err.message}`, { code, message: err.message });
        handleDisconnectOrError(true);
        return;
      }

      logger.error({ err, code, reqId }, "IB: API error");

      const isTransportError = code === 502 || code === 1100 ||
        (err.message && (err.message.includes("ECONNREFUSED") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT")));

      if (isTransportError) {
        void logFailure("IBKR", "ERROR", `IBKR transport error (code ${code}): ${err.message}`, { code, message: err.message });
        handleDisconnectOrError(false);
      }
    });

    const tickLogCounts = new Map<string, number>();
    ib.on(EventName.tickPrice, (reqId: number, tickType: number, price: number, _attribs: unknown) => {
      if (price === -1) return;

      const imbSym = IMBALANCE_REQID_TO_SYMBOL.get(reqId);
      if (imbSym) {
        if (tickType === IMB_TT.AUCTION_PRICE) {
          const st = getOrCreateImbalanceState(imbSym);
          st.indicativePrice = price;
          emitImbalanceUpdate(imbSym, st);
        }
        return;
      }

      const cboeSym = dynamicCboeOneSymbolForReqId(reqId);
      if (cboeSym) {
        const state = getOrCreateState(`__CBOE1__${cboeSym}`);
        state.ts = Date.now();
        switch (tickType) {
          case TT.BID:
          case TT.DELAYED_BID:
            state.bid = price;
            break;
          case TT.ASK:
          case TT.DELAYED_ASK:
            state.ask = price;
            break;
          case TT.LAST:
          case TT.DELAYED_LAST:
            state.last = price;
            if (state.close !== null && state.close !== 0) {
              state.change = price - state.close;
              state.changePct = (state.change / state.close) * 100;
            }
            break;
          case TT.CLOSE:
          case TT.DELAYED_CLOSE:
            state.close = price;
            if (state.last !== null && price !== 0) {
              state.change = state.last - price;
              state.changePct = (state.change / price) * 100;
            }
            break;
          default:
            return;
        }
        const b = state.bid;
        const a = state.ask;
        if (b !== null && a !== null) {
          const mid = (b + a) / 2;
          const q: LiveQuote = {
            symbol: cboeSym,
            last: state.last ?? mid,
            regularLast: state.last ?? mid,
            extendedLast: state.last ?? mid,
            bid: b,
            ask: a,
            bidSize: state.bidSize,
            askSize: state.askSize,
            change: state.change,
            changePct: state.changePct,
            volume: state.volume,
            high: state.high,
            low: state.low,
            close: state.close,
            ts: state.ts,
          };
          injectCboeOneConsolidatedQuote(cboeSym, q);
          cboeOneLastTickAtBySymbol.set(cboeSym.toUpperCase(), state.ts);
        }
        return;
      }

      const def = reqIdToSymbol.get(reqId);
      const dynSym = def ? null : dynamicQuoteReqIdToSymbol.get(reqId);
      if (!def && !dynSym) return;

      const displaySymbol = def ? def.displaySymbol : dynSym!;
      const cnt = (tickLogCounts.get(displaySymbol) ?? 0) + 1;
      tickLogCounts.set(displaySymbol, cnt);
      if (cnt <= 3) {
        logger.debug({ symbol: displaySymbol, tickType, price }, "IB: tickPrice received");
      }

      const state = getOrCreateState(displaySymbol);
      state.ts = Date.now();

      switch (tickType) {
        case TT.LAST:
        case TT.DELAYED_LAST:
          state.last = price;
          if (state.close !== null && state.close !== 0) {
            state.change = price - state.close;
            state.changePct = (state.change / state.close) * 100;
          }
          break;
        case TT.BID:
        case TT.DELAYED_BID:
          state.bid = price;
          break;
        case TT.ASK:
        case TT.DELAYED_ASK:
          state.ask = price;
          break;
        case TT.HIGH:
        case TT.DELAYED_HIGH:
          state.high = price;
          break;
        case TT.LOW:
        case TT.DELAYED_LOW:
          state.low = price;
          break;
        case TT.CLOSE:
        case TT.DELAYED_CLOSE:
          state.close = price;
          if (state.last !== null && price !== 0) {
            state.change = state.last - price;
            state.changePct = (state.change / price) * 100;
          }
          break;
        default:
          return;
      }

      if (def) {
        emitQuote(def, state);
      } else {
        emitRawQuote(displaySymbol, state);
      }
    });

    ib.on(EventName.tickSize, (reqId: number, tickType?: TickType, size?: number) => {
      if (size == null || size === -1) return;
      if (tickType == null) return;

      const imbSym = IMBALANCE_REQID_TO_SYMBOL.get(reqId);
      if (imbSym) {
        const st = getOrCreateImbalanceState(imbSym);
        const bi = BigInt(Math.trunc(size));
        if (tickType === IMB_TT.AUCTION_VOLUME) {
          st.pairedShares = bi;
        } else if (tickType === IMB_TT.AUCTION_IMBALANCE) {
          st.imbalanceShares = bi;
        } else if (tickType === IMB_TT.REGULATORY_IMBALANCE) {
          st.regulatoryImbalance = bi;
        } else {
          return;
        }
        emitImbalanceUpdate(imbSym, st);
        return;
      }

      const cboeSym = dynamicCboeOneSymbolForReqId(reqId);
      if (cboeSym) {
        const state = getOrCreateState(`__CBOE1__${cboeSym}`);
        state.ts = Date.now();
        switch (tickType) {
          case TT.BID_SIZE:
          case TT.DELAYED_BID_SIZE:
            state.bidSize = size;
            break;
          case TT.ASK_SIZE:
          case TT.DELAYED_ASK_SIZE:
            state.askSize = size;
            break;
          case TT.VOLUME:
          case TT.DELAYED_VOLUME:
            state.volume = size;
            break;
          default:
            return;
        }
        const b = state.bid;
        const a = state.ask;
        if (b !== null && a !== null) {
          const mid = (b + a) / 2;
          const q: LiveQuote = {
            symbol: cboeSym,
            last: state.last ?? mid,
            regularLast: state.last ?? mid,
            extendedLast: state.last ?? mid,
            bid: b,
            ask: a,
            bidSize: state.bidSize,
            askSize: state.askSize,
            change: state.change,
            changePct: state.changePct,
            volume: state.volume,
            high: state.high,
            low: state.low,
            close: state.close,
            ts: state.ts,
          };
          injectCboeOneConsolidatedQuote(cboeSym, q);
          cboeOneLastTickAtBySymbol.set(cboeSym.toUpperCase(), state.ts);
        }
        return;
      }

      const def = reqIdToSymbol.get(reqId);
      const dynSym = def ? null : dynamicQuoteReqIdToSymbol.get(reqId);
      if (!def && !dynSym) return;

      const displaySymbol = def ? def.displaySymbol : dynSym!;
      const state = getOrCreateState(displaySymbol);
      state.ts = Date.now();

      switch (tickType) {
        case TT.BID_SIZE:
        case TT.DELAYED_BID_SIZE:
          state.bidSize = size;
          break;
        case TT.ASK_SIZE:
        case TT.DELAYED_ASK_SIZE:
          state.askSize = size;
          break;
        case TT.VOLUME:
        case TT.DELAYED_VOLUME:
          state.volume = size;
          break;
        default:
          return;
      }

      if (def) {
        emitQuote(def, state);
      } else {
        emitRawQuote(displaySymbol, state);
      }
    });

    ib.on(EventName.tickString, (reqId: number, tickType: number, value: string) => {
      const def = reqIdToSymbol.get(reqId);
      if (!def) return;
      const cnt = (tickLogCounts.get(def.displaySymbol + "_str") ?? 0) + 1;
      tickLogCounts.set(def.displaySymbol + "_str", cnt);
      if (cnt <= 2) {
        logger.debug({ symbol: def.displaySymbol, tickType, value }, "IB: tickString received");
      }
    });

    ib.on(EventName.tickGeneric, (reqId: number, tickType: number, value: number) => {
      const def = reqIdToSymbol.get(reqId);
      if (!def) return;
      const cnt = (tickLogCounts.get(def.displaySymbol + "_gen") ?? 0) + 1;
      tickLogCounts.set(def.displaySymbol + "_gen", cnt);
      if (cnt <= 2) {
        logger.debug({ symbol: def.displaySymbol, tickType, value }, "IB: tickGeneric received");
      }
    });

    ib.on(EventName.updateMktDepth, (reqId: number, position: number, operation: number, side: number, price: number, size: number) => {
      applyDepthUpdate(reqId, position, operation, side, price, size, "");
    });

    ib.on(EventName.updateMktDepthL2, (reqId: number, position: number, marketMaker: string, operation: number, side: number, price: number, size: number) => {
      applyDepthUpdate(reqId, position, operation, side, price, size, marketMaker);
    });

    ib.on(EventName.newsProviders, (providers: any[]) => {
      ibNewsProviders.length = 0;
      for (const p of providers) {
        const code = p.providerCode ?? p.code ?? String(p);
        ibNewsProviders.push(code);
      }
      logger.info({ providers: ibNewsProviders }, "IB: news providers received");
    });

    ib.on(EventName.tickNews, (_reqId: number, timeStamp: number, providerCode: string, articleId: string, headline: string, extraData: string) => {
      const item: IBNewsHeadline = {
        time: new Date(timeStamp).toISOString(),
        providerCode,
        articleId,
        headline,
        extraData: extraData || undefined,
        source: "live",
      };
      ibLiveNews.unshift(item);
      if (ibLiveNews.length > MAX_LIVE_NEWS) ibLiveNews.length = MAX_LIVE_NEWS;
      logger.info({ providerCode, headline: headline.substring(0, 80) }, "IB: live news tick");
      if (broadcastFn) {
        broadcastFn("ibNews", item);
      }
    });

    ib.on(EventName.updateNewsBulletin, (msgId: number, msgType: number, newsMessage: string, originExch: string) => {
      logger.info({ msgId, msgType, originExch, msg: newsMessage.substring(0, 100) }, "IB: news bulletin");
      const item: IBNewsHeadline = {
        time: new Date().toISOString(),
        providerCode: `BULLETIN:${originExch}`,
        articleId: `bulletin-${msgId}`,
        headline: newsMessage,
        source: "live",
      };
      ibLiveNews.unshift(item);
      if (ibLiveNews.length > MAX_LIVE_NEWS) ibLiveNews.length = MAX_LIVE_NEWS;
      if (broadcastFn) {
        broadcastFn("ibNews", item);
      }
    });

    const historicalNewsBuffer = new Map<number, IBNewsHeadline[]>();

    ib.on(EventName.historicalNews, (reqId: number, time: string, providerCode: string, articleId: string, headline: string) => {
      if (!historicalNewsBuffer.has(reqId)) historicalNewsBuffer.set(reqId, []);
      historicalNewsBuffer.get(reqId)!.push({
        time,
        providerCode,
        articleId,
        headline,
        source: "historical",
      });
    });

    ib.on(EventName.historicalNewsEnd, (reqId: number, hasMore: boolean) => {
      const items = historicalNewsBuffer.get(reqId) || [];
      historicalNewsBuffer.delete(reqId);
      logger.info({ reqId, count: items.length, hasMore }, "IB: historical news batch complete");
      const resolver = historicalNewsResolvers.get(reqId);
      if (resolver) {
        resolver(items);
        historicalNewsResolvers.delete(reqId);
      }
    });

    ib.on(EventName.newsArticle, (reqId: number, articleType: number, articleText: string) => {
      logger.info({ reqId, articleType, length: articleText.length }, "IB: news article received");
      const resolver = articleResolvers.get(reqId);
      if (resolver) {
        resolver({ articleType, articleText });
        articleResolvers.delete(reqId);
      }
    });

    let lastBreadthTickAt = Date.now();
    const breadthSymSet = new Set(BREADTH_SYMBOLS.map(d => d.displaySymbol));

    if (summaryTimer) {
      clearInterval(summaryTimer);
      summaryTimer = null;
    }
    summaryTimer = setInterval(() => {
      if (connState !== "CONNECTED") return;
      const symsWithData: string[] = [];
      for (const [sym, state] of ibQuoteCache.entries()) {
        if (state.last !== null || state.bid !== null || state.close !== null) {
          symsWithData.push(sym);
        }
        if (breadthSymSet.has(sym) && state.ts > lastBreadthTickAt) {
          lastBreadthTickAt = state.ts;
        }
      }
      logger.debug({ total: ibQuoteCache.size, withData: symsWithData.length }, "IB: quote cache summary");

      const now = new Date();
      const etHour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
      const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
      const isMarketHours = dayOfWeek >= 1 && dayOfWeek <= 5 && etHour >= 9 && etHour < 16;
      const staleSec = Math.round((Date.now() - lastBreadthTickAt) / 1000);
      if (isMarketHours && staleSec > 600) {
        void logFailure("IBKR", "WARN", `Breadth/PCR data stale for ${staleSec}s during market hours`, { lastBreadthTickAt, staleSec });
      }
    }, 30_000);

    ib.connect();
  } catch (err) {
    logger.warn({ err }, "IB: connection attempt failed");
    void logFailure("IBKR", "ERROR", `IBKR connection attempt failed: ${String(err)}`, { error: String(err) });
    connState = "DISCONNECTED";
    emitStatus("disconnected");
    scheduleReconnect();
  }
}

const historicalNewsResolvers = new Map<number, (items: IBNewsHeadline[]) => void>();
const articleResolvers = new Map<number, (data: { articleType: number; articleText: string }) => void>();
let newsReqIdCounter = 8000;

export function getIBNewsProviders(): string[] {
  return [...ibNewsProviders];
}

export function getIBLiveNews(limit = 50): IBNewsHeadline[] {
  return ibLiveNews.slice(0, limit);
}

export async function fetchIBHistoricalNews(conId: number, providerCodes: string, maxResults = 30): Promise<IBNewsHeadline[]> {
  if (!ib || connState !== "CONNECTED") {
    throw new Error("IB not connected");
  }
  const reqId = newsReqIdCounter++;
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      historicalNewsResolvers.delete(reqId);
      resolve([]);
    }, 10_000);

    historicalNewsResolvers.set(reqId, (items) => {
      clearTimeout(timeout);
      resolve(items);
    });

    try {
      ib!.reqHistoricalNews(reqId, conId, providerCodes, fmt(start), fmt(now), maxResults);
    } catch (err) {
      clearTimeout(timeout);
      historicalNewsResolvers.delete(reqId);
      reject(err);
    }
  });
}

export async function fetchIBNewsArticle(providerCode: string, articleId: string): Promise<{ articleType: number; articleText: string }> {
  if (!ib || connState !== "CONNECTED") {
    throw new Error("IB not connected");
  }
  const reqId = newsReqIdCounter++;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      articleResolvers.delete(reqId);
      reject(new Error("Article fetch timeout"));
    }, 10_000);

    articleResolvers.set(reqId, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });

    try {
      ib!.reqNewsArticle(reqId, providerCode, articleId);
    } catch (err) {
      clearTimeout(timeout);
      articleResolvers.delete(reqId);
      reject(err);
    }
  });
}

export function disconnectIB(): void {
  intentionalDisconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  teardownIB();
  connState = "DISCONNECTED";
  ibQuoteCache.clear();
  cboeOneLastTickAtBySymbol.clear();
  totalviewSummaryMemCache.clear();
  ibImbalanceCache.clear();
  logger.info("IB: disconnected intentionally");
  emitStatus("disconnected");
}

export function getCboeOneFeedDiagnostics(ticker?: string): { present: boolean; latencyMs: number | null } {
  const sym = ticker?.toUpperCase().trim();
  if (sym) {
    const ts = cboeOneLastTickAtBySymbol.get(sym);
    if (ts == null) return { present: false, latencyMs: null };
    return { present: true, latencyMs: Date.now() - ts };
  }
  let newest: number | null = null;
  for (const ts of cboeOneLastTickAtBySymbol.values()) {
    newest = newest == null ? ts : Math.max(newest, ts);
  }
  if (newest == null) return { present: false, latencyMs: null };
  return { present: true, latencyMs: Date.now() - newest };
}

export function getRecentTotalviewSummaryForTicker(ticker: string): NasdaqTotalviewSummaryPayload | null {
  return totalviewSummaryMemCache.get(ticker.toUpperCase()) ?? null;
}

export function getIbDynamicPoolDiagnosticsSnapshot(): {
  totalviewPoolSize: number;
  totalviewPoolCapacity: number;
  cboeOnePoolSize: number;
  cboeOnePoolCapacity: number;
} {
  const st = getDynamicIbPoolsStatus();
  const tv = st.pools.find((p) => p.name === "totalview")!;
  const cb = st.pools.find((p) => p.name === "cboeOne")!;
  return {
    totalviewPoolSize: tv.size,
    totalviewPoolCapacity: tv.capacity,
    cboeOnePoolSize: cb.size,
    cboeOnePoolCapacity: cb.capacity,
  };
}

export function isIBConnected(): boolean {
  return connState === "CONNECTED";
}

function resolveEffectiveLast(def: IBSymbolDef, state: IBQuoteState): number | null {
  switch (def.sourceField) {
    case "bid":
      return state.bid;
    case "ask":
      return state.ask;
    case "net_bid_ask":
      return (state.bid !== null && state.ask !== null) ? state.bid - state.ask : null;
    default:
      return state.last;
  }
}

export function getIBSnapshot(): LiveQuote[] {
  const out: LiveQuote[] = [];
  for (const def of BREADTH_SYMBOLS) {
    const state = ibQuoteCache.get(def.displaySymbol);
    if (state) {
      const effectiveLast = resolveEffectiveLast(def, state);
      out.push({
        symbol: def.displaySymbol,
        last: effectiveLast,
        regularLast: effectiveLast,
        extendedLast: effectiveLast,
        bid: state.bid,
        ask: state.ask,
        bidSize: state.bidSize,
        askSize: state.askSize,
        change: state.change,
        changePct: state.changePct,
        volume: state.volume,
        high: state.high,
        low: state.low,
        close: state.close,
        ts: state.ts,
        quoteSource: "IBKR_PRO",
      });
    }
  }
  return out;
}

export function getIBStatus(): {
  connected: boolean;
  state: ConnectionState;
  host: string;
  port: number;
  symbols: number;
  cachedQuotes: number;
  imbalanceSubscriptions: number;
  imbalanceCacheEntries: number;
} {
  return {
    connected: connState === "CONNECTED",
    state: connState,
    host: IB_HOST,
    port: IB_PORT,
    symbols: BREADTH_SYMBOLS.length,
    cachedQuotes: ibQuoteCache.size,
    imbalanceSubscriptions: IMBALANCE_SYMBOLS.length,
    imbalanceCacheEntries: ibImbalanceCache.size,
  };
}

export function getIBSymbolList(): Array<{ symbol: string; ibSymbol: string; exchange: string }> {
  return BREADTH_SYMBOLS.map(d => ({ symbol: d.displaySymbol, ibSymbol: d.ibSymbol, exchange: d.exchange }));
}

const conIdResolvers = new Map<number, (conId: number | null) => void>();
let conIdReqCounter = 9000;

export async function resolveConId(symbol: string): Promise<number | null> {
  if (!ib || connState !== "CONNECTED") return null;
  const reqId = conIdReqCounter++;
  const contract: Contract = {
    symbol: symbol.replace(/^\$/, "").replace(/^\//, ""),
    secType: (symbol.startsWith("/") ? "FUT" : "STK") as SecType,
    exchange: "SMART",
    currency: "USD",
  };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      conIdResolvers.delete(reqId);
      resolve(null);
    }, 5_000);

    const handler = (rId: number, details: any) => {
      if (rId !== reqId) return;
      clearTimeout(timeout);
      conIdResolvers.delete(reqId);
      ib!.off(EventName.contractDetails, handler);
      resolve(details?.contract?.conId ?? null);
    };

    ib!.on(EventName.contractDetails, handler);
    try {
      ib!.reqContractDetails(reqId, contract);
    } catch {
      clearTimeout(timeout);
      conIdResolvers.delete(reqId);
      ib!.off(EventName.contractDetails, handler);
      resolve(null);
    }
  });
}

export async function fetchNewsForSymbol(symbol: string, maxResults = 30): Promise<IBNewsHeadline[]> {
  const conId = await resolveConId(symbol);
  if (!conId) return [];
  const providers = ibNewsProviders.join("+");
  if (!providers) return [];
  return fetchIBHistoricalNews(conId, providers, maxResults);
}

export function getDepthSnapshot(): DepthBook[] {
  const out: DepthBook[] = [];
  for (const [sym, book] of depthBooks) {
    if (book.bids.length > 0 || book.asks.length > 0) {
      out.push({ symbol: sym, bids: [...book.bids], asks: [...book.asks], ts: Date.now() });
    }
  }
  return out;
}

export function getDepthForSymbol(symbol: string): DepthBook | null {
  const book = depthBooks.get(symbol);
  if (!book) return null;
  return { symbol, bids: [...book.bids], asks: [...book.asks], ts: Date.now() };
}

export function getDepthSymbols(): string[] {
  const static_ = DEPTH_SYMBOLS.map(d => d.symbol);
  const dynamic = [...dynamicDepthSymbols.keys()];
  return [...static_, ...dynamic];
}

export function subscribeDepthForSymbol(symbol: string): boolean {
  if (!ib || connState !== "CONNECTED") return false;
  const upper = symbol.toUpperCase();

  if (DEPTH_SYMBOLS.some(d => d.symbol === upper)) return true;
  if (dynamicDepthSymbols.has(upper)) return true;

  const reqId = dynamicDepthReqCounter++;
  const isFut = upper.startsWith("/");
  const ibSym = upper.replace(/^[\/$]/, "");
  const contract: Contract = {
    symbol: ibSym,
    secType: (isFut ? "FUT" : "STK") as SecType,
    exchange: isFut ? "CME" : "SMART",
    currency: "USD",
  };
  if (isFut) {
    setFutureFrontMonth(contract, ibSym);
  }
  const isSmartDepth = !isFut;

  depthReqIdToSymbol.set(reqId, upper);
  depthReqSmartDepth.set(reqId, isSmartDepth);
  depthBooks.set(upper, { bids: [], asks: [] });
  dynamicDepthSymbols.set(upper, { reqId, contract, isSmartDepth });

  try {
    ib.reqMktDepth(reqId, contract, DEPTH_NUM_ROWS, isSmartDepth);
    logger.info({ symbol: upper, reqId, isSmartDepth }, "IB: subscribed dynamic depth");
    return true;
  } catch (err) {
    logger.error({ err, symbol: upper }, "IB: failed to subscribe dynamic depth");
    depthReqIdToSymbol.delete(reqId);
    depthBooks.delete(upper);
    dynamicDepthSymbols.delete(upper);
    return false;
  }
}

export function unsubscribeDepthForSymbol(symbol: string): void {
  const upper = symbol.toUpperCase();
  const info = dynamicDepthSymbols.get(upper);
  if (!info || !ib) return;
  try { ib.cancelMktDepth(info.reqId, info.isSmartDepth); } catch { /* ignore */ }
  depthReqIdToSymbol.delete(info.reqId);
  depthReqSmartDepth.delete(info.reqId);
  depthBooks.delete(upper);
  dynamicDepthSymbols.delete(upper);
  logger.info({ symbol: upper }, "IB: unsubscribed dynamic depth");
}

export function getIBCachedQuote(symbol: string): LiveQuote | null {
  const sym = symbol.toUpperCase();
  const state = ibQuoteCache.get(sym);
  if (!state) return null;
  const def = BREADTH_SYMBOLS.find(d => d.displaySymbol === sym);
  const effectiveLast = def ? resolveEffectiveLast(def, state) : state.last;
  if (effectiveLast === null) return null;
  return {
    symbol: sym,
    last: effectiveLast,
    regularLast: effectiveLast,
    extendedLast: effectiveLast,
    bid: state.bid,
    ask: state.ask,
    bidSize: state.bidSize,
    askSize: state.askSize,
    change: state.change,
    changePct: state.changePct,
    volume: state.volume,
    high: state.high,
    low: state.low,
    close: state.close,
    ts: state.ts,
  };
}

function evictOldestDynamicQuote() {
  if (!ib || dynamicQuoteInsertOrder.length === 0) return;
  const evictSym = dynamicQuoteInsertOrder.shift()!;
  const evictReqId = dynamicQuoteSymbols.get(evictSym);
  if (evictReqId !== undefined) {
    try { ib.cancelMktData(evictReqId); } catch {}
    dynamicQuoteSymbols.delete(evictSym);
    dynamicQuoteReqIdToSymbol.delete(evictReqId);
    logger.info({ symbol: evictSym, reqId: evictReqId }, "IB: evicted dynamic quote (LRU)");
  }
}

function fetchContractLongName(symbol: string, contract: Contract) {
  if (ibCompanyNames.has(symbol) || !ib) return;
  const reqId = conIdReqCounter++;
  const timeout = setTimeout(() => {
    ib!.off(EventName.contractDetails, handler);
  }, 5_000);
  const handler = (_rId: number, details: any) => {
    if (_rId !== reqId) return;
    clearTimeout(timeout);
    ib!.off(EventName.contractDetails, handler);
    if (details?.longName) {
      ibCompanyNames.set(symbol, details.longName);
      logger.info({ symbol, longName: details.longName }, "IB: cached company name");
    }
  };
  ib!.on(EventName.contractDetails, handler);
  try {
    ib!.reqContractDetails(reqId, contract);
  } catch {
    clearTimeout(timeout);
    ib!.off(EventName.contractDetails, handler);
  }
}

const ibConnectedCallbacks: Array<() => void> = [];
export function onIBConnected(cb: () => void): void {
  ibConnectedCallbacks.push(cb);
  if (connState === "CONNECTED") cb();
}

const SCHWAB_ONLY_FUTURES = new Set(["/BZ"]);

export function subscribeQuoteForSymbol(symbol: string): boolean {
  if (!ib || connState !== "CONNECTED") return false;
  const upper = symbol.toUpperCase();

  if (SCHWAB_ONLY_FUTURES.has(upper)) return false;

  if (permanentSymbolSet.has(upper)) return true;

  if (dynamicQuoteSymbols.has(upper)) {
    const idx = dynamicQuoteInsertOrder.indexOf(upper);
    if (idx !== -1) {
      dynamicQuoteInsertOrder.splice(idx, 1);
      dynamicQuoteInsertOrder.push(upper);
    }
    return true;
  }

  while (dynamicQuoteSymbols.size >= MAX_DYNAMIC_QUOTE_SLOTS) {
    evictOldestDynamicQuote();
  }

  const reqId = dynamicQuoteReqCounter++;
  const contract = buildDynamicContract(upper);

  dynamicQuoteSymbols.set(upper, reqId);
  dynamicQuoteReqIdToSymbol.set(reqId, upper);
  dynamicQuoteInsertOrder.push(upper);

  try {
    ib.reqMktData(reqId, contract, "", false, false);
    logger.info({ symbol: upper, reqId, slots: `${dynamicQuoteSymbols.size}/${MAX_DYNAMIC_QUOTE_SLOTS}` }, "IB: subscribed on-demand quote");
    if (!upper.startsWith("$") && !upper.startsWith("/")) {
      void fetchContractLongName(upper, contract);
    }
    return true;
  } catch (err) {
    logger.error({ err, symbol: upper }, "IB: failed to subscribe on-demand quote");
    dynamicQuoteSymbols.delete(upper);
    dynamicQuoteReqIdToSymbol.delete(reqId);
    dynamicQuoteInsertOrder.pop();
    return false;
  }
}
