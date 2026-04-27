import WebSocket from "ws";
import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";

// ── Polygon Options WebSocket client ──────────────────────────────────
//
// Purpose:
//   Shared real-time options trade-tape client used by the Unusual Flow
//   Scan orchestrator (and any future live-options feature). Completely
//   additive — does NOT affect the Schwab streamer or the EOD Polygon
//   snapshot path.
//
// Behavior & constraints:
//   * Env-gated by POLYGON_OPTIONS_WS_ENABLED=1. When off, every entry
//     point is a no-op that reports disabled — so Autoscale deploys do
//     not open a socket that would be thrashed by idle-shutdown. Flip
//     the flag only on Reserved VM.
//   * POLYGON_API_KEY required at runtime; auth happens as first message
//     after the socket opens.
//   * Subscription surface is ref-counted: overlapping callers (e.g.
//     two concurrent scans) can add/remove the same OCC symbol without
//     stepping on each other's WS state.
//   * Hard cap MAX_CONCURRENT_SUBS = 1000 (per Polygon's documented
//     per-connection cap for specific option contracts). Over-cap
//     subscribe requests throw — the orchestrator is responsible for
//     not exceeding this in a single scan window.
//   * Reconnect hardening mirrors the Schwab streamer:
//       - connect + auth timeouts
//       - ping/pong keepalive with watchdog
//       - socket-identity guard (isCurrent) on every async callback
//       - split transport vs auth backoff
//       - age-gated CONNECTING termination
//   * Polygon's server emits JSON arrays of events; handler dispatches
//     T (trade) and A (aggregate) messages to registered listeners.

const POLYGON_WS_URL = "wss://socket.polygon.io/options";
const CONNECT_TIMEOUT_MS = 15_000;
const AUTH_RESPONSE_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 45_000;
const MAX_RECONNECT_DELAY = 60_000;
const SUB_BATCH_SIZE = 200; // keep "subscribe" control frames bounded
const MAX_CONCURRENT_SUBS = 1000;

export interface PolygonOptionTrade {
  sym: string;         // "O:SPY251219C00450000"
  price: number;
  size: number;
  exchange: number;
  conditions: number[];
  timestamp: number;   // ms epoch (from `t`, SIP timestamp)
  sequence?: number;
}

export interface PolygonOptionAgg {
  sym: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  startTs: number;     // s, bar start
  endTs: number;       // e, bar end
}

export interface PolygonOptionQuote {
  sym: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  bidExchange: number;
  askExchange: number;
  timestamp: number;   // ms epoch
}

export interface NbboSnapshot {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  ts: number;
}

type TradeHandler = (t: PolygonOptionTrade) => void;
type AggHandler = (a: PolygonOptionAgg) => void;
type QuoteHandler = (q: PolygonOptionQuote) => void;

let ws: WebSocket | null = null;
let connectionState: "disabled" | "disconnected" | "connecting" | "authenticating" | "connected" = "disabled";
let connectAttemptStartedAt: number | null = null;

// Ref-counted T (trade) subscriptions. Used by the bulk Unusual Flow scan
// AND by the live time-and-sales SSE path; ref-counts keep both code paths
// independent (one decrement won't kill a sub the other still wants).
const subRefcounts = new Map<string, number>();
const liveSubs = new Set<string>();

// Ref-counted Q (quote) subscriptions. Currently used only by the live
// time-and-sales SSE path for NBBO-based Lee-Ready aggressor inference.
const quoteSubRefcounts = new Map<string, number>();
const liveQuoteSubs = new Set<string>();

// Per-contract NBBO cache, updated on every Q event. Read by the trade
// classifier to tag incoming trades with aggressor side. Cleared on close.
const nbboCache = new Map<string, NbboSnapshot>();

const tradeHandlers = new Set<TradeHandler>();
const aggHandlers = new Set<AggHandler>();
const quoteHandlers = new Set<QuoteHandler>();

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000;
let connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let authTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let pingIntervalTimer: ReturnType<typeof setInterval> | null = null;
let pongWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

let consecutiveAbnormalCloses = 0;
let consecutiveAuthFailures = 0;
const AUTH_FAILURE_ALERT_THRESHOLD = 3;

let connectReadyResolvers: Array<() => void> = [];
let connectReadyRejecters: Array<(e: Error) => void> = [];

// ── Entry gates ──────────────────────────────────────────────────────

export function isEnabled(): boolean {
  return process.env["POLYGON_OPTIONS_WS_ENABLED"] === "1";
}

