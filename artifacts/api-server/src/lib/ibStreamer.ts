import { IBApi, EventName, Contract, SecType } from "@stoqey/ib";
import { logger } from "./logger.js";
import type { LiveQuote } from "./schwabStreamer.js";

const TT = {
  BID: 1, ASK: 2, LAST: 4, HIGH: 6, LOW: 7, VOLUME: 8, CLOSE: 9,
  BID_SIZE: 0, ASK_SIZE: 3,
  DELAYED_BID: 66, DELAYED_ASK: 67, DELAYED_LAST: 68,
  DELAYED_BID_SIZE: 69, DELAYED_ASK_SIZE: 70,
  DELAYED_HIGH: 72, DELAYED_LOW: 73, DELAYED_VOLUME: 74, DELAYED_CLOSE: 75,
} as const;

const IB_HOST = process.env.IB_HOST ?? "127.0.0.1";
const IB_PORT = Number(process.env.IB_PORT ?? "4002");
const IB_CLIENT_ID = Number(process.env.IB_CLIENT_ID ?? "1");

const RECONNECT_INTERVAL_MS = 10_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

type ConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

interface IBSymbolDef {
  reqId: number;
  symbol: string;
  ibSymbol: string;
  secType: string;
  exchange: string;
  displaySymbol: string;
}

const BREADTH_SYMBOLS: IBSymbolDef[] = [
  { reqId: 5001, symbol: "$TICK",   ibSymbol: "TICK",   secType: "IND", exchange: "NYSE",     displaySymbol: "$TICK" },
  { reqId: 5002, symbol: "$TRIN",   ibSymbol: "TRIN",   secType: "IND", exchange: "NYSE",     displaySymbol: "$TRIN" },
  { reqId: 5003, symbol: "$ADD",    ibSymbol: "ADD",    secType: "IND", exchange: "NYSE",     displaySymbol: "$ADD" },
  { reqId: 5004, symbol: "$VOLD",   ibSymbol: "VOLD",   secType: "IND", exchange: "NYSE",     displaySymbol: "$VOLD" },
  { reqId: 5005, symbol: "$TICKI",  ibSymbol: "TICKI",  secType: "IND", exchange: "NASDAQ",   displaySymbol: "$TICKI" },
  { reqId: 5006, symbol: "$ADDN",   ibSymbol: "ADDN",   secType: "IND", exchange: "NASDAQ",   displaySymbol: "$ADDN" },
  { reqId: 5007, symbol: "$TRINQ",  ibSymbol: "TRINQ",  secType: "IND", exchange: "NASDAQ",   displaySymbol: "$TRINQ" },
  { reqId: 5008, symbol: "$VIX",    ibSymbol: "VIX",    secType: "IND", exchange: "CBOE",     displaySymbol: "$VIX" },
  { reqId: 5009, symbol: "$VIX9D",  ibSymbol: "VIX9D",  secType: "IND", exchange: "CBOE",     displaySymbol: "$VIX9D" },
  { reqId: 5010, symbol: "$VIX3M",  ibSymbol: "VIX3M",  secType: "IND", exchange: "CBOE",     displaySymbol: "$VIX3M" },
  { reqId: 5011, symbol: "$VVIX",   ibSymbol: "VVIX",   secType: "IND", exchange: "CBOE",     displaySymbol: "$VVIX" },
  { reqId: 5012, symbol: "$VIX1D",  ibSymbol: "VIX1D",  secType: "IND", exchange: "CBOE",     displaySymbol: "$VIX1D" },
  { reqId: 5013, symbol: "$SKEW",   ibSymbol: "SKEW",   secType: "IND", exchange: "CBOE",     displaySymbol: "$SKEW" },
  { reqId: 5014, symbol: "/VIX",    ibSymbol: "VIX",    secType: "FUT", exchange: "CFE",      displaySymbol: "/VIX" },
  { reqId: 5015, symbol: "/ES",     ibSymbol: "ES",     secType: "FUT", exchange: "CME",      displaySymbol: "/ES" },
  { reqId: 5016, symbol: "/NQ",     ibSymbol: "NQ",     secType: "FUT", exchange: "CME",      displaySymbol: "/NQ" },
  { reqId: 5017, symbol: "/RTY",    ibSymbol: "RTY",    secType: "FUT", exchange: "CME",      displaySymbol: "/RTY" },
  { reqId: 5018, symbol: "/ZB",     ibSymbol: "ZB",     secType: "FUT", exchange: "CBOT",     displaySymbol: "/ZB" },
  { reqId: 5019, symbol: "/ZN",     ibSymbol: "ZN",     secType: "FUT", exchange: "CBOT",     displaySymbol: "/ZN" },
  { reqId: 5020, symbol: "/ZT",     ibSymbol: "ZT",     secType: "FUT", exchange: "CBOT",     displaySymbol: "/ZT" },
  { reqId: 5021, symbol: "/ZF",     ibSymbol: "ZF",     secType: "FUT", exchange: "CBOT",     displaySymbol: "/ZF" },
  { reqId: 5022, symbol: "/DX",     ibSymbol: "DX",     secType: "FUT", exchange: "NYBOT",    displaySymbol: "/DX" },
  { reqId: 5023, symbol: "/CL",     ibSymbol: "CL",     secType: "FUT", exchange: "NYMEX",    displaySymbol: "/CL" },
  { reqId: 5024, symbol: "/GC",     ibSymbol: "GC",     secType: "FUT", exchange: "COMEX",    displaySymbol: "/GC" },
  { reqId: 5025, symbol: "HYG",     ibSymbol: "HYG",    secType: "STK", exchange: "SMART",    displaySymbol: "HYG" },
  { reqId: 5026, symbol: "LQD",     ibSymbol: "LQD",    secType: "STK", exchange: "SMART",    displaySymbol: "LQD" },
  { reqId: 5027, symbol: "$SPX",    ibSymbol: "SPX",    secType: "IND", exchange: "CBOE",     displaySymbol: "$SPX" },
  { reqId: 5028, symbol: "SPY",     ibSymbol: "SPY",    secType: "STK", exchange: "SMART",    displaySymbol: "SPY" },
];

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

