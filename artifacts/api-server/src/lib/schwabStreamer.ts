import type { Response } from "express";
import WebSocket from "ws";
import { logger } from "./logger.js";
import { getValidAccessToken, forceRefresh } from "./tokenStore.js";
import { sendPushToAll } from "./pushService.js";
import { handleFillForExitStaging } from "./exitStaging.js";
import { logFailure } from "./telemetry.js";
import { emitTelemetry } from "./telemetryStore.js";

export interface LiveQuote {
  symbol:       string;
  last:         number | null;
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
  close:        number | null;
  ts:           number;
}

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
  ts:           number;
}

const EQ_FIELDS = "0,1,2,3,4,5,8,10,11,12,15,28,29";
const FUT_FIELDS = "0,1,2,3,4,5,8,12,13,14,19,24";
let acctActivitySubscribed = false;

const MONTH_CODES = "FGHJKMNQUVXZ";
const QUARTERLY_ROOTS = new Set([
  "ES","NQ","RTY","YM","MES","MNQ","M2K",
  "6E","6J","6B","6A","6C","EMD",
  "ZB","ZN","ZF","ZT","UB",
]);

const EARLY_ROLL_ROOTS = new Set<string>(["BZ"]);

const FUTURES_ROOT_ALIAS: Record<string, string> = {
  "VIX": "VX",
};

export function schwabFuturesKey(displaySymbol: string): string {
  const rawBare = displaySymbol.replace(/^\//, "");
  const bare = FUTURES_ROOT_ALIAS[rawBare] ?? rawBare;
  const now = new Date();
  const y2 = now.getFullYear() % 100;
  const month = now.getMonth();
  const day = now.getDate();

  if (QUARTERLY_ROOTS.has(bare)) {
    const quarters = [2, 5, 8, 11];
    for (const q of quarters) {
      if (month < q || (month === q && day <= 20)) {
        return `/${bare}${MONTH_CODES[q]}${y2}`;
      }
    }
    return `/${bare}${MONTH_CODES[2]}${y2 + 1}`;
  }
  const rollAhead = EARLY_ROLL_ROOTS.has(bare) ? 2 : 1;
  let fm = month + rollAhead;
  let fy = y2;
  if (day > 20) { fm++; }
  if (fm > 11) { fm -= 12; fy++; }
  return `/${bare}${MONTH_CODES[fm]}${fy}`;
}

const futuresKeyToDisplay = new Map<string, string>();

const alertSeenSet = new Map<string, number>();
const ALERT_DEDUP_TTL_MS = 60_000;

export function markAlertSeen(orderId: string, eventType: string): void {
  const key = `${orderId}:${eventType}`;
  alertSeenSet.set(key, Date.now());
  setTimeout(() => alertSeenSet.delete(key), ALERT_DEDUP_TTL_MS);
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

function normalizeEquityKey(sym: string): string {
  const upper = sym.toUpperCase();
  return SCHWAB_INDEX_NORM[upper] ?? upper;
}

let wsBroadcast: ((event: string, data: unknown) => void) | null = null;
let schwabWs: WebSocket | null = null;
let streamerInfo: StreamerInfo | null = null;
let subscribedSymbols = new Set<string>();
let subscribedFuturesSymbols = new Set<string>();
let subscribedOptionSymbols = new Set<string>();
let subscribedFuturesOptionSymbols = new Set<string>();
let requestCounter = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 60_000;
let connectionState: "disconnected" | "connecting" | "connected" = "disconnected";
let loginRetried = false;
let lastConnectedAt: number | null = null;
let disconnectedAt: number | null = null;
let fiveMinCriticalSent = false;
let acctActivitySubTimeout: ReturnType<typeof setTimeout> | null = null;

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
  return quoteCache.get(symbol);
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
  for (const [k, v] of futuresKeyToDisplay.entries()) fkMap[k] = v;
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
    schwabWs.send(JSON.stringify({ requests: [loginReq] }));
    logger.info("Schwab streamer: LOGIN sent");
  }
}

function sendEquitySubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("LEVELONE_EQUITIES", "SUBS", {
    keys: symbols.join(","),
    fields: EQ_FIELDS,
  });

  if (req) {
    schwabWs.send(JSON.stringify({ requests: [req] }));
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: LEVELONE_EQUITIES SUBS sent");
  }
}

function sendFuturesSubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("LEVELONE_FUTURES", "SUBS", {
    keys: symbols.join(","),
    fields: FUT_FIELDS,
  });

  if (req) {
    schwabWs.send(JSON.stringify({ requests: [req] }));
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: LEVELONE_FUTURES SUBS sent");
  }
}

function sendOptionSubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("LEVELONE_OPTIONS", "SUBS", {
    keys: symbols.join(","),
    fields: "0,2,3,4,8,9,10,16,17,19,28,29,30,31,37",
  });

  if (req) {
    schwabWs.send(JSON.stringify({ requests: [req] }));
    logger.info({ count: symbols.length }, "Schwab streamer: LEVELONE_OPTIONS SUBS sent");
  }
}

