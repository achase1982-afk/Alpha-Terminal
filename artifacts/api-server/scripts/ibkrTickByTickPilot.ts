/**
 * IBKR tick-by-tick pilot: reqTickByTickData type "Last" for a fixed symbol set.
 *
 * Run on the Mac Mini during RTH with live IB Gateway (see env below).
 * Uses @stoqey/ib — log full callback payloads (shape varies by API version).
 *
 *   npx tsx scripts/ibkrTickByTickPilot.ts
 *
 * Env (same host resolution idea as ibStreamer / auditIbkrSubscriptions):
 *   IBKR_GATEWAY_URL | IB_HOST   (default 127.0.0.1)
 *   IB_PORT            (default 4002)
 *   IB_PILOT_CLIENT_ID (default 91 — must differ from the running API server and from audit script)
 *
 * Output:
 *   /tmp/ibkr_tick_by_tick_pilot.json
 *
 * IMPORTANT: Do not run while production `ibStreamer` uses the same clientId.
 * IBKR allows multiple API connections with different client IDs.
 */
import { writeFileSync } from "node:fs";
import { IBApi, EventName, SecType, type Contract } from "@stoqey/ib";

const OUT_PATH = "/tmp/ibkr_tick_by_tick_pilot.json";
const HOLD_MS = 60_000;
const CONNECT_MS = 20_000;

/** NASDAQ-heavy + NYSE probe — edit if needed. */
const SYMBOLS: Array<{ symbol: string; venueNote: "NASDAQ" | "NYSE" }> = [
  { symbol: "NVDA", venueNote: "NASDAQ" },
  { symbol: "AAPL", venueNote: "NASDAQ" },
  { symbol: "MSFT", venueNote: "NASDAQ" },
  { symbol: "AMD", venueNote: "NASDAQ" },
  { symbol: "MU", venueNote: "NASDAQ" },
  { symbol: "JPM", venueNote: "NYSE" },
  { symbol: "BAC", venueNote: "NYSE" },
];

function parseGatewayUrl(): { host: string; port: number } {
  const raw = process.env.IBKR_GATEWAY_URL || process.env.IB_HOST;
  if (!raw) return { host: "127.0.0.1", port: 4002 };
  try {
    const url = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    if (url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "http:" || url.protocol === "ws:") {
      return { host: "127.0.0.1", port: 4002 };
    }
    const host = url.hostname || "127.0.0.1";
    const port = url.port ? Number(url.port) : 4002;
    return { host, port };
  } catch {
    return { host: raw, port: Number(process.env.IB_PORT ?? "4002") };
  }
}

function pilotClientId(): number {
  const v = process.env.IB_PILOT_CLIENT_ID?.trim();
  if (v) return Number(v);
  return 91;
}

function stkSmart(symbol: string): Contract {
  return {
    symbol,
    secType: SecType.STK,
    exchange: "SMART",
    currency: "USD",
  };
}

