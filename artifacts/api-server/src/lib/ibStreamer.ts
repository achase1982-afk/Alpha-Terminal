import { IBApi, EventName, Contract, SecType } from "@stoqey/ib";
import { logger } from "./logger.js";
import type { LiveQuote } from "./schwabStreamer.js";

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

const IB_HOST = process.env.IB_HOST ?? "127.0.0.1";
const IB_PORT = Number(process.env.IB_PORT ?? "4002");
const IB_CLIENT_ID = Number(process.env.IB_CLIENT_ID ?? "1");

const RECONNECT_INTERVAL_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

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
  { reqId: 5001, symbol: "$TICK",   ibSymbol: "TICK-NYSE",   secType: "IND", exchange: "NYSE",     displaySymbol: "$TICK" },
  { reqId: 5002, symbol: "$TRIN",   ibSymbol: "TRIN-NYSE",   secType: "IND", exchange: "NYSE",     displaySymbol: "$TRIN" },
  { reqId: 5003, symbol: "$ADD",    ibSymbol: "ADD-NYSE",    secType: "IND", exchange: "NYSE",     displaySymbol: "$ADD" },
  { reqId: 5004, symbol: "$VOLD",   ibSymbol: "VOLD-NYSE",   secType: "IND", exchange: "NYSE",     displaySymbol: "$VOLD" },
  { reqId: 5005, symbol: "$TICKI",  ibSymbol: "TICK-NASD",   secType: "IND", exchange: "NASDAQ",   displaySymbol: "$TICKI" },
  { reqId: 5006, symbol: "$ADDN",   ibSymbol: "ADD-NASD",    secType: "IND", exchange: "NASDAQ",   displaySymbol: "$ADDN" },
  { reqId: 5007, symbol: "$TRINQ",  ibSymbol: "TRIN-NASD",   secType: "IND", exchange: "NASDAQ",   displaySymbol: "$TRINQ" },
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
  { reqId: 5029, symbol: "$ADVN",   ibSymbol: "ADVN-NYSE",   secType: "IND", exchange: "NYSE",     displaySymbol: "$ADVN" },
  { reqId: 5030, symbol: "$DECN",   ibSymbol: "DECN-NYSE",   secType: "IND", exchange: "NYSE",     displaySymbol: "$DECN" },
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
const MONTHLY_FUTURES = new Set(["CL", "GC", "DX"]);

function getFrontMonth(symbol: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  if (MONTHLY_FUTURES.has(symbol)) {
    let m = month;
    let y = year;
    if (day > 15) {
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return y.toString() + String(m).padStart(2, "0");
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
    ib = new IBApi({ host: IB_HOST, port: IB_PORT, clientId: IB_CLIENT_ID });

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
      logger.info({ host: IB_HOST, port: IB_PORT, attempt: reconnectAttempt }, "IB: connected to gateway");
      reconnectAttempt = 0;
      emitStatus("connected");
      subscribeAll();
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

      const isImmediateReconnect = code === 504 || code === 2110;
      if (isImmediateReconnect) {
        logger.warn({ code, msg: err.message }, "IB: transport/connectivity error — immediate reconnect");
        handleDisconnectOrError(true);
        return;
      }

      logger.error({ err, code, reqId }, "IB: API error");

      const isTransportError = code === 502 || code === 1100 ||
        (err.message && (err.message.includes("ECONNREFUSED") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT")));

      if (isTransportError) {
        handleDisconnectOrError(false);
      }
    });

    const tickLogCounts = new Map<string, number>();
    ib.on(EventName.tickPrice, (reqId: number, tickType: number, price: number, _attribs: unknown) => {
      const def = reqIdToSymbol.get(reqId);
      if (!def || price === -1) return;

      const cnt = (tickLogCounts.get(def.displaySymbol) ?? 0) + 1;
      tickLogCounts.set(def.displaySymbol, cnt);
      if (cnt <= 3) {
        logger.info({ symbol: def.displaySymbol, tickType, price }, "IB: tickPrice received");
      }

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

    setInterval(() => {
      if (connState !== "CONNECTED") return;
      const symsWithData: string[] = [];
      for (const [sym, state] of ibQuoteCache.entries()) {
        if (state.last !== null || state.bid !== null || state.close !== null) {
          symsWithData.push(sym);
        }
      }
      logger.info({ total: ibQuoteCache.size, withData: symsWithData.length, symbols: symsWithData }, "IB: quote cache summary");
    }, 30_000);

    ib.connect();
  } catch (err) {
    logger.warn({ err }, "IB: connection attempt failed");
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
