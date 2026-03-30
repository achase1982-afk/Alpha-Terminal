/**
 * SchwabStreamer — singleton WebSocket client for the Schwab Streaming API.
 *
 * Architecture:
 *  - One persistent WS connection to Schwab Streamer
 *  - All connected SSE clients receive the same live price updates
 *  - Maintains an in-memory quote cache so new SSE clients get data immediately
 *  - Auto-reconnects with exponential backoff (1s → 2s → 4s … capped at 30s)
 *  - Cleans up automatically when there are no SSE subscribers for >60s
 */

import WebSocket from "ws";
import type { Response } from "express";
import { logger } from "./logger.js";

// ─── LEVELONE_EQUITIES field map ─────────────────────────────────────────────
// Schwab sends field updates keyed by integer indices.
// Verified via live diagnostic dump 2026-03-30:
//   3 = lastPrice (includes extended/pre-market — NOT regular session last)
//  10 = highPrice (0 when market closed)
//  11 = lowPrice  (0 when market closed)
//  12 = closePrice (previous regular-session close)
//  18 = netChange (dollar change vs close)
//  29 = regularMarketLastPrice (equals close when market is closed)
//  33 = regularMarketLastPrice (same as 29 during pre-market)
//  42 = netPercentChange
//  50 = netChange (duplicate of 18)
//  51 = netPercentChange (duplicate of 42)
const FIELD = {
  BID:            1,
  ASK:            2,
  LAST_ALL_SESS:  3,
  BID_SIZE:       4,
  ASK_SIZE:       5,
  VOLUME:         8,
  HIGH:           10,
  LOW:            11,
  CLOSE:          12,
  NET_CHANGE:     18,
  NET_PCT_CHANGE: 42,
  MARK:           29,
  REG_LAST:       33,
} as const;

const FIELDS_STR = "0,1,2,3,4,5,8,10,11,12,18,29,33,42";

// ─── LEVELONE_FUTURES field map (indices differ from equities) ───────────────
const FUT_FIELD = {
  BID:         1,
  ASK:         2,
  LAST:        3,
  BID_SIZE:    4,
  ASK_SIZE:    5,
  VOLUME:      8,
  HIGH:        12,
  LOW:         13,
  CLOSE:       14,
  NET_CHANGE:  19,
  PCT_CHANGE:  20,
  MARK:        24,
} as const;

const FUTURES_FIELDS_STR = "0,1,2,3,4,5,8,12,13,14,19,20,24";

// ─── LEVELONE_OPTIONS field map ──────────────────────────────────────────────
// Schwab Streamer LEVELONE_OPTIONS field indices (per official docs):
const OPT_FIELD = {
  BID:          2,
  ASK:          3,
  LAST:         4,
  VOLUME:       8,
  OPEN_INT:     23,
  IV:           22,
  DELTA:        11,
  GAMMA:        12,
  THETA:        13,
  VEGA:         14,
  MARK:         28,
  NET_CHANGE:   19,
  BID_SIZE:     9,
  ASK_SIZE:     10,
} as const;

const OPT_FIELDS_STR = "0,2,3,4,8,9,10,11,12,13,14,19,22,23,28";

// ─── Public types ─────────────────────────────────────────────────────────────
export interface LiveQuote {
  symbol:     string;
  last:       number | null;
  bid:        number | null;
  ask:        number | null;
  change:     number | null;
  changePct:  number | null;
  volume:     number | null;
  high:       number | null;
  low:        number | null;
  close:      number | null;
  ts:         number;   // epoch ms of last update
}

export interface OptionTick {
  key:          string;   // Schwab option symbol
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
  ts:           number;
}

// ─── Internal state ───────────────────────────────────────────────────────────
interface StreamerInfo {
  streamerSocketUrl:        string;
  schwabClientCustomerId:   string;
  schwabClientCorrelId:     string;
}

let ws:            WebSocket | null   = null;
let accessToken:   string             = "";
let streamerInfo:  StreamerInfo | null = null;
let reqCounter     = 0;

