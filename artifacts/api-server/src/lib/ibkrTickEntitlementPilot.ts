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
  return { host: "", port: 0 };
}

function pilotClientId(): number {
  return 0;
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
  void triggeredByUserId;
  throw new Error("IBKR gateway integration has been removed");
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
