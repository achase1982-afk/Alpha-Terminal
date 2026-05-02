/**
 * One-shot IBKR market-data entitlement probe (read-only: no orders, no extra subscriptions).
 *
 * Run from artifacts/api-server:
 *   ./node_modules/.bin/tsx scripts/auditIbkrSubscriptions.ts
 *
 * Env (same host resolution as ibStreamer):
 *   IBKR_GATEWAY_URL | IB_HOST   (default 127.0.0.1)
 *   IB_PORT            (default 4002 when using host:port form)
 *   IB_AUDIT_CLIENT_ID (default 87 — use a free slot vs a running api-server)
 *   IB_CLIENT_ID       (fallback if IB_AUDIT_CLIENT_ID unset)
 *
 * Optional strike overrides (numbers):
 *   AUDIT_AAPL_STRIKE_LOW/HIGH  AUDIT_SPX_STRIKE_LOW/HIGH  AUDIT_SPY_STRIKE_LOW/HIGH
 *
 * Writes: /tmp/ibkr_subscription_audit.json
 */
import { writeFileSync } from "node:fs";
import { IBApi, EventName, type Contract, SecType } from "@stoqey/ib";

const OUT_PATH = "/tmp/ibkr_subscription_audit.json";
const PROBE_MS = 3000;
const CONNECT_MS = 20_000;
const DETAILS_MS = 15_000;

/** Same parsing rules as ibStreamer.parseGatewayUrl (TCP target only for this script). */
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

function auditClientId(): number {
  const fromAudit = process.env.IB_AUDIT_CLIENT_ID?.trim();
  if (fromAudit) return Number(fromAudit);
  return Number(process.env.IB_CLIENT_ID ?? "87");
}

/** Next calendar Friday (America/New_York), YYYYMMDD. */
function upcomingFridayYmdNy(): string {
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    const wk = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
    if (wk === "Fri") {
      return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" }).format(d).replace(/-/g, "");
    }
  }
  throw new Error("upcomingFridayYmdNy: no Friday in window");
}

function numEnv(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function contractSummary(c: Contract): string {
  if (c.secType === SecType.BAG && c.comboLegs?.length) {
    return `BAG ${c.symbol}@${c.exchange ?? "?"} legs=${c.comboLegs.map((l) => l.conId).join(",")}`;
  }
  return `${c.symbol} ${c.secType ?? "?"} ${c.lastTradeDateOrContractMonth ?? ""} ${c.right ?? ""} ${c.strike ?? ""}@${c.exchange ?? "?"}`;
}

interface SubscriptionAuditRow {
  feed: string;
  subscribed: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  ticksReceived: Array<Record<string, unknown>>;
  requestedContract: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectStandalone(): Promise<IBApi> {
  const { host, port } = parseGatewayUrl();
  const clientId = auditClientId();
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

async function reqContractDetailsBest(ib: IBApi, reqId: number, c: Contract): Promise<Contract> {
  const rows: Contract[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("reqContractDetails timeout"));
    }, DETAILS_MS);

    const onDet = (rid: number, det: { contract?: Contract }) => {
      if (rid !== reqId) return;
      if (det?.contract?.conId) rows.push(det.contract);
    };
    const onEnd = (rid: number) => {
      if (rid !== reqId) return;
      cleanup();
      resolve();
    };
    function cleanup() {
      clearTimeout(timer);
      ib.off(EventName.contractDetails, onDet);
      ib.off(EventName.contractDetailsEnd, onEnd);
    }

    ib.on(EventName.contractDetails, onDet);
    ib.on(EventName.contractDetailsEnd, onEnd);
    try {
      ib.reqContractDetails(reqId, c);
    } catch (e) {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });

  const wantExp = String(c.lastTradeDateOrContractMonth ?? "");
  const wantStrike = c.strike;
  const wantRight = String(c.right ?? "").toUpperCase().slice(0, 1);

  const pick =
    rows.find((r) => {
      const exp = String(r.lastTradeDateOrContractMonth ?? "");
      const strikeOk = wantStrike == null || r.strike === wantStrike;
      const expOk = !wantExp || exp === wantExp || exp.startsWith(wantExp.slice(0, 6));
      const right = String(r.right ?? "").toUpperCase();
      const rightOk = !wantRight || right.startsWith(wantRight);
      return strikeOk && expOk && rightOk;
    }) ?? rows[0];

  if (!pick?.conId) throw new Error("No contract details returned with conId");
  return pick;
}

async function resolveOptionConId(
  ib: IBApi,
  baseReqId: number,
  leg: Contract,
): Promise<number> {
  const full = await reqContractDetailsBest(ib, baseReqId, leg);
  return full.conId!;
}

