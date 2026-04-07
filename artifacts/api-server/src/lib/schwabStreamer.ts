import type { Response } from "express";
import WebSocket from "ws";
import { logger } from "./logger.js";
import { getValidAccessToken, forceRefresh } from "./tokenStore.js";
import { sendPushToAll } from "./pushService.js";

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
]);

const EARLY_ROLL_ROOTS = new Set(["BZ"]);

export function schwabFuturesKey(displaySymbol: string): string {
  const bare = displaySymbol.replace(/^\//, "");
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

const quoteCache = new Map<string, LiveQuote>();
const optionCache = new Map<string, OptionTick>();
const sseClients = new Set<Response>();

let wsBroadcast: ((event: string, data: unknown) => void) | null = null;
let schwabWs: WebSocket | null = null;
let streamerInfo: StreamerInfo | null = null;
let subscribedSymbols = new Set<string>();
let subscribedFuturesSymbols = new Set<string>();
let subscribedOptionSymbols = new Set<string>();
let requestCounter = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 60_000;
let connectionState: "disconnected" | "connecting" | "connected" = "disconnected";
let loginRetried = false;

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
    fields: "0,1,2,3,4,5,6,7,8,12,20,21,22,23,24,29",
  });

  if (req) {
    schwabWs.send(JSON.stringify({ requests: [req] }));
    logger.info({ count: symbols.length }, "Schwab streamer: LEVELONE_OPTIONS SUBS sent");
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
  }
}

function processAcctActivity(content: Record<string, unknown>[]) {
  for (const item of content) {
    const seqNum = item["1"] as string | undefined;
    const msgType = item["2"] as string | undefined;
    const msgData = item["3"] as string | undefined;

    if (msgType === "SUBSCRIBED" || (!msgType && !msgData)) {
      logger.debug({ seqNum, msgType }, "Schwab ACCT_ACTIVITY heartbeat");
      return;
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
    const extracted = extractAcctFields(parsed);

    const alertPayload: Record<string, unknown> = {
      type: msgType ?? "UNKNOWN",
      timestamp: Date.now(),
      orderId,
      symbol: extracted.symbol,
      side: extracted.side,
      quantity: extracted.quantity,
      price: extracted.price,
      orderType: extracted.orderType,
      raw: msgData ?? "",
    };

    const sym = extracted.symbol ?? "";
    const qty = extracted.quantity ?? "";
    const price = extracted.price ?? "";
    const side = extracted.side ?? "";

    let pushBody = "";
    let pushTag = "acct-activity";

    switch (msgType) {
      case "OrderCreated":
        pushBody = `${side} ${qty} ${sym} order CREATED`.trim();
        pushTag = "OrderCreated";
        break;
      case "OrderAccepted":
        pushTag = "OrderAccepted";
        break;
      case "ExecutionCreated":
        pushBody = `${side} ${qty} ${sym} FILLED @ $${price}`.trim();
        pushTag = "ExecutionCreated";
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

function extractAcctFields(obj: Record<string, unknown>): {
  symbol: string | null; side: string | null; quantity: string | null;
  price: string | null; orderType: string | null;
} {
  const result = { symbol: null as string | null, side: null as string | null,
    quantity: null as string | null, price: null as string | null,
    orderType: null as string | null };

  const json = JSON.stringify(obj);
  const symMatch = json.match(/"Symbol"\s*:\s*"([^"]+)"/);
  const sideMatch = json.match(/"(?:Instruction|Side|OrderSide)"\s*:\s*"([^"]+)"/);
  const qtyMatch = json.match(/"(?:Quantity|FilledQuantity|OriginalQuantity)"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
  const priceMatch = json.match(/"(?:ExecutionPrice|Price|LimitPrice|AveragePrice)"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
  const typeMatch = json.match(/"(?:OrderType)"\s*:\s*"([^"]+)"/);

  if (symMatch) result.symbol = symMatch[1];
  if (sideMatch) result.side = sideMatch[1];
  if (qtyMatch) result.quantity = qtyMatch[1];
  if (priceMatch) result.price = priceMatch[1];
  if (typeMatch) result.orderType = typeMatch[1];

  return result;
}

function processEquityTick(content: Record<string, unknown>[]) {
  const now = Date.now();
  for (const item of content) {
    const symbol = item["key"] as string;
    if (!symbol) continue;

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
      bid: numOrNull(item["1"]),
      ask: numOrNull(item["2"]),
      last: numOrNull(item["3"]),
      bidSize: numOrNull(item["4"]),
      askSize: numOrNull(item["5"]),
      volume: numOrNull(item["6"]),
      openInterest: numOrNull(item["7"]),
      iv: numOrNull(item["8"]),
      delta: numOrNull(item["12"]),
      gamma: numOrNull(item["20"]),
      theta: numOrNull(item["21"]),
      vega: numOrNull(item["22"]),
      mark: numOrNull(item["23"]),
      change: numOrNull(item["24"]),
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
        }
      }
      if (service === "ADMIN" && command === "LOGIN") {
        if (code === 0) {
          logger.info("Schwab streamer: LOGIN successful");
          connectionState = "connected";
          loginRetried = false;
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
          sendAcctActivitySubscription();
        } else {
          logger.error({ code, msg: msgText }, "Schwab streamer: LOGIN failed");
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
    sendLogin();
  });

  schwabWs.on("message", (data: Buffer | string) => {
    const raw = typeof data === "string" ? data : data.toString("utf-8");
    handleMessage(raw);
  });

  schwabWs.on("close", (code, reason) => {
    logger.warn({ code, reason: reason?.toString() }, "Schwab streamer: WebSocket closed");
    schwabWs = null;
    connectionState = "disconnected";
    acctActivitySubscribed = false;
    broadcast("streamerStatus", { status: "disconnected" });
    scheduleReconnect();
  });

  schwabWs.on("error", (err) => {
    logger.error({ err }, "Schwab streamer: WebSocket error");
  });
}

export async function startStreamer(_token?: string, symbols?: string[]): Promise<void> {
  if (symbols?.length) {
    for (const s of symbols) subscribedSymbols.add(s.toUpperCase());
  }

  if (!getValidAccessToken("trader")) {
    logger.warn("Schwab streamer: no valid token — will connect when tokens become available");
    return;
  }

  await connectSchwabStreamer();
}

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
  acctActivitySubscribed = false;
}

export function addSymbols(symbols: string[]) {
  const newSyms: string[] = [];
  for (const s of symbols) {
    const upper = s.toUpperCase();
    if (!subscribedSymbols.has(upper)) {
      subscribedSymbols.add(upper);
      newSyms.push(upper);
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

export function onTokenRefreshed() {
  if (connectionState === "disconnected" && subscribedSymbols.size > 0) {
    logger.info("Schwab streamer: token refreshed — attempting connection");
    void connectSchwabStreamer();
  }
}