export function getStatus(): {
  enabled: boolean;
  connectionState: string;
  subscribedCount: number;
  liveCount: number;
  quoteSubscribedCount: number;
  quoteLiveCount: number;
  nbboCacheSize: number;
  consecutiveAuthFailures: number;
  consecutiveAbnormalCloses: number;
} {
  return {
    enabled: isEnabled(),
    connectionState,
    subscribedCount: subRefcounts.size,
    liveCount: liveSubs.size,
    quoteSubscribedCount: quoteSubRefcounts.size,
    quoteLiveCount: liveQuoteSubs.size,
    nbboCacheSize: nbboCache.size,
    consecutiveAuthFailures,
    consecutiveAbnormalCloses,
  };
}

/** Read the most recent NBBO snapshot for a contract, or undefined. */
export function getNbbo(sym: string): NbboSnapshot | undefined {
  return nbboCache.get(normalizeOccSymbol(sym));
}

// ── Handler registry ─────────────────────────────────────────────────

export function onTrade(h: TradeHandler): () => void {
  tradeHandlers.add(h);
  return () => { tradeHandlers.delete(h); };
}

export function onAgg(h: AggHandler): () => void {
  aggHandlers.add(h);
  return () => { aggHandlers.delete(h); };
}

export function onQuote(h: QuoteHandler): () => void {
  quoteHandlers.add(h);
  return () => { quoteHandlers.delete(h); };
}

// ── Public API ───────────────────────────────────────────────────────

export async function ensureConnected(): Promise<void> {
  if (!isEnabled()) {
    throw new Error("POLYGON_OPTIONS_WS_ENABLED is not set — Polygon options WS is disabled");
  }
  if (!process.env["POLYGON_API_KEY"]) {
    throw new Error("POLYGON_API_KEY is not set — cannot authenticate Polygon options WS");
  }
  if (connectionState === "connected") return;

  return new Promise<void>((resolve, reject) => {
    connectReadyResolvers.push(resolve);
    connectReadyRejecters.push(reject);
    if (connectionState === "disabled" || connectionState === "disconnected") {
      void connectPolygon();
    }
    // Safety timeout — if connect never resolves, reject.
    setTimeout(() => {
      if (connectionState !== "connected") {
        const idx = connectReadyRejecters.indexOf(reject);
        if (idx !== -1) {
          connectReadyRejecters.splice(idx, 1);
          connectReadyResolvers.splice(idx, 1);
          reject(new Error("Polygon options WS: ensureConnected timed out"));
        }
      }
    }, CONNECT_TIMEOUT_MS + AUTH_RESPONSE_TIMEOUT_MS + 2000);
  });
}

/**
 * Ref-count-increment each symbol and send a SUBSCRIBE for the newly
 * first-referenced ones. Caller MUST pair with unsubscribeContracts.
 * Throws if adding would exceed MAX_CONCURRENT_SUBS.
 */
export async function subscribeContracts(syms: string[]): Promise<void> {
  if (!isEnabled()) throw new Error("Polygon options WS disabled");
  if (!syms.length) return;

  // Normalize + dedupe first so (a) cap projection is accurate (callers
  // passing dup symbols won't falsely trip the cap) and (b) ref-count
  // mutations are exactly once per distinct symbol.
  const normalized = Array.from(new Set(syms.map(normalizeOccSymbol)));

  // Pre-check cap — count how many distinct NEW symbols would be added.
  let projectedSize = subRefcounts.size;
  for (const s of normalized) {
    if (!subRefcounts.has(s)) projectedSize++;
  }
  if (projectedSize > MAX_CONCURRENT_SUBS) {
    throw new Error(
      `Polygon options WS: subscribe would exceed cap (projected=${projectedSize}, max=${MAX_CONCURRENT_SUBS})`,
    );
  }

  // Connect BEFORE mutating refcounts so a connect/auth failure doesn't
  // leak ghost entries into the desired-sub set. A leaked entry would
  // (a) falsely consume cap on later scans, and (b) be replayed via
  // SUBSCRIBE after the next auth_success — attaching us to symbols no
  // live scan is listening for. (Flagged by code review.)
  await ensureConnected();

  const newlyFirst: string[] = [];
  for (const s of normalized) {
    const cur = subRefcounts.get(s) ?? 0;
    if (cur === 0) newlyFirst.push(s);
    subRefcounts.set(s, cur + 1);
  }

  if (newlyFirst.length && connectionState === "connected") {
    sendSubscribe(newlyFirst);
    for (const s of newlyFirst) liveSubs.add(s);
  }
}