// Subscribed symbols (user-friendly names, e.g. "SPY", "VIX")
const subscribedSymbols = new Set<string>();

// Subscribed option symbols (e.g. "SPY   260330C00632000")
const subscribedOptionSymbols = new Set<string>();

// In-memory price cache keyed by upper-case symbol
const quoteCache = new Map<string, LiveQuote>();

// In-memory option tick cache keyed by Schwab option symbol
const optionCache = new Map<string, OptionTick>();

// SSE response writers — one per connected browser tab
const sseClients = new Set<Response>();

// Reconnect state
let reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
let reconnectDelay   = 1_000;   // ms; doubles each time, capped at 30_000
let isConnecting     = false;
let loginSent        = false;
let loginAcked       = false;
let loginRejected    = false;
let streamerFetchFailCount = 0;
const MAX_FETCH_FAILURES   = 3;

// ─── Symbol formatting (mirrors market.ts) ────────────────────────────────────
const INDEX_MAP: Record<string, string> = {
  VIX: "$VIX", "$VIX": "$VIX",
  SPX: "$SPX", "$SPX": "$SPX",
  NDX: "$NDX", "$NDX": "$NDX",
  RUT: "$RUT", "$RUT": "$RUT",
  DJI: "$DJI", "$DJI": "$DJI", DJIA: "$DJI",
  COMP: "$COMP", "$COMP": "$COMP",
  DXY: "$DXY", "$DXY": "$DXY",
  TNX: "$TNX", "$TNX": "$TNX",
  TYX: "$TYX", "$TYX": "$TYX",
  VXN: "$VXN", "$VXN": "$VXN",
  OEX: "$OEX", "$OEX": "$OEX",
  MNX: "$MNX", "$MNX": "$MNX",
  XSP: "$XSP", "$XSP": "$XSP",
};
function toSchwabKey(sym: string): string {
  return INDEX_MAP[sym.toUpperCase()] ?? sym.toUpperCase();
}
const reverseKeyMap = new Map<string, string>();

function fromSchwabKey(key: string): string {
  return reverseKeyMap.get(key) ?? key;
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────
function sseWrite(res: Response, event: string, data: unknown) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    sseClients.delete(res);
  }
}

function broadcast(event: string, data: unknown) {
  for (const res of sseClients) {
    sseWrite(res, event, data);
  }
}

// ─── WS send helper ──────────────────────────────────────────────────────────
function wsSend(payload: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function nextReq(): string {
  return String(++reqCounter);
}

// ─── Schwab API: fetch streamer info ─────────────────────────────────────────
async function fetchStreamerInfo(token: string): Promise<StreamerInfo | null> {
  try {
    const res = await fetch("https://api.schwabapi.com/trader/v1/userPreference", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body: body.slice(0, 200) }, "userPreference fetch failed");
      if (res.status === 401 || res.status === 403) {
        streamerFetchFailCount++;
      }
      return null;
    }
    streamerFetchFailCount = 0;
    const json = (await res.json()) as {
      streamerInfo?: Array<{
        streamerSocketUrl?:      string;
        schwabClientCustomerId?: string;
        schwabClientCorrelId?:   string;
      }>;
    };
    const raw = json.streamerInfo?.[0];
    if (!raw?.streamerSocketUrl || !raw?.schwabClientCustomerId || !raw?.schwabClientCorrelId) {
      logger.warn({ rawKeys: raw ? Object.keys(raw) : [] }, "userPreference: missing streamerInfo fields");
      return null;
    }
    logger.info(
      { url: raw.streamerSocketUrl, customerId: raw.schwabClientCustomerId.slice(0, 4) + "…" },
      "userPreference: streamerInfo extracted"
    );
    return {
      streamerSocketUrl:      raw.streamerSocketUrl,
      schwabClientCustomerId: raw.schwabClientCustomerId,
      schwabClientCorrelId:   raw.schwabClientCorrelId,
    };
  } catch (err) {
    logger.error({ err }, "fetchStreamerInfo error");
    return null;
  }
}

