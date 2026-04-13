import { IBApi, EventName, Contract, SecType } from "@stoqey/ib";
import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";
import { emitTelemetry } from "./telemetryStore.js";
import type { LiveQuote } from "./schwabStreamer.js";
import { getEnabledSymbols, type IBSymbolDef } from "./ibBreadthSymbols.js";

export type { IBSymbolDef } from "./ibBreadthSymbols.js";

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
  { symbol: "/ES",  ibSymbol: "ES",  secType: "FUT", exchange: "CME",   category: "FUTURES" },
  { symbol: "/NQ",  ibSymbol: "NQ",  secType: "FUT", exchange: "CME",   category: "FUTURES" },
  { symbol: "SPY",  ibSymbol: "SPY", secType: "STK", exchange: "SMART", category: "EQUITY" },
];

const DEPTH_NUM_ROWS = 10;
const DEPTH_REQ_ID_BASE = 6000;
const DEPTH_THROTTLE_MS = 250;

const depthReqIdToSymbol = new Map<number, string>();
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
  if (!raw) return { host: "127.0.0.1", port: 4002, wsUrl: null };
  try {
    const url = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    if (url.protocol === "https:" || url.protocol === "wss:") {
      const wsTarget = `wss://${url.hostname}${url.port ? ":" + url.port : ""}${url.pathname || "/"}`;
      return { host: "127.0.0.1", port: 4002, wsUrl: wsTarget };
    }
    if (url.protocol === "http:" || url.protocol === "ws:") {
      const wsTarget = `ws://${url.hostname}${url.port ? ":" + url.port : ""}${url.pathname || "/"}`;
      return { host: "127.0.0.1", port: 4002, wsUrl: wsTarget };
    }
    const host = url.hostname || "127.0.0.1";
    const port = url.port ? Number(url.port) : 4002;
    return { host, port, wsUrl: null };
  } catch {
    return { host: raw, port: Number(process.env.IB_PORT ?? "4002"), wsUrl: null };
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
let broadcastFn: ((event: string, data: unknown) => void) | null = null;
let quoteCacheInjector: ((sym: string, quote: LiveQuote) => void) | null = null;

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

function buildContract(def: IBSymbolDef): Contract {
  const contract: Contract = {
    symbol: def.ibSymbol,
    secType: def.secType as SecType,
    exchange: def.exchange,
    currency: "USD",
  };
  
  if (def.secType === "FUT") {
    (contract as any).lastTradeDateOrContractMonth = getFrontMonth(def.ibSymbol);
  }
  
  return contract;
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
  if (quoteCacheInjector) {
    quoteCacheInjector(def.displaySymbol, quote);
  }
}

function emitRawQuote(displaySymbol: string, state: IBQuoteState) {
  const effectiveLast = state.last;
  const quote: LiveQuote = {
    symbol: displaySymbol,
    last: effectiveLast,
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

const NEWS_TICK_SYMBOLS = new Set(["SPY", "QQQ"]);

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
  if (isFut) (contract as any).lastTradeDateOrContractMonth = getFrontMonth(ibSym);
  return contract;
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
      (contract as any).lastTradeDateOrContractMonth = getFrontMonth(d.ibSymbol);
    }
    const isSmartDepth = d.exchange === "SMART";
    depthReqIdToSymbol.set(reqId, d.symbol);
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
  const rows = side === 1 ? book.bids : book.asks;
  const row: DepthRow = { price, size, mm };

  switch (operation) {
    case 0:
      rows.splice(position, 0, row);
      if (rows.length > DEPTH_NUM_ROWS) rows.length = DEPTH_NUM_ROWS;
      break;
    case 1:
      if (position < rows.length) rows[position] = row;
      break;
    case 2:
      if (position < rows.length) rows.splice(position, 1);
      break;
  }
  depthDirty.add(sym);
}

function teardownIB() {
  if (ib) {
    for (const def of BREADTH_SYMBOLS) {
      try { ib.cancelMktData(def.reqId); } catch { /* ignore */ }
    }
    for (const [reqId] of depthReqIdToSymbol) {
      const sym = depthReqIdToSymbol.get(reqId);
      const isSmartDepth = sym ? !sym.startsWith("/") : false;
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
  depthBooks.clear();
  depthDirty.clear();
  dynamicDepthSymbols.clear();
  dynamicQuoteSymbols.clear();
  dynamicQuoteReqIdToSymbol.clear();
  dynamicQuoteInsertOrder.length = 0;
  if (depthThrottleTimer) {
    clearInterval(depthThrottleTimer);
    depthThrottleTimer = null;
  }
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

  try {
    ib = new IBApi({ host: IB_HOST, port: IB_PORT, clientId: activeClientId });
    logger.info({ host: IB_HOST, port: IB_PORT, clientId: activeClientId }, "IB: connecting to gateway");

    let allEventCount = 0;
    ib.on(EventName.all, (...args: unknown[]) => {
      allEventCount++;
      if (allEventCount <= 10) {
        const eventName = typeof args[0] === "string" ? args[0] : "unknown";
        logger.info({ eventName, argCount: args.length, allEventCount }, "IB: raw event received");
      }
      if (allEventCount === 50) {
        logger.info({ allEventCount }, "IB: suppressing further raw event logs");
      }
    });

    ib.on(EventName.info, (msg: string, code: number) => {
      // 326 = client ID already in use — arrives here as an INFO event (not error).
      // Rotate to the next slot and reconnect after a 3-second pause.
      if (code === 326) {
        const oldId = activeClientId;
        activeClientId = ((activeClientId - IB_CLIENT_ID + 1) % 10) + IB_CLIENT_ID;
        logger.warn({ oldId, newId: activeClientId }, "IB: client ID conflict (326) — rotating client ID, reconnecting in 3s");
        // Prevent the imminent disconnected event from firing an immediate reconnect
        intentionalDisconnect = true;
        teardownIB();
        connState = "DISCONNECTED";
        emitStatus("disconnected");
        intentionalDisconnect = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectIB();
        }, 3_000);
        return;
      }
      logger.info({ msg, code }, "IB: info event");
    });

    ib.on(EventName.marketDataType, (reqId: number, marketDataType: number) => {
      logger.info({ reqId, marketDataType }, "IB: marketDataType event");
    });

    ib.on(EventName.tickReqParams, (reqId: number, minTick: number, bboExchange: string, snapshotPermissions: number) => {
      const def = reqIdToSymbol.get(reqId);
      logger.info({ symbol: def?.displaySymbol, reqId, minTick, bboExchange, snapshotPermissions }, "IB: tickReqParams received");
    });

    ib.on(EventName.connected, () => {
      connState = "CONNECTED";
      reconnectDelay = RECONNECT_INTERVAL_MS;
      logger.info({ host: IB_HOST, port: IB_PORT, clientId: activeClientId, attempt: reconnectAttempt }, "IB: connected to gateway");
      emitTelemetry("IBKR", "INFO", "IBKR Gateway connected", { host: IB_HOST, port: IB_PORT, clientId: activeClientId });
      reconnectAttempt = 0;
      activeClientId = IB_CLIENT_ID; // reset to base slot on clean connect
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
      logger.warn("IB: disconnected from gateway — triggering immediate reconnect");
      void logFailure("IBKR", "WARN", "IBKR Gateway disconnected", { host: IB_HOST, port: IB_PORT });
      handleDisconnectOrError(true);
    });

    ib.on(EventName.error, (err: Error, code: number, reqId: number) => {
      if (code === 2104 || code === 2106 || code === 2158 || code === 10167) {
        logger.info({ code, msg: err.message }, "IB: info/status message");
        return;
      }
      if (code === 200 && reqId > 0) {
        const def = reqIdToSymbol.get(reqId);
        logger.warn({ code, reqId, symbol: def?.ibSymbol, msg: err.message }, "IB: no security definition");
        return;
      }

      if (code === 101 && reqId >= 7000) {
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

      // 326 = client ID already in use (old process still registered with gateway).
      // Rotate to the next client ID slot and reconnect after a short delay.
      if (code === 326) {
        const oldId = activeClientId;
        activeClientId = ((activeClientId - IB_CLIENT_ID + 1) % 10) + IB_CLIENT_ID;
        logger.warn({ oldId, newId: activeClientId }, "IB: client ID conflict (326) — rotating client ID, reconnecting in 3s");
        // Block the disconnected event from spawning its own immediate reconnect
        intentionalDisconnect = true;
        teardownIB();
        connState = "DISCONNECTED";
        emitStatus("disconnected");
        intentionalDisconnect = false;
        // Schedule reconnect with new client ID
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectIB();
        }, 3_000);
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
      const def = reqIdToSymbol.get(reqId);
      const dynSym = def ? null : dynamicQuoteReqIdToSymbol.get(reqId);
      if (!def && !dynSym) return;

      const displaySymbol = def ? def.displaySymbol : dynSym!;
      const cnt = (tickLogCounts.get(displaySymbol) ?? 0) + 1;
      tickLogCounts.set(displaySymbol, cnt);
      if (cnt <= 3) {
        logger.info({ symbol: displaySymbol, tickType, price }, "IB: tickPrice received");
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

    ib.on(EventName.tickSize, (reqId: number, tickType: number, size: number) => {
      if (size === -1) return;
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
        logger.info({ symbol: def.displaySymbol, tickType, value }, "IB: tickString received");
      }
    });

    ib.on(EventName.tickGeneric, (reqId: number, tickType: number, value: number) => {
      const def = reqIdToSymbol.get(reqId);
      if (!def) return;
      const cnt = (tickLogCounts.get(def.displaySymbol + "_gen") ?? 0) + 1;
      tickLogCounts.set(def.displaySymbol + "_gen", cnt);
      if (cnt <= 2) {
        logger.info({ symbol: def.displaySymbol, tickType, value }, "IB: tickGeneric received");
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

    setInterval(() => {
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
      logger.info({ total: ibQuoteCache.size, withData: symsWithData.length, symbols: symsWithData }, "IB: quote cache summary");

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
  logger.info("IB: disconnected intentionally");
  emitStatus("disconnected");
}

export function isIBConnected(): boolean {
  return connState === "CONNECTED";
}

export function getIBSnapshot(): LiveQuote[] {
  const out: LiveQuote[] = [];
  for (const def of BREADTH_SYMBOLS) {
    const state = ibQuoteCache.get(def.displaySymbol);
    if (state) {
      out.push({
        symbol: def.displaySymbol,
        last: state.last,
        extendedLast: state.last,
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
      });
    }
  }
  return out;
}

export function getIBStatus(): { connected: boolean; state: ConnectionState; host: string; port: number; symbols: number; cachedQuotes: number } {
  return {
    connected: connState === "CONNECTED",
    state: connState,
    host: IB_HOST,
    port: IB_PORT,
    symbols: BREADTH_SYMBOLS.length,
    cachedQuotes: ibQuoteCache.size,
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
    (contract as any).lastTradeDateOrContractMonth = getFrontMonth(ibSym);
  }
  const isSmartDepth = !isFut;

  depthReqIdToSymbol.set(reqId, upper);
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
  depthBooks.delete(upper);
  dynamicDepthSymbols.delete(upper);
  logger.info({ symbol: upper }, "IB: unsubscribed dynamic depth");
}

export function getIBCachedQuote(symbol: string): LiveQuote | null {
  const state = ibQuoteCache.get(symbol.toUpperCase());
  if (!state) return null;
  const effectiveLast = state.last ?? state.bid ?? state.ask ?? null;
  if (effectiveLast === null && state.close === null) return null;
  return {
    symbol: symbol.toUpperCase(),
    last: effectiveLast,
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