interface SymbolResult {
  symbol: string;
  venueNote: "NASDAQ" | "NYSE";
  reqId: number;
  accepted: boolean | null;
  errorCode: number | null;
  errorMessage: string | null;
  tickCount: number;
  ticksPerSecond: number;
  /** First tick callback, all arguments serialized for field discovery */
  sampleTick: unknown;
  /** Up to 5 raw tick arg arrays for structure comparison */
  sampleTicks: unknown[];
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

async function main(): Promise<void> {
  const { host, port } = parseGatewayUrl();
  const clientId = pilotClientId();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const results: SymbolResult[] = [];
  const infoLines: string[] = [];

  const ib = await connectIb(host, port, clientId);

  const errorsByReqId = new Map<number, { code: number; message: string }>();
  const tickCounts = new Map<number, number>();
  const firstTick = new Map<number, unknown>();
  const samples = new Map<number, unknown[]>();

  const onInfo = (msg: string, code: number) => {
    infoLines.push(`${code}: ${msg}`);
  };
  const onErr = (err: Error, code: number, reqId: number) => {
    if (code === 2104 || code === 2106 || code === 2158 || code === 10167) return;
    errorsByReqId.set(reqId, { code, message: err.message });
  };

  /** @stoqey/ib: Last + AllLast stream through tickByTickAllLast — log all args. */
  const onTickByTickAllLast = (...args: unknown[]) => {
    const reqId = args[0] as number;
    tickCounts.set(reqId, (tickCounts.get(reqId) ?? 0) + 1);
    if (!firstTick.has(reqId)) firstTick.set(reqId, args);
    const arr = samples.get(reqId) ?? [];
    if (arr.length < 5) {
      arr.push(args);
      samples.set(reqId, arr);
    }
  };

  ib.on(EventName.info, onInfo);
  ib.on(EventName.error, onErr);
  ib.on(EventName.tickByTickAllLast, onTickByTickAllLast);

  try {
    try {
      ib.reqMarketDataType(1);
    } catch {
      /* non-fatal */
    }

    const baseReqId = 72_000;
    for (let i = 0; i < SYMBOLS.length; i++) {
      const row = SYMBOLS[i]!;
      const reqId = baseReqId + i;
      const c = stkSmart(row.symbol);
      tickCounts.set(reqId, 0);
      samples.set(reqId, []);
      try {
        // TWS API: reqTickByTickData(reqId, contract, tickType, numberOfTicks, ignoreSize)
        // numberOfTicks=0 → streaming
        ib.reqTickByTickData(reqId, c, "Last", 0, false);
        console.log(`[pilot] reqTickByTickData Last reqId=${reqId} symbol=${row.symbol}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errorsByReqId.set(reqId, { code: -1, message: msg });
        console.error(`[pilot] reqTickByTickData throw reqId=${reqId} ${msg}`);
      }
    }

    await new Promise((r) => setTimeout(r, HOLD_MS));

    for (let i = 0; i < SYMBOLS.length; i++) {
      const row = SYMBOLS[i]!;
      const reqId = baseReqId + i;
      const err = errorsByReqId.get(reqId);
      const n = tickCounts.get(reqId) ?? 0;
      const accepted = err == null ? (n > 0 ? true : null) : false;
      results.push({
        symbol: row.symbol,
        venueNote: row.venueNote,
        reqId,
        accepted: accepted === null && err == null && n === 0 ? null : accepted === true,
        errorCode: err?.code ?? null,
        errorMessage: err?.message ?? null,
        tickCount: n,
        ticksPerSecond: n / (HOLD_MS / 1000),
        sampleTick: firstTick.get(reqId) ?? null,
        sampleTicks: samples.get(reqId) ?? [],
      });
      try {
        ib.cancelTickByTickData(reqId);
      } catch {
        /* ignore */
      }
    }
  } finally {
    ib.off(EventName.info, onInfo);
    ib.off(EventName.error, onErr);
    ib.off(EventName.tickByTickAllLast, onTickByTickAllLast);
    try {
      ib.disconnect();
    } catch {
      /* ignore */
    }
    try {
      ib.removeAllListeners();
    } catch {
      /* ignore */
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    startedAt,
    durationMs: Date.now() - t0,
    host,
    port,
    clientId,
    holdMs: HOLD_MS,
    tickType: "Last",
    contract: "STK @ SMART",
    results,
    infoMessagesSample: infoLines.slice(-40),
    notes: [
      "If NYSE symbols error 354 / 10168: likely need additional US equity tape subscription (e.g. NYSE Network A non-Pro) — confirm in Client Portal pricing.",
      "tickByTickAllLast callback arity/shape follows @stoqey/ib + your Gateway version; inspect sampleTick arrays.",
      "For concurrent line count: IBKR often exposes usage in TWS / Client Portal, not via a single stable Account Summary tag — capture screenshot during pilot.",
      "Run scripts/auditIbkrSubscriptions.ts in parallel with a DIFFERENT client ID (e.g. IB_AUDIT_CLIENT_ID=87 vs IB_PILOT_CLIENT_ID=91).",
    ],
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[pilot] wrote ${OUT_PATH}`);
  console.log(JSON.stringify(results.map((r) => ({ sym: r.symbol, err: r.errorCode, ticks: r.tickCount, tps: r.ticksPerSecond })), null, 2));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