// ─── Login request ────────────────────────────────────────────────────────────
function sendLogin(info: StreamerInfo, token: string) {
  const payload = {
    requests: [{
      service:                  "ADMIN",
      requestid:                nextReq(),
      command:                  "LOGIN",
      SchwabClientCustomerId:   info.schwabClientCustomerId,
      SchwabClientCorrelId:     info.schwabClientCorrelId,
      parameters: {
        Authorization:              token,
        SchwabClientChannel:        "IO",
        SchwabClientFunctionId:     "APIAPP",
      },
    }],
  };
  logger.info("Streamer: sending LOGIN request");
  wsSend(payload);
  loginSent = true;
}

// ─── Subscribe to symbols ────────────────────────────────────────────────────
function isFuturesSymbol(sym: string): boolean {
  return sym.startsWith("/");
}

function sendSubscribe(symbols: string[]) {
  if (!streamerInfo || !loginAcked || !symbols.length) return;
  for (const sym of symbols) {
    const schwabKey = toSchwabKey(sym);
    if (!reverseKeyMap.has(schwabKey)) {
      reverseKeyMap.set(schwabKey, sym.toUpperCase());
    }
  }

  const equitySyms  = symbols.filter((s) => !isFuturesSymbol(s));
  const futuresSyms = symbols.filter((s) => isFuturesSymbol(s));

  if (equitySyms.length > 0) {
    const keys = equitySyms.map(toSchwabKey).join(",");
    wsSend({
      requests: [{
        service:                  "LEVELONE_EQUITIES",
        requestid:                nextReq(),
        command:                  "ADD",
        SchwabClientCustomerId:   streamerInfo.schwabClientCustomerId,
        SchwabClientCorrelId:     streamerInfo.schwabClientCorrelId,
        parameters: { keys, fields: FIELDS_STR },
      }],
    });
    logger.info({ keys }, "Streamer: subscribed equity symbols");
  }

  if (futuresSyms.length > 0) {
    const keys = futuresSyms.map(toSchwabKey).join(",");
    wsSend({
      requests: [{
        service:                  "LEVELONE_FUTURES",
        requestid:                nextReq(),
        command:                  "ADD",
        SchwabClientCustomerId:   streamerInfo.schwabClientCustomerId,
        SchwabClientCorrelId:     streamerInfo.schwabClientCorrelId,
        parameters: { keys, fields: FUTURES_FIELDS_STR },
      }],
    });
    logger.info({ keys }, "Streamer: subscribed futures symbols");
  }
}

// ─── Periodic equity re-subscription ─────────────────────────────────────────
const EQUITY_RESUB_INTERVAL = 10_000;
let lastEquityTick = 0;
let equityResubTimer: ReturnType<typeof setInterval> | null = null;

function startEquityResub() {
  if (equityResubTimer) return;
  equityResubTimer = setInterval(() => {
    if (!loginAcked || !streamerInfo || !ws || ws.readyState !== WebSocket.OPEN) return;
    const equitySyms = [...subscribedSymbols].filter(s => !isFuturesSymbol(s));
    if (equitySyms.length === 0) return;
    const elapsed = Date.now() - lastEquityTick;
    if (elapsed > EQUITY_RESUB_INTERVAL) {
      const keys = equitySyms.map(toSchwabKey).join(",");
      wsSend({
        requests: [{
          service:                  "LEVELONE_EQUITIES",
          requestid:                nextReq(),
          command:                  "SUBS",
          SchwabClientCustomerId:   streamerInfo.schwabClientCustomerId,
          SchwabClientCorrelId:     streamerInfo.schwabClientCorrelId,
          parameters: { keys, fields: FIELDS_STR },
        }],
      });
    }
  }, EQUITY_RESUB_INTERVAL);
}

function stopEquityResub() {
  if (equityResubTimer) {
    clearInterval(equityResubTimer);
    equityResubTimer = null;
  }
}

// ─── Parse incoming DATA messages ────────────────────────────────────────────
let equityTickCount = 0;
let lastEquityTickLog = 0;
let fieldDiagDone = false;