function sendFuturesOptionSubscription(symbols: string[]) {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo || !symbols.length) return;

  const req = buildRequest("LEVELONE_FUTURES_OPTIONS", "SUBS", {
    keys: symbols.join(","),
    fields: "0,2,3,4,8,9,10,16,17,19,28,29,30,31,37",
  });

  if (req) {
    schwabWs.send(JSON.stringify({ requests: [req] }));
    logger.info({ count: symbols.length, sample: symbols.slice(0, 5).join(",") }, "Schwab streamer: LEVELONE_FUTURES_OPTIONS SUBS sent");
  }
}

function sendAcctActivitySubscription() {
  if (!schwabWs || schwabWs.readyState !== WebSocket.OPEN || !streamerInfo) return;
  if (acctActivitySubscribed) return;

  const req = buildRequest("ACCT_ACTIVITY", "SUBS", {
    keys: streamerInfo.schwabClientCorrelId,
    fields: "0,1,2,3",
  });

  if (req) {
    schwabWs.send(JSON.stringify({ requests: [req] }));
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

    if (msgData) {
      logger.info(msgData, "Schwab ACCT_ACTIVITY raw payload");
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
        pushBody = `${sym} order REJECTED`.trim();
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

function processEquityTick(content: Record<string, unknown>[]) {
  const now = Date.now();
  for (const item of content) {
    const rawKey = item["key"] as string;
    if (!rawKey) continue;
    const symbol = normalizeEquityKey(rawKey);

    const existing = quoteCache.get(symbol);
    const last = numOrNull(item["3"]) ?? existing?.last ?? null;
    const close = numOrNull(item["12"]) ?? existing?.close ?? null;

    let change: number | null = existing?.change ?? null;
    let changePct: number | null = existing?.changePct ?? null;
    if (last !== null && close !== null && close !== 0) {
      change = last - close;
      changePct = (change / close) * 100;
    }

    const quote: LiveQuote = {
      symbol,
      last,
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
    };

    quoteCache.set(symbol, quote);
    broadcast("quote", quote);
  }
}

function processOptionTick(content: Record<string, unknown>[]) {
  const now = Date.now();
  for (const item of content) {
    const key = item["key"] as string;
    if (!key) continue;

    const tick: OptionTick = {
      key,
      bid: numOrNull(item["2"]),
      ask: numOrNull(item["3"]),
      last: numOrNull(item["4"]),
      bidSize: numOrNull(item["16"]),
      askSize: numOrNull(item["17"]),
      volume: numOrNull(item["8"]),
      openInterest: numOrNull(item["9"]),
      iv: numOrNull(item["10"]),
      delta: numOrNull(item["28"]),
      gamma: numOrNull(item["29"]),
      theta: numOrNull(item["30"]),
      vega: numOrNull(item["31"]),
      mark: numOrNull(item["37"]),
      change: numOrNull(item["19"]),
      ts: now,
    };

    optionCache.set(key, tick);
    broadcast("optionQuote", tick);
  }
}

function processFuturesTick(content: Record<string, unknown>[]) {
  const now = Date.now();
  for (const item of content) {
    const rawKey = item["key"] as string;
    if (!rawKey) continue;

    const displaySymbol = futuresKeyToDisplay.get(rawKey) ?? rawKey;
    if (!futuresKeyToDisplay.has(rawKey)) {
      logger.info({ rawKey, displaySymbol, knownKeys: [...futuresKeyToDisplay.keys()].slice(0, 5) }, "Schwab futures: unmapped key received");
    }

    const existing = quoteCache.get(displaySymbol);
    const last = numOrNull(item["3"]) ?? existing?.last ?? null;
    const close = numOrNull(item["14"]) ?? existing?.close ?? null;

    let change: number | null = numOrNull(item["19"]) ?? existing?.change ?? null;
    let changePct: number | null = existing?.changePct ?? null;
    if (last !== null && close !== null && close !== 0) {
      change = last - close;
      changePct = (change / close) * 100;
    }

    const quote: LiveQuote = {
      symbol: displaySymbol,
      last,
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
    };

    quoteCache.set(displaySymbol, quote);
    broadcast("quote", quote);
  }
}

function numOrNull(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function handleMessage(raw: string) {
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

      if (service !== "ADMIN") {
        logger.info({ service, command, code, msg: msgText }, "Schwab streamer: subscription response");
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
          connectionState = "connected";
          loginRetried = false;
          lastConnectedAt = Date.now();
          disconnectedAt = null;
          fiveMinCriticalSent = false;
          broadcast("streamerStatus", { status: "connected" });
          reconnectDelay = 2000;

          if (subscribedSymbols.size > 0) {
            sendEquitySubscription([...subscribedSymbols]);
          }
          if (subscribedFuturesSymbols.size > 0) {
            sendFuturesSubscription([...subscribedFuturesSymbols]);
          }
          if (subscribedOptionSymbols.size > 0) {
            sendOptionSubscription([...subscribedOptionSymbols]);
          }
          if (subscribedFuturesOptionSymbols.size > 0) {
            sendFuturesOptionSubscription([...subscribedFuturesOptionSymbols]);
          }
          sendAcctActivitySubscription();
        } else {
          logger.error({ code, msg: msgText }, "Schwab streamer: LOGIN failed");
          void logFailure("SCHWAB_STREAM", "ERROR", `Schwab WebSocket LOGIN failed (code ${code})`, { code, msg: msgText });
          connectionState = "disconnected";

          if (!loginRetried && (code === 3 || (msgText && msgText.toLowerCase().includes("expired")))) {
            loginRetried = true;
            logger.info("Schwab streamer: token may be stale — force-refreshing and retrying");
            void forceRefresh("trader").then((ok) => {
              if (ok) {
                if (schwabWs) {
                  try { schwabWs.close(); } catch {}
                  schwabWs = null;
                }
                void connectSchwabStreamer();
              } else {
                logger.error("Schwab streamer: force refresh failed — cannot retry LOGIN");
                scheduleReconnect();
              }
            });
          } else {
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
  if (schwabWs && (schwabWs.readyState === WebSocket.OPEN || schwabWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  connectionState = "connecting";
  broadcast("streamerStatus", { status: "connecting" });

  streamerInfo = await fetchStreamerInfo();
  if (!streamerInfo) {
    logger.warn("Schwab streamer: cannot connect — no streamer info");
    connectionState = "disconnected";
    scheduleReconnect();
    return;
  }

  logger.info({ url: streamerInfo.streamerSocketUrl }, "Schwab streamer: connecting");

  try {
    schwabWs = new WebSocket(streamerInfo.streamerSocketUrl);
  } catch (err) {
    logger.error({ err }, "Schwab streamer: WebSocket constructor failed");
    connectionState = "disconnected";
    scheduleReconnect();
    return;
  }

  schwabWs.on("open", () => {
    logger.info("Schwab streamer: WebSocket connected");
    emitTelemetry("SCHWAB_STREAM", "INFO", "Schwab WebSocket connected", { url: streamerInfo.streamerSocketUrl });
    sendLogin();
  });

  schwabWs.on("message", (data: Buffer | string) => {
    const raw = typeof data === "string" ? data : data.toString("utf-8");
    handleMessage(raw);
  });

  schwabWs.on("close", (code, reason) => {
    const sessionDuration = lastConnectedAt ? Date.now() - lastConnectedAt : null;
    logger.warn({ code, reason: reason?.toString(), sessionDurationMs: sessionDuration }, "Schwab streamer: WebSocket closed");
    void logFailure("SCHWAB_STREAM", "WARN", `Schwab WebSocket disconnected (code ${code})`, { code, reason: reason?.toString(), sessionDurationMs: sessionDuration });
    schwabWs = null;
    connectionState = "disconnected";
    acctActivitySubscribed = false;
    disconnectedAt = Date.now();
    fiveMinCriticalSent = false;
    broadcast("streamerStatus", { status: "disconnected" });
    scheduleReconnect();
  });

  schwabWs.on("error", (err) => {
    logger.error({ err }, "Schwab streamer: WebSocket error");
  });
}

export async function startStreamer(_token?: string, symbols?: string[]): Promise<void> {
  if (symbols?.length) {
    for (const s of symbols) subscribedSymbols.add(normalizeEquityKey(s));
  }

  if (!getValidAccessToken("trader")) {
    logger.warn("Schwab streamer: no valid token — will connect when tokens become available");
    return;
  }

  await connectSchwabStreamer();
}

setInterval(() => {
  if (connectionState !== "connected") return;
  const equityKeys: string[] = [];
  const futuresKeys: string[] = [];
  let withLast = 0;
  for (const [key, q] of quoteCache.entries()) {
    if (key.startsWith("/")) futuresKeys.push(key);
    else equityKeys.push(key);
    if (q.last !== null) withLast++;
  }
  logger.info({
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
  if (schwabWs) {
    try { schwabWs.close(); } catch {}
    schwabWs = null;
  }
  connectionState = "disconnected";
  subscribedSymbols.clear();
  subscribedFuturesSymbols.clear();
  subscribedOptionSymbols.clear();
  subscribedFuturesOptionSymbols.clear();
  acctActivitySubscribed = false;
}

export function addSymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    const normalized = normalizeEquityKey(s);
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
    const key = isFuture ? schwabFuturesKey(ds) : ds;
    futuresKeyToDisplay.set(key, ds.toUpperCase());
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

export function addOptionSymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    if (!subscribedOptionSymbols.has(s)) {
      subscribedOptionSymbols.add(s);
      newSyms.push(s);
    }
  }

  if (newSyms.length > 0 && connectionState === "connected") {
    sendOptionSubscription([...subscribedOptionSymbols]);
  }
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

export function onTokenRefreshed() {
  if (connectionState === "disconnected" && (subscribedSymbols.size > 0 || subscribedFuturesSymbols.size > 0)) {
    logger.info({ equityCount: subscribedSymbols.size, futuresCount: subscribedFuturesSymbols.size }, "Schwab streamer: token refreshed — attempting connection");
    void connectSchwabStreamer();
  }
}
