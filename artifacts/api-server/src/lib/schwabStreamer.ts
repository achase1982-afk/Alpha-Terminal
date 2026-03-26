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
const FIELD = {
  BID:         1,
  ASK:         2,
  LAST:        3,
  VOLUME:      8,
  HIGH:        12,
  LOW:         13,
  CLOSE:       15,   // previous close
  NET_CHANGE:  20,
  NET_PCT:     38,
  MARK:        29,
} as const;

// Fields we actually want to subscribe to (as a comma-separated string)
const FIELDS_STR = "0,1,2,3,8,12,13,15,20,38,29";

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

// ─── Internal state ───────────────────────────────────────────────────────────
interface StreamerInfo {
  streamerSocketUrl:   string;
  customerId:          string;
  correlId:            string;
}

let ws:            WebSocket | null   = null;
let accessToken:   string             = "";
let streamerInfo:  StreamerInfo | null = null;
let reqCounter     = 0;

// Subscribed symbols (user-friendly names, e.g. "SPY", "VIX")
const subscribedSymbols = new Set<string>();

// In-memory price cache keyed by upper-case symbol
const quoteCache = new Map<string, LiveQuote>();

// SSE response writers — one per connected browser tab
const sseClients = new Set<Response>();

// Reconnect state
let reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
let reconnectDelay   = 1_000;   // ms; doubles each time, capped at 30_000
let isConnecting     = false;
let loginSent        = false;
let loginAcked       = false;

// ─── Symbol formatting (mirrors market.ts) ────────────────────────────────────
const INDEX_MAP: Record<string, string> = {
  VIX: "$VIX.X", "$VIX": "$VIX.X",
  SPX: "$SPX.X", "$SPX": "$SPX.X",
  NDX: "$NDX.X", "$NDX": "$NDX.X",
  RUT: "$RUT.X", "$RUT": "$RUT.X",
  DJI: "$DJI.X", "$DJI": "$DJI.X", DJIA: "$DJI.X",
  COMP: "$COMP.X", "$COMP": "$COMP.X",
  DXY: "$DXY.X", "$DXY": "$DXY.X",
  TNX: "$TNX.X", "$TNX": "$TNX.X",
  TYX: "$TYX.X", "$TYX": "$TYX.X",
  VXN: "$VXN.X", "$VXN": "$VXN.X",
  OEX: "$OEX.X", "$OEX": "$OEX.X",
  MNX: "$MNX.X", "$MNX": "$MNX.X",
  XSP: "$XSP.X", "$XSP": "$XSP.X",
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
      logger.warn({ status: res.status }, "userPreference fetch failed");
      return null;
    }
    const json = (await res.json()) as { streamerInfo?: StreamerInfo[] };
    return json.streamerInfo?.[0] ?? null;
  } catch (err) {
    logger.error({ err }, "fetchStreamerInfo error");
    return null;
  }
}

// ─── Login request ────────────────────────────────────────────────────────────
function sendLogin(info: StreamerInfo, token: string) {
  wsSend({
    requests: [{
      service:                  "ADMIN",
      requestid:                nextReq(),
      command:                  "LOGIN",
      SchwabClientCustomerId:   info.customerId,
      SchwabClientCorrelId:     info.correlId,
      parameters: {
        Authorization:              token,
        SchwabClientChannel:        "IO",
        SchwabClientFunctionId:     "APIAPP",
      },
    }],
  });
  loginSent = true;
}

// ─── Subscribe to symbols ────────────────────────────────────────────────────
function sendSubscribe(symbols: string[]) {
  if (!streamerInfo || !loginAcked || !symbols.length) return;
  for (const sym of symbols) {
    const schwabKey = toSchwabKey(sym);
    if (!reverseKeyMap.has(schwabKey)) {
      reverseKeyMap.set(schwabKey, sym.toUpperCase());
    }
  }
  const keys = symbols.map(toSchwabKey).join(",");
  wsSend({
    requests: [{
      service:                  "LEVELONE_EQUITIES",
      requestid:                nextReq(),
      command:                  "ADD",
      SchwabClientCustomerId:   streamerInfo.customerId,
      SchwabClientCorrelId:     streamerInfo.correlId,
      parameters: { keys, fields: FIELDS_STR },
    }],
  });
  logger.info({ keys }, "Streamer: subscribed symbols");
}

// ─── Parse incoming DATA messages ────────────────────────────────────────────
function handleData(content: Record<string, unknown>[]) {
  for (const item of content) {
    const schwabKey = item["key"] as string;
    const sym = fromSchwabKey(schwabKey);

    const existing = quoteCache.get(sym) ?? {
      symbol: sym, last: null, bid: null, ask: null,
      change: null, changePct: null, volume: null,
      high: null, low: null, close: null, ts: 0,
    };

    const pick = (f: number) => {
      const v = item[String(f)];
      return typeof v === "number" && !isNaN(v) ? v : null;
    };

    const updated: LiveQuote = {
      ...existing,
      symbol:    sym,
      last:      pick(FIELD.LAST)       ?? pick(FIELD.MARK)  ?? existing.last,
      bid:       pick(FIELD.BID)                             ?? existing.bid,
      ask:       pick(FIELD.ASK)                             ?? existing.ask,
      change:    pick(FIELD.NET_CHANGE)                      ?? existing.change,
      changePct: pick(FIELD.NET_PCT)                         ?? existing.changePct,
      volume:    pick(FIELD.VOLUME)                          ?? existing.volume,
      high:      pick(FIELD.HIGH)                            ?? existing.high,
      low:       pick(FIELD.LOW)                             ?? existing.low,
      close:     pick(FIELD.CLOSE)                           ?? existing.close,
      ts:        Date.now(),
    };

    // Derive changePct from last-close if Schwab did not send it
    if (updated.changePct === null && updated.last !== null && updated.close !== null && updated.close !== 0) {
      updated.change    = updated.last - updated.close;
      updated.changePct = (updated.change / updated.close) * 100;
    }

    quoteCache.set(sym, updated);
    broadcast("quote", updated);
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
      if (svc === "ADMIN" && cmd === "LOGIN") {
        if (code === 0 || code === "0") {
          loginAcked = true;
          reconnectDelay = 1_000;   // successful handshake → reset backoff
          logger.info("Streamer: LOGIN OK");
          // Subscribe to all symbols that accumulated before login completed
          if (subscribedSymbols.size > 0) {
            sendSubscribe([...subscribedSymbols]);
          }
        } else {
          logger.warn({ code }, "Streamer: LOGIN rejected");
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
  if (!accessToken || sseClients.size === 0) return;  // no point reconnecting

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

/** Register an SSE response as a subscriber; returns cleanup function. */
export function addSseClient(res: Response): () => void {
  sseClients.add(res);
  logger.info({ total: sseClients.size }, "SSE client connected");

  // Send current cache snapshot immediately so the UI has data right away
  for (const quote of quoteCache.values()) {
    sseWrite(res, "quote", quote);
  }
  // Also send a heartbeat so the client knows it's live
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

/** Is the streamer currently connected? */
export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN && loginAcked;
}