function handleData(content: Record<string, unknown>[]) {
  equityTickCount += content.length;
  lastEquityTick = Date.now();
  const now = Date.now();

  if (!fieldDiagDone && content.length > 0) {
    fieldDiagDone = true;
    const item = content[0];
    const allFields: Record<string, unknown> = {};
    for (let i = 0; i <= 52; i++) {
      if (item[String(i)] !== undefined) {
        allFields[String(i)] = item[String(i)];
      }
    }
    logger.info({ sym: item["key"], fieldCount: Object.keys(allFields).length, fields: allFields }, "DIAG: ALL equity fields from first tick");
    if (content.length > 1) {
      const item2 = content[1];
      const allFields2: Record<string, unknown> = {};
      for (let i = 0; i <= 52; i++) {
        if (item2[String(i)] !== undefined) {
          allFields2[String(i)] = item2[String(i)];
        }
      }
      logger.info({ sym: item2["key"], fields: allFields2 }, "DIAG: ALL equity fields from second tick");
    }
  }

  if (now - lastEquityTickLog > 30_000) {
    logger.info({ count: content.length, total: equityTickCount, symbols: content.map(i => i["key"]).slice(0, 5) }, "Streamer: EQUITY ticks received");
    lastEquityTickLog = now;
  }
  for (const item of content) {
    const schwabKey = item["key"] as string;
    const sym = fromSchwabKey(schwabKey);

    const existing = quoteCache.get(sym) ?? {
      symbol: sym, last: null, bid: null, ask: null,
      bidSize: null, askSize: null,
      change: null, changePct: null, volume: null,
      high: null, low: null, close: null, ts: 0,
    };

    const pick = (f: number) => {
      const v = item[String(f)];
      return typeof v === "number" && !isNaN(v) ? v : null;
    };

    const lastVal  = pick(FIELD.LAST_ALL_SESS) ?? existing.last;
    const closeVal = pick(FIELD.CLOSE)     ?? existing.close;

    let changeVal:    number | null = existing.change;
    let changePctVal: number | null = existing.changePct;
    if (lastVal !== null && closeVal !== null && closeVal !== 0) {
      changeVal    = lastVal - closeVal;
      changePctVal = (changeVal / closeVal) * 100;
    }

    const updated: LiveQuote = {
      ...existing,
      symbol:    sym,
      last:      lastVal,
      bid:       pick(FIELD.BID)      ?? existing.bid,
      ask:       pick(FIELD.ASK)      ?? existing.ask,
      bidSize:   pick(FIELD.BID_SIZE) ?? existing.bidSize,
      askSize:   pick(FIELD.ASK_SIZE) ?? existing.askSize,
      change:    changeVal,
      changePct: changePctVal,
      volume:    pick(FIELD.VOLUME)   ?? existing.volume,
      high:      pick(FIELD.HIGH)     ?? existing.high,
      low:       pick(FIELD.LOW)      ?? existing.low,
      close:     closeVal,
      ts:        Date.now(),
    };

    quoteCache.set(sym, updated);
    broadcast("quote", updated);
  }
}

// ─── Parse incoming LEVELONE_FUTURES DATA messages ──────────────────────────
let futuresTickCount = 0;
let lastFuturesTickLog = 0;