function isSubscriptionDenied(code: number): boolean {
  return code === 354 || code === 10168;
}

function isHardFailure(code: number): boolean {
  return isSubscriptionDenied(code) || code === 200;
}

function opraSubscribed(ticks: Array<Record<string, unknown>>): boolean {
  const want = new Set([4, 5, 9, 66, 67, 68, 69, 70, 75]);
  return ticks.some((t) => {
    const tt = t.tickType;
    return typeof tt === "number" && want.has(tt) && (t.event === "tickPrice" || t.event === "tickSize");
  });
}

function anyMarketTick(ticks: Array<Record<string, unknown>>): boolean {
  return ticks.some((t) =>
    ["tickPrice", "tickSize", "tickString", "tickGeneric", "tickOptionComputation"].includes(String(t.event)),
  );
}

async function runMktDataProbe(
  ib: IBApi,
  feed: string,
  contract: Contract,
  reqId: number,
  classify: (ticks: Array<Record<string, unknown>>, errCode: number | null) => boolean,
): Promise<SubscriptionAuditRow> {
  const ticks: Array<Record<string, unknown>> = [];
  let errorCode: number | null = null;
  let errorMessage: string | null = null;
  const t0 = Date.now();

  const onTickPrice = (rid: number, tickType: number, price: number, _attrib: unknown) => {
    if (rid !== reqId) return;
    if (price === -1) return;
    ticks.push({ t: Date.now() - t0, event: "tickPrice", tickType, price });
  };
  const onTickSize = (rid: number, tickType: number, size: number) => {
    if (rid !== reqId) return;
    ticks.push({ t: Date.now() - t0, event: "tickSize", tickType, size });
  };
  const onTickString = (rid: number, tickType: number, value: string) => {
    if (rid !== reqId) return;
    ticks.push({ t: Date.now() - t0, event: "tickString", tickType, value });
  };
  const onTickGeneric = (rid: number, tickType: number, value: number) => {
    if (rid !== reqId) return;
    ticks.push({ t: Date.now() - t0, event: "tickGeneric", tickType, value });
  };
  const onTickOpt = (rid: number, ...rest: unknown[]) => {
    if (rid !== reqId) return;
    ticks.push({ t: Date.now() - t0, event: "tickOptionComputation", tickType: rest[0], rest });
  };
  const onErr = (err: Error, code: number, rid: number) => {
    if (rid !== reqId) return;
    if (code === 2104 || code === 2106 || code === 2158 || code === 10167) return;
    errorCode = code;
    errorMessage = err.message;
    ticks.push({ t: Date.now() - t0, event: "error", code, message: err.message });
  };

  ib.on(EventName.tickPrice, onTickPrice);
  ib.on(EventName.tickSize, onTickSize);
  ib.on(EventName.tickString, onTickString);
  ib.on(EventName.tickGeneric, onTickGeneric);
  ib.on(EventName.tickOptionComputation, onTickOpt);
  ib.on(EventName.error, onErr);

  const label = contractSummary(contract);
  console.log(`[audit] feed=${feed} reqMktData reqId=${reqId} contract=${label}`);

  try {
    ib.reqMktData(reqId, contract, "", false, false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorCode = -1;
    errorMessage = msg;
    ticks.push({ t: Date.now() - t0, event: "throw", message: msg });
  }

  await sleep(PROBE_MS);

  try {
    ib.cancelMktData(reqId);
  } catch {
    /* ignore */
  }

  ib.off(EventName.tickPrice, onTickPrice);
  ib.off(EventName.tickSize, onTickSize);
  ib.off(EventName.tickString, onTickString);
  ib.off(EventName.tickGeneric, onTickGeneric);
  ib.off(EventName.tickOptionComputation, onTickOpt);
  ib.off(EventName.error, onErr);

  for (const t of ticks) {
    if (t.event === "error" && typeof t.code === "number") {
      if (errorCode == null) errorCode = t.code;
      if (errorMessage == null && typeof t.message === "string") errorMessage = t.message;
    }
  }

  const subscribed = classify(ticks, errorCode);
  console.log(
    `[audit] feed=${feed} subscribed=${subscribed} errorCode=${errorCode ?? "null"} ticks=${ticks.length} contract=${label}`,
  );

  return {
    feed,
    subscribed,
    errorCode,
    errorMessage,
    ticksReceived: ticks,
    requestedContract: label,
  };
}

async function main(): Promise<void> {
  const { host, port } = parseGatewayUrl();
  const clientId = auditClientId();
  const friday = upcomingFridayYmdNy();

  const aaplLo = numEnv("AUDIT_AAPL_STRIKE_LOW", 280);
  const aaplHi = numEnv("AUDIT_AAPL_STRIKE_HIGH", 285);
  const spxLo = numEnv("AUDIT_SPX_STRIKE_LOW", 6000);
  const spxHi = numEnv("AUDIT_SPX_STRIKE_HIGH", 6010);
  const spyLo = numEnv("AUDIT_SPY_STRIKE_LOW", 590);
  const spyHi = numEnv("AUDIT_SPY_STRIKE_HIGH", 595);

  const results: SubscriptionAuditRow[] = [];
  let detailReq = 9100;

  const ib = await connectStandalone();
  try {
    try {
      ib.reqMarketDataType(1);
    } catch {
      /* non-fatal */
    }

    const optAapl: Contract = {
      symbol: "AAPL",
      secType: SecType.OPT,
      exchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: friday,
      right: "C",
      strike: aaplLo,
      multiplier: 100,
    };
    results.push(
      await runMktDataProbe(ib, "OPRA", optAapl, 71001, (ticks, err) => {
        if (err != null && isHardFailure(err)) return false;
        return opraSubscribed(ticks);
      }),
    );

    const legBuy: Contract = {
      symbol: "AAPL",
      secType: SecType.OPT,
      exchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: friday,
      right: "C",
      strike: aaplLo,
      multiplier: 100,
    };
    const legSell: Contract = { ...legBuy, strike: aaplHi };
    const cBuy = await resolveOptionConId(ib, detailReq++, legBuy);
    const cSell = await resolveOptionConId(ib, detailReq++, legSell);
    const bagIse: Contract = {
      symbol: "AAPL",
      secType: SecType.BAG,
      currency: "USD",
      exchange: "ISE",
      comboLegs: [
        { conId: cBuy, ratio: 1, action: "BUY", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
        { conId: cSell, ratio: 1, action: "SELL", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
      ],
    };
    results.push(
      await runMktDataProbe(ib, "ISE_SPREAD_COMPLEX", bagIse, 71002, (ticks, err) => {
        if (err != null && isHardFailure(err)) return false;
        return anyMarketTick(ticks);
      }),
    );

    const spxLoLeg: Contract = {
      symbol: "SPX",
      secType: SecType.OPT,
      exchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: friday,
      right: "C",
      strike: spxLo,
      multiplier: 100,
    };
    const spxHiLeg: Contract = { ...spxLoLeg, strike: spxHi };
    const spxC1 = await resolveOptionConId(ib, detailReq++, spxLoLeg);
    const spxC2 = await resolveOptionConId(ib, detailReq++, spxHiLeg);
    const bagCboe: Contract = {
      symbol: "SPX",
      secType: SecType.BAG,
      currency: "USD",
      exchange: "CBOE",
      comboLegs: [
        { conId: spxC1, ratio: 1, action: "BUY", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
        { conId: spxC2, ratio: 1, action: "SELL", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
      ],
    };
    results.push(
      await runMktDataProbe(ib, "CBOE_COMPLEX_SPX", bagCboe, 71003, (ticks, err) => {
        if (err != null && isHardFailure(err)) return false;
        return anyMarketTick(ticks);
      }),
    );

    const spyLoLeg: Contract = {
      symbol: "SPY",
      secType: SecType.OPT,
      exchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: friday,
      right: "C",
      strike: spyLo,
      multiplier: 100,
    };
    const spyHiLeg: Contract = { ...spyLoLeg, strike: spyHi };
    const spyC1 = await resolveOptionConId(ib, detailReq++, spyLoLeg);
    const spyC2 = await resolveOptionConId(ib, detailReq++, spyHiLeg);
    const bagSpy: Contract = {
      symbol: "SPY",
      secType: SecType.BAG,
      currency: "USD",
      exchange: "SMART",
      comboLegs: [
        { conId: spyC1, ratio: 1, action: "BUY", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
        { conId: spyC2, ratio: 1, action: "SELL", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
      ],
    };
    results.push(
      await runMktDataProbe(ib, "NYSE_ARCA_COMPLEX_SPY", bagSpy, 71004, (ticks, err) => {
        if (err != null && isHardFailure(err)) return false;
        return anyMarketTick(ticks);
      }),
    );
  } finally {
    try {
      ib.cancelMktData(71001);
      ib.cancelMktData(71002);
      ib.cancelMktData(71003);
      ib.cancelMktData(71004);
    } catch {
      /* ignore */
    }
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
    host,
    port,
    clientId,
    nextFridayNy: friday,
    probes: results,
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[audit] wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
