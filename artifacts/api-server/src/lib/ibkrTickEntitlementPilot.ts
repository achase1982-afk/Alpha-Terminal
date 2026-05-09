/**
 * One-shot IBKR tick-by-tick "Last" entitlement pilot for Settings UI diagnostics.
 * Uses a dedicated API clientId — never the production ibStreamer clientId.
 */
import { randomUUID } from "node:crypto";
import { IBApi, EventName, SecType, TickByTickDataType, type Contract } from "@stoqey/ib";
import { desc, eq } from "@workspace/db";
import { db, ibkrDiagnosticsRunsTable } from "@workspace/db";
import { logger } from "./logger.js";

const HOLD_MS = 60_000;
const CONNECT_MS = 25_000;
const MAX_TICKS_PER_SYMBOL = 2_000;

export const TICK_PILOT_SYMBOLS: Array<{ symbol: string; venue: "NASDAQ" | "NYSE" }> = [
  { symbol: "NVDA", venue: "NASDAQ" },
  { symbol: "AAPL", venue: "NASDAQ" },
  { symbol: "MSFT", venue: "NASDAQ" },
  { symbol: "AMD", venue: "NASDAQ" },
  { symbol: "MU", venue: "NASDAQ" },
  { symbol: "JPM", venue: "NYSE" },
  { symbol: "BAC", venue: "NYSE" },
];

const BASE_REQ_ID = 73_000;

function parseGatewayUrl(): { host: string; port: number } {
  const raw = process.env.IBKR_GATEWAY_URL || process.env.IB_HOST;
  if (!raw) return { host: "127.0.0.1", port: 4001 };
  try {
    const url = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    if (url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "http:" || url.protocol === "ws:") {
      return { host: "127.0.0.1", port: 4001 };
    }
    const host = url.hostname || "127.0.0.1";
    const port = url.port ? Number(url.port) : 4001;
    return { host, port };
  } catch {
    return { host: raw, port: Number(process.env.IB_PORT ?? "4001") };
  }
}

function pilotClientId(): number {
  const base = Number(process.env.IB_CLIENT_ID ?? "1");
  const v = process.env.IBKR_TICK_PILOT_CLIENT_ID?.trim();
  if (v) return Number(v);
  /** Default offset avoids colliding with ibStreamer `IB_CLIENT_ID` when unset. */
  return base + 50;
}

function blockThresholdShares(lastPrice: number): number {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return 10_000;
  if (lastPrice < 50) return 10_000;
  if (lastPrice < 200) return 5_000;
  if (lastPrice < 500) return 2_000;
  return 1_000;
}

function serializeTickArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === "bigint") return a.toString();
    if (a instanceof Date) return a.toISOString();
    return a;
  });
}

function parseTickNumbers(args: unknown[]): { price: number | null; size: number | null } {
  /** Common layouts: [time, price, size, ...] or [time, price, size, tickAttribLast, exchange, ...] */
  if (args.length >= 3) {
    const p = args[1];
    const s = args[2];
    if (typeof p === "number" && Number.isFinite(p) && p > 0.01 && p < 1e7) {
      let size: number | null = null;
      if (typeof s === "number" && Number.isFinite(s) && s >= 0 && s < 1e10) size = Math.round(s);
      return { price: p, size };
    }
  }
  if (args.length >= 5) {
    const p = args[3];
    const s = args[4];
    if (typeof p === "number" && Number.isFinite(p) && p > 0.01 && p < 1e7) {
      let size: number | null = null;
      if (typeof s === "number" && Number.isFinite(s) && s >= 0 && s < 1e10) size = Math.round(s);
      return { price: p, size };
    }
  }
  const nums: number[] = [];
  for (const a of args) {
    if (typeof a === "number" && Number.isFinite(a)) nums.push(a);
  }
  if (nums.length === 0) return { price: null, size: null };
  let price: number | null = null;
  for (const n of nums) {
    if (n > 1e9) continue;
    if (n >= 0.01 && n < 1e7 && (!Number.isInteger(n) || (n >= 1 && n < 50000))) {
      price = n;
      break;
    }
  }
  let size: number | null = null;
  for (const n of nums) {
    if (!Number.isInteger(n) || n < 1 || n > 1e9) continue;
    if (price != null && Math.abs(n - price) < 1e-6) continue;
    size = n;
    break;
  }
  return { price, size };
}

function extractExchangeStrings(args: unknown[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (typeof a === "string" && a.length > 0 && a.length <= 12 && /^[A-Z0-9./-]+$/i.test(a)) {
      out.push(a.toUpperCase());
    }
  }
  return [...new Set(out)];
}

function stkSmart(symbol: string): Contract {
  return { symbol, secType: SecType.STK, exchange: "SMART", currency: "USD" };
}