function handleFuturesData(content: Record<string, unknown>[]) {
  futuresTickCount += content.length;
  const now = Date.now();
  if (now - lastFuturesTickLog > 30_000) {
    logger.info({ count: content.length, total: futuresTickCount, symbols: content.map(i => i["key"]).slice(0, 5) }, "Streamer: FUTURES ticks received");
    lastFuturesTickLog = now;
  }
  for (const item of content) {
    const schwabKey = item["key"] as string;
    const sym = fromSchwabKey(schwabKey);

    const existing = quoteCache.get(sym) ?? {
      symbol: sym, last: null, bid: null, ask: null,
      bidSize: null, askSize: null,
      change: null, changePct: null, volume: null,
      high: null, low: null, close: null, ts: 0,
    };

    const pick = (f: number) => {
      const v = item[String(f)];
      return typeof v === "number" && !isNaN(v) ? v : null;
    };

    const lastVal  = pick(FUT_FIELD.LAST)  ?? pick(FUT_FIELD.MARK) ?? existing.last;
    const closeVal = pick(FUT_FIELD.CLOSE) ?? existing.close;

    let changeVal:    number | null = pick(FUT_FIELD.NET_CHANGE) ?? existing.change;
    let changePctVal: number | null = pick(FUT_FIELD.PCT_CHANGE) ?? existing.changePct;
    if (changeVal === null && lastVal !== null && closeVal !== null && closeVal !== 0) {
      changeVal    = lastVal - closeVal;
      changePctVal = (changeVal / closeVal) * 100;
    } else if (changePctVal === null && changeVal !== null && closeVal !== null && closeVal !== 0) {
      changePctVal = (changeVal / closeVal) * 100;
    }

    const updated: LiveQuote = {
      ...existing,
      symbol:    sym,
      last:      lastVal,
      bid:       pick(FUT_FIELD.BID)      ?? existing.bid,
      ask:       pick(FUT_FIELD.ASK)      ?? existing.ask,
      bidSize:   pick(FUT_FIELD.BID_SIZE) ?? existing.bidSize,
      askSize:   pick(FUT_FIELD.ASK_SIZE) ?? existing.askSize,
      change:    changeVal,
      changePct: changePctVal,
      volume:    pick(FUT_FIELD.VOLUME)   ?? existing.volume,
      high:      pick(FUT_FIELD.HIGH)     ?? existing.high,
      low:       pick(FUT_FIELD.LOW)      ?? existing.low,
      close:     closeVal,
      ts:        Date.now(),
    };

    quoteCache.set(sym, updated);
    broadcast("quote", updated);
  }
}

// ─── Subscribe to option symbols (batched to stay under WS frame limit) ──────
const OPT_BATCH_SIZE = 200;

function sendOptionSubscribe(symbols: string[]) {
  if (!streamerInfo || !loginAcked || !symbols.length) return;

  for (let i = 0; i < symbols.length; i += OPT_BATCH_SIZE) {
    const batch = symbols.slice(i, i + OPT_BATCH_SIZE);
    const keys = batch.join(",");
    const delay = Math.floor(i / OPT_BATCH_SIZE) * 250;

    const send = () => {
      if (!streamerInfo || !loginAcked) return;
      wsSend({
        requests: [{
          service:                  "LEVELONE_OPTIONS",
          requestid:                nextReq(),
          command:                  "ADD",
          SchwabClientCustomerId:   streamerInfo.schwabClientCustomerId,
          SchwabClientCorrelId:     streamerInfo.schwabClientCorrelId,
          parameters: { keys, fields: OPT_FIELDS_STR },
        }],
      });
    };

    if (delay === 0) {
      send();
    } else {
      setTimeout(send, delay);
    }
  }

  const batches = Math.ceil(symbols.length / OPT_BATCH_SIZE);
  logger.info({ count: symbols.length, batches }, "Streamer: subscribed option symbols");
}