/**
 * Ref-count-decrement each symbol; send UNSUBSCRIBE only for those whose
 * count hits zero.
 */
export function unsubscribeContracts(syms: string[]): void {
  if (!isEnabled()) return;
  if (!syms.length) return;
  const normalized = syms.map(normalizeOccSymbol);
  const nowZero: string[] = [];
  for (const s of normalized) {
    const cur = subRefcounts.get(s) ?? 0;
    if (cur <= 1) {
      subRefcounts.delete(s);
      nowZero.push(s);
    } else {
      subRefcounts.set(s, cur - 1);
    }
  }
  if (nowZero.length && ws?.readyState === WebSocket.OPEN && connectionState === "connected") {
    sendUnsubscribe(nowZero);
    for (const s of nowZero) liveSubs.delete(s);
  }
}

/**
 * Paired subscribe: bumps the T-channel ref count (via subscribeContracts)
 * AND a parallel Q-channel ref count, then sends a Q.O subscribe for any
 * newly-first quote sub. Used by the live time-and-sales SSE path so that
 * every trade can be classified against a fresh NBBO snapshot.
 *
 * Channel-cap accounting: this consumes 2 slots per contract (T + Q)
 * against Polygon's per-connection 1000-channel cap. We pre-check the
 * COMBINED projected channel count (existing T + existing Q + newly added)
 * up front so we never silently overrun the connection cap by enforcing T
 * and Q caps independently. If the combined cap would be exceeded we throw
 * BEFORE mutating any state, leaving the existing subscriptions untouched.
 */
export async function subscribeContractsWithQuotes(syms: string[]): Promise<void> {
  if (!isEnabled()) throw new Error("Polygon options WS disabled");
  if (!syms.length) return;
  const normalized = Array.from(new Set(syms.map(normalizeOccSymbol)));

  // Pre-check COMBINED T+Q channel cap. Each contract may add up to 2
  // channels (one T, one Q) but only when its respective ref-count is
  // currently zero. Compute the projected channel total atomically so a
  // failure here cannot leave T mutated and Q rolled back (or vice versa).
  let projectedT = subRefcounts.size;
  let projectedQ = quoteSubRefcounts.size;
  for (const s of normalized) {
    if (!subRefcounts.has(s)) projectedT++;
    if (!quoteSubRefcounts.has(s)) projectedQ++;
  }
  const combined = projectedT + projectedQ;
  if (combined > MAX_CONCURRENT_SUBS) {
    throw new Error(
      `Polygon options WS: paired T+Q subscribe would exceed combined channel cap (projected T=${projectedT} + Q=${projectedQ} = ${combined}, max=${MAX_CONCURRENT_SUBS})`,
    );
  }

  // Subscribe the T channel first (also ensures connection). The T cap
  // check inside subscribeContracts is now redundant for this caller but
  // still serves direct callers, so it stays in place.
  await subscribeContracts(normalized);

  const newlyFirst: string[] = [];
  for (const s of normalized) {
    const cur = quoteSubRefcounts.get(s) ?? 0;
    if (cur === 0) newlyFirst.push(s);
    quoteSubRefcounts.set(s, cur + 1);
  }
  if (newlyFirst.length && connectionState === "connected") {
    sendSubscribeQuotes(newlyFirst);
    for (const s of newlyFirst) liveQuoteSubs.add(s);
  }
}

/** Reverse of subscribeContractsWithQuotes — drops T and Q ref counts. */
export function unsubscribeContractsWithQuotes(syms: string[]): void {
  if (!isEnabled()) return;
  if (!syms.length) return;
  const normalized = syms.map(normalizeOccSymbol);

  const qNowZero: string[] = [];
  for (const s of normalized) {
    const cur = quoteSubRefcounts.get(s) ?? 0;
    if (cur <= 1) {
      quoteSubRefcounts.delete(s);
      qNowZero.push(s);
    } else {
      quoteSubRefcounts.set(s, cur - 1);
    }
  }
  if (qNowZero.length && ws?.readyState === WebSocket.OPEN && connectionState === "connected") {
    sendUnsubscribeQuotes(qNowZero);
    for (const s of qNowZero) liveQuoteSubs.delete(s);
    // Drop NBBO cache entries for contracts we no longer track.
    for (const s of qNowZero) nbboCache.delete(s);
  }

  unsubscribeContracts(normalized);
}

// ── Symbol helpers ───────────────────────────────────────────────────