async function connectIb(host: string, port: number, clientId: number): Promise<IBApi> {
  const ib = new IBApi({ host, port, clientId });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ib.disconnect();
      } catch {
        /* ignore */
      }
      reject(new Error(`IB connect timeout after ${CONNECT_MS}ms (${host}:${port})`));
    }, CONNECT_MS);

    const onErr = (err: Error, code: number) => {
      if (code === 502 || code === 504 || String(err.message).includes("ECONNREFUSED")) {
        clearTimeout(timer);
        ib.off(EventName.error, onErr);
        ib.off(EventName.connected, onOk);
        reject(err);
      }
    };
    const onOk = () => {
      clearTimeout(timer);
      ib.off(EventName.error, onErr);
      ib.off(EventName.connected, onOk);
      resolve();
    };

    ib.once(EventName.connected, onOk);
    ib.on(EventName.error, onErr);
    ib.connect();
  });
  return ib;
}

export interface IbkrTickPilotSymbolResult {
  symbol: string;
  venue: "NASDAQ" | "NYSE";
  reqId: number;
  rejected: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  tickCount: number;
  ticksPerSecond: number;
  ticksTruncated: boolean;
  blockCount: number;
  blockThresholdShares: number | null;
  lastPriceUsedForBlock: number | null;
  exchangesObserved: string[];
  ticks: unknown[];
}

export interface IbkrTickPilotSummary {
  nasdaq: "PASS" | "FAIL" | "WARN";
  nyse: "PASS" | "FAIL" | "WARN";
  nasdaqDetail: string;
  nyseDetail: string;
  blockTradeExtrapolation: Record<
    string,
    { blocksObserved60s: number; estimatedBlocksPerRthDay: number; thresholdShares: number | null }
  >;
  gatewayHost: string;
  gatewayPort: number;
  clientId: number;
}

export interface IbkrTickPilotRunResult {
  id: string;
  runStartedAt: string;
  runCompletedAt: string;
  durationSec: number;
  clientId: number;
  perSymbolResults: IbkrTickPilotSymbolResult[];
  globalErrors: Array<{ reqId: number; code: number; message: string }>;
  summary: IbkrTickPilotSummary;
}

function summarizeVenue(
  rows: IbkrTickPilotSymbolResult[],
  venue: "NASDAQ" | "NYSE",
): { status: "PASS" | "FAIL" | "WARN"; detail: string } {
  const subset = rows.filter((r) => r.venue === venue);
  const rejected = subset.filter((r) => r.rejected);
  if (rejected.length > 0) {
    return {
      status: "FAIL",
      detail: `${rejected.map((r) => `${r.symbol}:${r.errorCode}`).join(", ")}`,
    };
  }
  const noTicks = subset.filter((r) => r.tickCount === 0);
  if (noTicks.length === subset.length && subset.length > 0) {
    return { status: "WARN", detail: "No ticks in window (check RTH / symbol liquidity)" };
  }
  if (noTicks.length > 0) {
    return { status: "WARN", detail: `No ticks: ${noTicks.map((r) => r.symbol).join(", ")}` };
  }
  return { status: "PASS", detail: "Streaming Last ticks received" };
}

let activePilot: Promise<IbkrTickPilotRunResult> | null = null;

/** Serialize pilot runs — Gateway cannot overlap two 60s captures. */
export async function runIbkrTickEntitlementPilotSerialized(triggeredByUserId: string): Promise<IbkrTickPilotRunResult> {
  if (activePilot) {
    throw new Error("A tick entitlement test is already running. Wait for it to finish.");
  }
  const p = runIbkrTickEntitlementPilot(triggeredByUserId).finally(() => {
    activePilot = null;
  });
  activePilot = p;
  return p;
}