function buildContract(def: IBSymbolDef): Contract {
  const contract: Contract = {
    symbol: def.ibSymbol,
    secType: def.secType as SecType,
    exchange: def.exchange,
    currency: "USD",
  };
  
  if (def.secType === "FUT") {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const nextMonth = month === 12 ? (year + 1).toString() + "01" : year.toString() + String(month + 1).padStart(2, "0");
    (contract as any).expiry = nextMonth;
  }
  
  return contract;
}

function emitQuote(def: IBSymbolDef, state: IBQuoteState) {
  const quote: LiveQuote = {
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
  };

  if (quoteCacheInjector) {
    quoteCacheInjector(def.displaySymbol, quote);
  }
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

function subscribeAll() {
  if (!ib) return;
  try {
    ib.reqMarketDataType(3);
    logger.info("IB: requested delayed market data type (fallback)");
  } catch (err) {
    logger.warn({ err }, "IB: failed to set market data type");
  }
  for (const def of BREADTH_SYMBOLS) {
    const contract = buildContract(def);
    try {
      ib.reqMktData(def.reqId, contract, "", false, false);
      logger.info({ symbol: def.ibSymbol, reqId: def.reqId }, "IB: subscribed to market data");
    } catch (err) {
      logger.error({ err, symbol: def.ibSymbol }, "IB: failed to subscribe");
    }
  }
}

function teardownIB() {
  if (ib) {
    for (const def of BREADTH_SYMBOLS) {
      try { ib.cancelMktData(def.reqId); } catch { /* ignore */ }
    }
    try { ib.disconnect(); } catch { /* ignore */ }
    ib.removeAllListeners();
    ib = null;
  }
}

function scheduleReconnect() {
  if (intentionalDisconnect || reconnectTimer) return;
  const jitter = Math.random() * 2000;
  const delay = reconnectDelay + jitter;
  logger.info({ delay: Math.round(delay) }, "IB: scheduling reconnect");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectIB();
  }, delay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
}

function handleDisconnectOrError() {
  if (connState === "DISCONNECTED" && !reconnectTimer) {
    return;
  }
  teardownIB();
  connState = "DISCONNECTED";
  emitStatus("disconnected");
  scheduleReconnect();
}

export async function connectIB(): Promise<void> {
  if (connState === "CONNECTING" || connState === "CONNECTED") return;
  intentionalDisconnect = false;
  connState = "CONNECTING";
  emitStatus("connecting");

  teardownIB();

  try {
    ib = new IBApi({ host: IB_HOST, port: IB_PORT, clientId: IB_CLIENT_ID });

    ib.on(EventName.connected, () => {
      connState = "CONNECTED";
      reconnectDelay = RECONNECT_INTERVAL_MS;
      logger.info({ host: IB_HOST, port: IB_PORT }, "IB: connected to gateway");
      emitStatus("connected");
      subscribeAll();
    });

    ib.on(EventName.disconnected, () => {
      logger.warn("IB: disconnected from gateway");
      handleDisconnectOrError();
    });

    ib.on(EventName.error, (err: Error, code: number, reqId: number) => {
      if (code === 2104 || code === 2106 || code === 2158 || code === 10167) {
        logger.debug({ code, msg: err.message }, "IB: info message (not an error)");
        return;
      }
      if (code === 200 && reqId > 0) {
        const def = reqIdToSymbol.get(reqId);
        logger.warn({ code, reqId, symbol: def?.ibSymbol, msg: err.message }, "IB: no security definition");
        return;
      }

      logger.error({ err, code, reqId }, "IB: API error");

      const isTransportError = code === 502 || code === 504 || code === 1100 ||
        (err.message && (err.message.includes("ECONNREFUSED") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT")));

      if (isTransportError && connState !== "CONNECTED") {
        handleDisconnectOrError();
      }
    });

    ib.on(EventName.tickPrice, (reqId: number, tickType: number, price: number, _attribs: unknown) => {
      const def = reqIdToSymbol.get(reqId);
      if (!def || price === -1) return;

      const state = getOrCreateState(def.displaySymbol);
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

      emitQuote(def, state);
    });

    ib.on(EventName.tickSize, (reqId: number, tickType: number, size: number) => {
      const def = reqIdToSymbol.get(reqId);
      if (!def || size === -1) return;

      const state = getOrCreateState(def.displaySymbol);
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

      emitQuote(def, state);
    });

    ib.connect();
  } catch (err) {
    logger.warn({ err }, "IB: connection attempt failed");
    connState = "DISCONNECTED";
    emitStatus("disconnected");
    scheduleReconnect();
  }
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