// ─── Parse incoming LEVELONE_OPTIONS DATA messages ──────────────────────────
function handleOptionData(content: Record<string, unknown>[]) {
  for (const item of content) {
    const key = item["key"] as string;
    const existing = optionCache.get(key) ?? {
      key, bid: null, ask: null, last: null,
      bidSize: null, askSize: null, volume: null,
      openInterest: null, iv: null, delta: null,
      gamma: null, theta: null, vega: null,
      mark: null, change: null, ts: 0,
    };

    const pick = (f: number) => {
      const v = item[String(f)];
      return typeof v === "number" && !isNaN(v) ? v : null;
    };

    const updated: OptionTick = {
      ...existing,
      key,
      bid:          pick(OPT_FIELD.BID)        ?? existing.bid,
      ask:          pick(OPT_FIELD.ASK)        ?? existing.ask,
      last:         pick(OPT_FIELD.LAST)       ?? existing.last,
      bidSize:      pick(OPT_FIELD.BID_SIZE)   ?? existing.bidSize,
      askSize:      pick(OPT_FIELD.ASK_SIZE)   ?? existing.askSize,
      volume:       pick(OPT_FIELD.VOLUME)     ?? existing.volume,
      openInterest: pick(OPT_FIELD.OPEN_INT)   ?? existing.openInterest,
      iv:           pick(OPT_FIELD.IV)         ?? existing.iv,
      delta:        pick(OPT_FIELD.DELTA)      ?? existing.delta,
      gamma:        pick(OPT_FIELD.GAMMA)      ?? existing.gamma,
      theta:        pick(OPT_FIELD.THETA)      ?? existing.theta,
      vega:         pick(OPT_FIELD.VEGA)       ?? existing.vega,
      mark:         pick(OPT_FIELD.MARK)       ?? existing.mark,
      change:       pick(OPT_FIELD.NET_CHANGE) ?? existing.change,
      ts:           Date.now(),
    };

    optionCache.set(key, updated);
    broadcast("optionQuote", updated);
  }
}

// ─── WebSocket message handler ───────────────────────────────────────────────
function onMessage(raw: string) {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  // Response to LOGIN / ADD
  if (Array.isArray(msg["response"])) {
    for (const r of msg["response"] as Record<string, unknown>[]) {
      const svc  = r["service"] as string;
      const cmd  = r["command"] as string;
      const code = (r["content"] as Record<string, unknown>)?.["code"];
      if (svc !== "ADMIN") {
        const respCode = (r["content"] as Record<string, unknown>)?.["code"];
        const respMsg  = (r["content"] as Record<string, unknown>)?.["msg"];
        if (respCode !== 0 && respCode !== "0") {
          logger.warn({ svc, cmd, code: respCode, msg: respMsg }, "Streamer: subscription response NON-ZERO");
        } else {
          logger.info({ svc, cmd, code: respCode }, "Streamer: subscription ACK");
        }
      }
      if (svc === "ADMIN" && cmd === "LOGIN") {
        if (code === 0 || code === "0") {
          loginAcked = true;
          reconnectDelay = 1_000;
          logger.info("Streamer: LOGIN OK — broadcasting streamerStatus=connected");
          broadcast("streamerStatus", { status: "connected" });
          if (subscribedSymbols.size > 0) {
            sendSubscribe([...subscribedSymbols]);
          }
          if (subscribedOptionSymbols.size > 0) {
            sendOptionSubscribe([...subscribedOptionSymbols]);
          }
          startEquityResub();
        } else {
          loginRejected = true;
          logger.warn({ code }, "Streamer: LOGIN rejected — will not reconnect (token likely invalid)");
          broadcast("streamerStatus", { status: "rejected", code });
          ws?.close();
        }
      }
    }
  }

  // Real-time market data
  if (Array.isArray(msg["data"])) {
    for (const block of msg["data"] as Record<string, unknown>[]) {
      const svc     = block["service"] as string;
      const content = block["content"] as Record<string, unknown>[] | undefined;
      if (svc === "LEVELONE_EQUITIES" && Array.isArray(content)) {
        handleData(content);
      } else if (svc === "LEVELONE_FUTURES" && Array.isArray(content)) {
        handleFuturesData(content);
      } else if (svc === "LEVELONE_OPTIONS" && Array.isArray(content)) {
        handleOptionData(content);
      }
    }
  }
}