async function runIbkrTickEntitlementPilot(triggeredByUserId: string): Promise<IbkrTickPilotRunResult> {
  const runStartedAt = new Date();
  const { host, port } = parseGatewayUrl();
  const clientId = pilotClientId();

  const globalErrors: Array<{ reqId: number; code: number; message: string }> = [];
  const errorsByReqId = new Map<number, { code: number; message: string }>();
  const tickCounts = new Map<number, number>();
  const tickBuffers = new Map<number, unknown[][]>();
  const ticksTruncated = new Map<number, boolean>();
  const lastPrices = new Map<number, number | null>();

  let ib: IBApi | null = null;

  try {
    ib = await connectIb(host, port, clientId);

    const onErr = (err: Error, code: number, reqId: number) => {
      if (code === 2104 || code === 2106 || code === 2158 || code === 10167) return;
      const row = { reqId, code, message: err.message };
      globalErrors.push(row);
      if (reqId > 0) errorsByReqId.set(reqId, { code, message: err.message });
    };

    const onTickByTickAllLast = (...args: unknown[]) => {
      const reqId = args[0] as number;
      const n = (tickCounts.get(reqId) ?? 0) + 1;
      tickCounts.set(reqId, n);
      const buf = tickBuffers.get(reqId) ?? [];
      const cap = MAX_TICKS_PER_SYMBOL;
      if (buf.length < cap) {
        buf.push(serializeTickArgs(args));
      } else {
        ticksTruncated.set(reqId, true);
      }
      tickBuffers.set(reqId, buf);
      const { price } = parseTickNumbers(args.slice(1));
      if (price != null && price > 0.01 && price < 1e6) {
        lastPrices.set(reqId, price);
      }
    };

    ib.on(EventName.error, onErr);
    ib.on(EventName.tickByTickAllLast, onTickByTickAllLast);

    try {
      ib.reqMarketDataType(1);
    } catch {
      /* non-fatal */
    }

    for (let i = 0; i < TICK_PILOT_SYMBOLS.length; i++) {
      const row = TICK_PILOT_SYMBOLS[i]!;
      const reqId = BASE_REQ_ID + i;
      tickCounts.set(reqId, 0);
      tickBuffers.set(reqId, []);
      ticksTruncated.set(reqId, false);
      try {
        ib.reqTickByTickData(reqId, stkSmart(row.symbol), TickByTickDataType.Last, 0, false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errorsByReqId.set(reqId, { code: -1, message: msg });
        globalErrors.push({ reqId, code: -1, message: msg });
      }
    }

    await new Promise((r) => setTimeout(r, HOLD_MS));

    const perSymbolResults: IbkrTickPilotSymbolResult[] = [];

    for (let i = 0; i < TICK_PILOT_SYMBOLS.length; i++) {
      const row = TICK_PILOT_SYMBOLS[i]!;
      const reqId = BASE_REQ_ID + i;
      const err = errorsByReqId.get(reqId);
      const tickCount = tickCounts.get(reqId) ?? 0;
      const buf = tickBuffers.get(reqId) ?? [];
      const truncated = ticksTruncated.get(reqId) ?? false;

      let lastPx: number | null = lastPrices.get(reqId) ?? null;
      if (lastPx == null && buf.length > 0) {
        const lastTick = buf[buf.length - 1] as unknown[];
        lastPx = parseTickNumbers(lastTick).price;
      }
      const thresh = lastPx != null ? blockThresholdShares(lastPx) : null;
      let blockCount = 0;
      if (thresh != null) {
        for (const tick of buf) {
          const { size } = parseTickNumbers(tick as unknown[]);
          if (size != null && size >= thresh) blockCount++;
        }
      }

      const exchanges = new Set<string>();
      for (const tick of buf) {
        for (const ex of extractExchangeStrings(tick as unknown[])) exchanges.add(ex);
      }

      perSymbolResults.push({
        symbol: row.symbol,
        venue: row.venue,
        reqId,
        rejected: err != null,
        errorCode: err?.code ?? null,
        errorMessage: err?.message ?? null,
        tickCount,
        ticksPerSecond: tickCount / (HOLD_MS / 1000),
        ticksTruncated: truncated,
        blockCount,
        blockThresholdShares: thresh,
        lastPriceUsedForBlock: lastPx,
        exchangesObserved: [...exchanges].sort(),
        ticks: buf,
      });

      try {
        ib.cancelTickByTickData(reqId);
      } catch {
        /* ignore */
      }
    }

    ib.off(EventName.error, onErr);
    ib.off(EventName.tickByTickAllLast, onTickByTickAllLast);

    const nasdaqS = summarizeVenue(perSymbolResults, "NASDAQ");
    const nyseS = summarizeVenue(perSymbolResults, "NYSE");
    const rthSeconds = 6.5 * 3600;

    const blockTradeExtrapolation: IbkrTickPilotSummary["blockTradeExtrapolation"] = {};
    for (const r of perSymbolResults) {
      const mult = rthSeconds / (HOLD_MS / 1000);
      blockTradeExtrapolation[r.symbol] = {
        blocksObserved60s: r.blockCount,
        estimatedBlocksPerRthDay: Math.round(r.blockCount * mult),
        thresholdShares: r.blockThresholdShares,
      };
    }

    const summary: IbkrTickPilotSummary = {
      nasdaq: nasdaqS.status,
      nyse: nyseS.status,
      nasdaqDetail: nasdaqS.detail,
      nyseDetail: nyseS.detail,
      blockTradeExtrapolation,
      gatewayHost: host,
      gatewayPort: port,
      clientId,
    };

    const runCompletedAt = new Date();
    const durationSec = Math.round((runCompletedAt.getTime() - runStartedAt.getTime()) / 1000);
    const id = randomUUID();

    await db.insert(ibkrDiagnosticsRunsTable).values({
      id,
      runStartedAt: runStartedAt,
      runCompletedAt: runCompletedAt,
      durationSec,
      clientId,
      perSymbolResults: perSymbolResults as unknown as Record<string, unknown>,
      globalErrors: globalErrors as unknown as Record<string, unknown>,
      summary: summary as unknown as Record<string, unknown>,
      triggeredByUserId,
    });

    return {
      id,
      runStartedAt: runStartedAt.toISOString(),
      runCompletedAt: runCompletedAt.toISOString(),
      durationSec,
      clientId,
      perSymbolResults,
      globalErrors,
      summary,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: msg, host, port, clientId }, "ibkrTickEntitlementPilot: failed");
    globalErrors.push({ reqId: -1, code: -2, message: msg });
    const runCompletedAt = new Date();
    const durationSec = Math.round((runCompletedAt.getTime() - runStartedAt.getTime()) / 1000);
    const emptySymbols: IbkrTickPilotSymbolResult[] = TICK_PILOT_SYMBOLS.map((row, i) => ({
      symbol: row.symbol,
      venue: row.venue,
      reqId: BASE_REQ_ID + i,
      rejected: true,
      errorCode: -2,
      errorMessage: msg,
      tickCount: 0,
      ticksPerSecond: 0,
      ticksTruncated: false,
      blockCount: 0,
      blockThresholdShares: null,
      lastPriceUsedForBlock: null,
      exchangesObserved: [],
      ticks: [],
    }));
    const summary: IbkrTickPilotSummary = {
      nasdaq: "FAIL",
      nyse: "FAIL",
      nasdaqDetail: msg,
      nyseDetail: msg,
      blockTradeExtrapolation: {},
      gatewayHost: host,
      gatewayPort: port,
      clientId,
    };
    const id = randomUUID();
    await db.insert(ibkrDiagnosticsRunsTable).values({
      id,
      runStartedAt: runStartedAt,
      runCompletedAt: runCompletedAt,
      durationSec,
      clientId,
      perSymbolResults: emptySymbols as unknown as Record<string, unknown>,
      globalErrors: globalErrors as unknown as Record<string, unknown>,
      summary: summary as unknown as Record<string, unknown>,
      triggeredByUserId,
    });
    return {
      id,
      runStartedAt: runStartedAt.toISOString(),
      runCompletedAt: runCompletedAt.toISOString(),
      durationSec,
      clientId,
      perSymbolResults: emptySymbols,
      globalErrors,
      summary,
    };
  } finally {
    if (ib) {
      try {
        ib.removeAllListeners();
        ib.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function getLatestIbkrTickPilotSummary(): Promise<{
  runStartedAt: string;
  summary: IbkrTickPilotSummary;
} | null> {
  const [row] = await db
    .select({
      runStartedAt: ibkrDiagnosticsRunsTable.runStartedAt,
      summary: ibkrDiagnosticsRunsTable.summary,
    })
    .from(ibkrDiagnosticsRunsTable)
    .orderBy(desc(ibkrDiagnosticsRunsTable.runStartedAt))
    .limit(1);
  if (!row) return null;
  return {
    runStartedAt: row.runStartedAt instanceof Date ? row.runStartedAt.toISOString() : String(row.runStartedAt),
    summary: row.summary as IbkrTickPilotSummary,
  };
}

export async function listIbkrTickPilotRuns(limit: number): Promise<
  Array<{
    id: string;
    runStartedAt: string;
    durationSec: number;
    summary: IbkrTickPilotSummary;
    triggeredByUserId: string;
  }>
> {
  const rows = await db
    .select({
      id: ibkrDiagnosticsRunsTable.id,
      runStartedAt: ibkrDiagnosticsRunsTable.runStartedAt,
      durationSec: ibkrDiagnosticsRunsTable.durationSec,
      summary: ibkrDiagnosticsRunsTable.summary,
      triggeredByUserId: ibkrDiagnosticsRunsTable.triggeredByUserId,
    })
    .from(ibkrDiagnosticsRunsTable)
    .orderBy(desc(ibkrDiagnosticsRunsTable.runStartedAt))
    .limit(Math.min(50, Math.max(1, limit)));

  return rows.map((r) => ({
    id: String(r.id),
    runStartedAt: r.runStartedAt instanceof Date ? r.runStartedAt.toISOString() : String(r.runStartedAt),
    durationSec: r.durationSec,
    summary: r.summary as IbkrTickPilotSummary,
    triggeredByUserId: r.triggeredByUserId,
  }));
}

export async function getIbkrTickPilotRunById(id: string) {
  const [row] = await db.select().from(ibkrDiagnosticsRunsTable).where(eq(ibkrDiagnosticsRunsTable.id, id)).limit(1);
  return row ?? null;
}

/** US equity RTH 09:30–16:00 ET (Mon–Fri). */
export function isUsEquityRthWindowEt(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