/** Normalize caller input to Polygon OCC form: "O:SPY251219C00450000". */
function normalizeOccSymbol(s: string): string {
  const up = s.trim().toUpperCase();
  if (up.startsWith("O:")) return up;
  // Caller may pass raw OCC like "SPY251219C00450000" — prefix it.
  if (/^[A-Z\.\/]{1,6}\d{6}[CP]\d{8}$/.test(up)) return `O:${up}`;
  return up; // fallback; Polygon will reject malformed symbols, orchestrator logs.
}

// ── Subscribe / unsubscribe wire format ──────────────────────────────

function sendSubscribe(syms: string[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (let i = 0; i < syms.length; i += SUB_BATCH_SIZE) {
    const batch = syms.slice(i, i + SUB_BATCH_SIZE);
    const params = batch.map(s => `T.${s}`).join(",");
    try { ws.send(JSON.stringify({ action: "subscribe", params })); } catch {}
  }
  logger.info({ count: syms.length, batches: Math.ceil(syms.length / SUB_BATCH_SIZE) },
    "Polygon options WS: subscribe sent");
}

function sendUnsubscribe(syms: string[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (let i = 0; i < syms.length; i += SUB_BATCH_SIZE) {
    const batch = syms.slice(i, i + SUB_BATCH_SIZE);
    const params = batch.map(s => `T.${s}`).join(",");
    try { ws.send(JSON.stringify({ action: "unsubscribe", params })); } catch {}
  }
  logger.info({ count: syms.length }, "Polygon options WS: unsubscribe sent");
}

function sendSubscribeQuotes(syms: string[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (let i = 0; i < syms.length; i += SUB_BATCH_SIZE) {
    const batch = syms.slice(i, i + SUB_BATCH_SIZE);
    const params = batch.map(s => `Q.${s}`).join(",");
    try { ws.send(JSON.stringify({ action: "subscribe", params })); } catch {}
  }
  logger.info({ count: syms.length, batches: Math.ceil(syms.length / SUB_BATCH_SIZE) },
    "Polygon options WS: quote subscribe sent");
}

function sendUnsubscribeQuotes(syms: string[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (let i = 0; i < syms.length; i += SUB_BATCH_SIZE) {
    const batch = syms.slice(i, i + SUB_BATCH_SIZE);
    const params = batch.map(s => `Q.${s}`).join(",");
    try { ws.send(JSON.stringify({ action: "unsubscribe", params })); } catch {}
  }
  logger.info({ count: syms.length }, "Polygon options WS: quote unsubscribe sent");
}

// ── Connection management ───────────────────────────────────────────

function clearLifecycleTimers(): void {
  if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }
  if (authTimeoutTimer) { clearTimeout(authTimeoutTimer); authTimeoutTimer = null; }
  if (pingIntervalTimer) { clearInterval(pingIntervalTimer); pingIntervalTimer = null; }
  if (pongWatchdogTimer) { clearTimeout(pongWatchdogTimer); pongWatchdogTimer = null; }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (!isEnabled()) return;
  logger.debug({ delayMs: reconnectDelay }, "Polygon options WS: scheduling reconnect");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectPolygon();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function resolveWaiters(): void {
  const r = connectReadyResolvers;
  connectReadyResolvers = [];
  connectReadyRejecters = [];
  for (const fn of r) fn();
}

function rejectWaiters(err: Error): void {
  const r = connectReadyRejecters;
  connectReadyResolvers = [];
  connectReadyRejecters = [];
  for (const fn of r) fn(err);
}

async function connectPolygon(): Promise<void> {
  if (!isEnabled()) {
    connectionState = "disabled";
    return;
  }
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    logger.error("Polygon options WS: POLYGON_API_KEY missing — cannot connect");
    connectionState = "disconnected";
    rejectWaiters(new Error("POLYGON_API_KEY missing"));
    return;
  }

  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  if (ws) {
    if (ws.readyState === WebSocket.OPEN) return;
    if (ws.readyState === WebSocket.CONNECTING) {
      const age = connectAttemptStartedAt ? Date.now() - connectAttemptStartedAt : Number.POSITIVE_INFINITY;
      if (age < CONNECT_TIMEOUT_MS) {
        logger.debug({ ageMs: age }, "Polygon options WS: connect in progress — deferring");
        return;
      }
      logger.warn({ ageMs: age }, "Polygon options WS: stale CONNECTING — terminating");
      try { ws.terminate(); } catch {}
      ws = null;
    }
  }

  clearLifecycleTimers();
  connectAttemptStartedAt = Date.now();
  connectionState = "connecting";

  let sock: WebSocket;
  try {
    sock = new WebSocket(POLYGON_WS_URL);
    ws = sock;
  } catch (err) {
    logger.error({ err }, "Polygon options WS: constructor failed");
    connectionState = "disconnected";
    scheduleReconnect();
    return;
  }

  const isCurrent = () => ws === sock;

  connectTimeoutTimer = setTimeout(() => {
    if (!isCurrent()) return;
    if (sock.readyState === WebSocket.CONNECTING) {
      logger.warn({ timeoutMs: CONNECT_TIMEOUT_MS }, "Polygon options WS: handshake timeout — terminating");
      try { sock.terminate(); } catch {}
    }
  }, CONNECT_TIMEOUT_MS);

  sock.on("open", () => {
    if (!isCurrent()) return;
    logger.info("Polygon options WS: socket open");
    if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }

    // Only reset transport backoff if we're not stuck in an auth-fail loop.
    if (consecutiveAuthFailures === 0) reconnectDelay = 2000;

    pingIntervalTimer = setInterval(() => {
      if (!isCurrent() || sock.readyState !== WebSocket.OPEN) return;
      try { sock.ping(); } catch {}
      if (pongWatchdogTimer) clearTimeout(pongWatchdogTimer);
      pongWatchdogTimer = setTimeout(() => {
        if (!isCurrent()) return;
        logger.warn({ timeoutMs: PONG_TIMEOUT_MS }, "Polygon options WS: pong timeout — terminating");
        try { sock.terminate(); } catch {}
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);

    authTimeoutTimer = setTimeout(() => {
      if (!isCurrent()) return;
      if (connectionState !== "connected") {
        logger.warn({ timeoutMs: AUTH_RESPONSE_TIMEOUT_MS }, "Polygon options WS: auth response timeout — terminating");
        try { sock.terminate(); } catch {}
      }
    }, AUTH_RESPONSE_TIMEOUT_MS);

    connectionState = "authenticating";
    try { sock.send(JSON.stringify({ action: "auth", params: apiKey })); } catch {}
  });

  sock.on("pong", () => {
    if (!isCurrent()) return;
    if (pongWatchdogTimer) { clearTimeout(pongWatchdogTimer); pongWatchdogTimer = null; }
  });

  sock.on("message", (data: Buffer | string) => {
    if (!isCurrent()) return;
    const raw = typeof data === "string" ? data : data.toString("utf-8");
    handleMessage(raw);
  });

  sock.on("close", (code, reason) => {
    if (!isCurrent()) {
      logger.debug({ code }, "Polygon options WS: ignoring close from stale socket");
      return;
    }
    const wasAuthed = connectionState === "connected";
    if (code === 1006 && !wasAuthed) {
      consecutiveAbnormalCloses++;
    } else {
      consecutiveAbnormalCloses = 0;
    }
    logger.warn({ code, reason: reason?.toString(), wasAuthed, consecutiveAbnormalCloses, consecutiveAuthFailures },
      "Polygon options WS: closed");
    void logFailure("POLYGON_OPTIONS_WS", "WARN", `Polygon options WS disconnected (code ${code})`,
      { code, reason: reason?.toString(), wasAuthed });
    clearLifecycleTimers();
    ws = null;
    connectionState = "disconnected";
    liveSubs.clear();
    liveQuoteSubs.clear();
    nbboCache.clear();
    connectAttemptStartedAt = null;
    rejectWaiters(new Error(`Polygon options WS closed (code ${code})`));
    scheduleReconnect();
  });

  sock.on("error", (err) => {
    logger.error({ err }, "Polygon options WS: error");
    if (!isCurrent()) return;
    try { sock.terminate(); } catch {}
  });
}

function handleMessage(raw: string): void {
  let events: unknown;
  try { events = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(events)) return;

  for (const ev of events as Array<Record<string, unknown>>) {
    const kind = ev["ev"];

    if (kind === "status") {
      const status = ev["status"] as string | undefined;
      const msg = ev["message"] as string | undefined;
      logger.info({ status, msg }, "Polygon options WS: status event");
      if (status === "auth_success") {
        if (authTimeoutTimer) { clearTimeout(authTimeoutTimer); authTimeoutTimer = null; }
        connectionState = "connected";
        consecutiveAuthFailures = 0;
        consecutiveAbnormalCloses = 0;
        reconnectDelay = 2000;
        // Resubscribe everything the ref-count says we want — both T and Q.
        const wantedT = [...subRefcounts.keys()];
        if (wantedT.length) {
          sendSubscribe(wantedT);
          liveSubs.clear();
          for (const s of wantedT) liveSubs.add(s);
        }
        const wantedQ = [...quoteSubRefcounts.keys()];
        if (wantedQ.length) {
          sendSubscribeQuotes(wantedQ);
          liveQuoteSubs.clear();
          for (const s of wantedQ) liveQuoteSubs.add(s);
        }
        resolveWaiters();
      } else if (status === "auth_failed") {
        consecutiveAuthFailures++;
        logger.error({ msg, consecutiveAuthFailures }, "Polygon options WS: auth_failed");
        if (consecutiveAuthFailures >= AUTH_FAILURE_ALERT_THRESHOLD) {
          void logFailure("POLYGON_OPTIONS_WS", "CRITICAL",
            `Polygon options WS auth failing repeatedly (${consecutiveAuthFailures})`, { msg });
        }
        connectionState = "disconnected";
        rejectWaiters(new Error(`Polygon auth failed: ${msg}`));
        try { ws?.close(); } catch {}
      }
      continue;
    }

    if (kind === "T") {
      const trade: PolygonOptionTrade = {
        sym: String(ev["sym"] ?? ""),
        price: Number(ev["p"] ?? 0),
        size: Number(ev["s"] ?? 0),
        exchange: Number(ev["x"] ?? 0),
        conditions: Array.isArray(ev["c"]) ? (ev["c"] as number[]) : [],
        timestamp: Number(ev["t"] ?? Date.now()),
        sequence: ev["q"] != null ? Number(ev["q"]) : undefined,
      };
      if (!trade.sym) continue;
      for (const h of tradeHandlers) {
        try { h(trade); } catch (err) { logger.error({ err }, "Polygon options WS: trade handler threw"); }
      }
      continue;
    }

    if (kind === "Q") {
      // Polygon options quote event:
      //   sym, bp (bid price), bs (bid size), bx (bid exchange),
      //   ap (ask price), as (ask size), ax (ask exchange), t (sip ts ms)
      const quote: PolygonOptionQuote = {
        sym: String(ev["sym"] ?? ""),
        bid: Number(ev["bp"] ?? 0),
        ask: Number(ev["ap"] ?? 0),
        bidSize: Number(ev["bs"] ?? 0),
        askSize: Number(ev["as"] ?? 0),
        bidExchange: Number(ev["bx"] ?? 0),
        askExchange: Number(ev["ax"] ?? 0),
        timestamp: Number(ev["t"] ?? Date.now()),
      };
      if (!quote.sym) continue;
      // Cache NBBO BEFORE invoking handlers so any handler that reads
      // getNbbo() in the same tick sees the freshest snapshot.
      if (quote.bid > 0 && quote.ask > 0 && quote.ask >= quote.bid) {
        nbboCache.set(quote.sym, {
          bid: quote.bid,
          ask: quote.ask,
          bidSize: quote.bidSize,
          askSize: quote.askSize,
          ts: quote.timestamp,
        });
      }
      for (const h of quoteHandlers) {
        try { h(quote); } catch (err) { logger.error({ err }, "Polygon options WS: quote handler threw"); }
      }
      continue;
    }

    if (kind === "A" || kind === "AM") {
      const agg: PolygonOptionAgg = {
        sym: String(ev["sym"] ?? ""),
        open: Number(ev["o"] ?? 0),
        high: Number(ev["h"] ?? 0),
        low: Number(ev["l"] ?? 0),
        close: Number(ev["c"] ?? 0),
        volume: Number(ev["v"] ?? 0),
        vwap: ev["vw"] != null ? Number(ev["vw"]) : undefined,
        startTs: Number(ev["s"] ?? 0),
        endTs: Number(ev["e"] ?? 0),
      };
      if (!agg.sym) continue;
      for (const h of aggHandlers) {
        try { h(agg); } catch (err) { logger.error({ err }, "Polygon options WS: agg handler threw"); }
      }
    }
  }
}

export function stopPolygonOptionsWs(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  clearLifecycleTimers();
  if (ws) { try { ws.close(); } catch {}; ws = null; }
  connectionState = isEnabled() ? "disconnected" : "disabled";
  subRefcounts.clear();
  liveSubs.clear();
  quoteSubRefcounts.clear();
  liveQuoteSubs.clear();
  nbboCache.clear();
}