// ─── Connect to Schwab Streamer ───────────────────────────────────────────────
async function connect() {
  if (isConnecting || !accessToken) return;
  isConnecting  = true;
  loginSent     = false;
  loginAcked    = false;

  const info = await fetchStreamerInfo(accessToken);
  if (!info) {
    isConnecting = false;
    if (streamerFetchFailCount >= MAX_FETCH_FAILURES) {
      loginRejected = true;
      logger.warn("Streamer: userPreference failed %d times — treating as rejected", streamerFetchFailCount);
      broadcast("streamerStatus", { status: "rejected" });
      return;
    }
    scheduleReconnect();
    return;
  }
  streamerInfo = info;

  const url = info.streamerSocketUrl.startsWith("wss://")
    ? info.streamerSocketUrl
    : `wss://${info.streamerSocketUrl}`;

  logger.info({ url }, "Streamer: connecting");
  ws = new WebSocket(url);

  ws.on("open", () => {
    logger.info("Streamer: WS open");
    isConnecting = false;
    sendLogin(info, accessToken);
  });

  ws.on("message", (data) => {
    onMessage(data.toString());
  });

  ws.on("close", (code, reason) => {
    logger.warn({ code, reason: reason.toString() }, "Streamer: WS closed");
    ws = null;
    loginSent  = false;
    loginAcked = false;
    isConnecting = false;
    stopEquityResub();
    broadcast("streamerStatus", { status: "disconnected" });
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    logger.error({ err }, "Streamer: WS error");
    ws?.terminate();
    ws = null;
    isConnecting = false;
  });
}

// ─── Reconnect logic (exponential backoff) ────────────────────────────────────
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (!accessToken || sseClients.size === 0) return;
  if (loginRejected) {
    logger.info("Streamer: skipping reconnect — login was rejected (re-auth required)");
    return;
  }

  logger.info({ delay: reconnectDelay }, "Streamer: scheduling reconnect");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    void connect();
  }, reconnectDelay);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Start / restart the streamer with a new access token. */
export async function startStreamer(token: string, symbols: string[]) {
  accessToken = token;
  for (const s of symbols) subscribedSymbols.add(s.toUpperCase());

  // Tear down existing connection if token changed
  if (ws) {
    ws.terminate();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = 1_000;
  isConnecting   = false;
  loginSent      = false;
  loginAcked     = false;
  loginRejected  = false;
  streamerFetchFailCount = 0;

  await connect();
}

/** Add more symbols to the subscription without restarting. */
export function addSymbols(symbols: string[]) {
  const newOnes: string[] = [];
  for (const s of symbols) {
    const up = s.toUpperCase();
    if (!subscribedSymbols.has(up)) {
      subscribedSymbols.add(up);
      newOnes.push(up);
    }
  }
  if (newOnes.length) {
    sendSubscribe(newOnes);
  }
}

/** Add option contract symbols to stream (e.g. "SPY   260330C00632000"). */
export function addOptionSymbols(symbols: string[]) {
  const newOnes: string[] = [];
  for (const s of symbols) {
    if (!subscribedOptionSymbols.has(s)) {
      subscribedOptionSymbols.add(s);
      newOnes.push(s);
    }
  }
  if (newOnes.length) {
    sendOptionSubscribe(newOnes);
  }
}

/** Register an SSE response as a subscriber; returns cleanup function. */
export function addSseClient(res: Response): () => void {
  sseClients.add(res);
  logger.info({ total: sseClients.size }, "SSE client connected");

  sseWrite(res, "streamerStatus", {
    status: loginAcked ? "connected"
      : loginRejected ? "rejected"
      : (isConnecting || loginSent ? "connecting" : "disconnected"),
  });
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

/** Return the current in-memory cache snapshot. */
export function getSnapshot(): LiveQuote[] {
  return [...quoteCache.values()];
}

export function getStreamerStatus(): string {
  if (loginRejected) return "rejected";
  if (loginAcked) return "connected";
  if (isConnecting || loginSent) return "connecting";
  return "disconnected";
}

/** Fully shut down the streamer — close WS, cancel reconnect, clear state. */
export function stopStreamer() {
  if (ws) {
    ws.terminate();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  accessToken = "";
  isConnecting = false;
  loginSent = false;
  loginAcked = false;
  loginRejected = false;
  reconnectDelay = 1_000;
  streamerFetchFailCount = 0;

  broadcast("streamerStatus", { status: "disconnected" });
  logger.info("Streamer: stopped and fully cleared");
}

/** Is the streamer currently connected? */
export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN && loginAcked;
}
