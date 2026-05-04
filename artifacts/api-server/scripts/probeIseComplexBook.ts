/**
 * Phase 1 — ISE / SMART BAG spread book probe (manual / CI on-demand).
 *
 * Resolves two AAPL call legs via reqContractDetails, builds a BAG vertical,
 * then reqMktData and listens ~30s for ticks or error 354 / 101 / 200.
 *
 * Run (with dependencies installed):
 *   npx tsx scripts/probeIseComplexBook.ts
 *
 * Env: same as ibStreamer (IBKR_GATEWAY_URL | IB_HOST, IB_PORT, IB_CLIENT_ID).
 */
import { IBApi, EventName, SecType, type Contract } from "@stoqey/ib";

const PROBE_MS = 30_000;
const TICK_WAIT_MS = 10_000;

function parseGatewayUrl(): { host: string; port: number } {
  const raw = process.env.IBKR_GATEWAY_URL || process.env.IB_HOST;
  if (!raw) return { host: "127.0.0.1", port: Number(process.env.IB_PORT ?? "4002") };
  try {
    const url = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    if (url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "http:" || url.protocol === "ws:") {
      return { host: "127.0.0.1", port: Number(process.env.IB_PORT ?? "4002") };
    }
    return {
      host: url.hostname || "127.0.0.1",
      port: url.port ? Number(url.port) : Number(process.env.IB_PORT ?? "4002"),
    };
  } catch {
    return { host: raw, port: Number(process.env.IB_PORT ?? "4002") };
  }
}

function upcomingFridayYmdNy(): string {
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    const wk = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
    if (wk === "Fri") {
      return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" }).format(d).replace(/-/g, "");
    }
  }
  throw new Error("no Friday in window");
}

async function resolveOptionConId(
  ib: IBApi,
  reqId: number,
  c: Contract,
): Promise<number | null> {
  return new Promise((resolve) => {
    let first: number | null = null;
    const onDetails = (rid: number, details: { contract?: { conId?: number } }) => {
      if (rid !== reqId) return;
      const id = details?.contract?.conId;
      if (id != null && first == null) first = id;
    };
    const onEnd = (rid: number) => {
      if (rid !== reqId) return;
      ib.off(EventName.contractDetails, onDetails);
      ib.off(EventName.contractDetailsEnd, onEnd);
      resolve(first);
    };
    ib.on(EventName.contractDetails, onDetails);
    ib.on(EventName.contractDetailsEnd, onEnd);
    try {
      ib.reqContractDetails(reqId, c);
    } catch {
      ib.off(EventName.contractDetails, onDetails);
      ib.off(EventName.contractDetailsEnd, onEnd);
      resolve(null);
    }
    setTimeout(() => {
      ib.off(EventName.contractDetails, onDetails);
      ib.off(EventName.contractDetailsEnd, onEnd);
      resolve(first);
    }, 8_000);
  });
}

async function main(): Promise<void> {
  const { host, port } = parseGatewayUrl();
  const clientId = Number(process.env.IB_CLIENT_ID ?? "88");
  const ib = new IBApi({ host, port, clientId });

  const errors: Array<{ code: number; msg: string; reqId: number }> = [];
  let tickCount = 0;
  let saw354 = false;

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        ib.disconnect();
      } catch {}
      reject(new Error("connect timeout"));
    }, 15_000);
    ib.once(EventName.connected, () => {
      clearTimeout(t);
      resolve();
    });
    ib.on(EventName.error, (err: Error, code: number, reqId: number) => {
      if (code === 2104 || code === 2106 || code === 2158) return;
      errors.push({ code, msg: err.message, reqId });
      if (code === 354) saw354 = true;
    });
    ib.connect();
  });

  console.log(`[probe] connected ${host}:${port} clientId=${clientId}`);

  const expiry = upcomingFridayYmdNy();
  const lowerStrike = 195;
  const upperStrike = 200;

  const leg1: Contract = {
    symbol: "AAPL",
    secType: SecType.OPT,
    exchange: "SMART",
    currency: "USD",
    lastTradeDateOrContractMonth: expiry,
    strike: lowerStrike,
    right: "C",
    multiplier: "100",
  };
  const leg2: Contract = { ...leg1, strike: upperStrike };

  const c1 = await resolveOptionConId(ib, 91001, leg1);
  const c2 = await resolveOptionConId(ib, 91002, leg2);
  console.log(`[probe] resolved conIds lower=${c1} upper=${c2} expiry=${expiry}`);

  if (!c1 || !c2) {
    console.log("[probe] RESULT=FAIL reason=could_not_resolve_option_conIds");
    ib.disconnect();
    process.exit(2);
  }

  const bag: Contract = {
    symbol: "AAPL",
    secType: SecType.BAG,
    currency: "USD",
    exchange: "SMART",
    comboLegs: [
      { conId: c1, ratio: 1, action: "BUY", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
      { conId: c2, ratio: 1, action: "SELL", exchange: "SMART", openClose: 0, shortSaleSlot: 0, designatedLocation: "", exemptCode: -1 },
    ],
  };

  const mktReqId = 92000;
  ib.on(EventName.tickPrice, (rid) => {
    if (rid === mktReqId) tickCount++;
  });
  ib.on(EventName.tickSize, (rid) => {
    if (rid === mktReqId) tickCount++;
  });

  try {
    ib.reqMktData(mktReqId, bag, "", false, false);
    console.log("[probe] reqMktData sent for BAG vertical");
  } catch (e) {
    console.log(`[probe] RESULT=FAIL reason=reqMktData_throw ${String(e)}`);
    ib.disconnect();
    process.exit(3);
  }

  await new Promise((r) => setTimeout(r, TICK_WAIT_MS));
  const earlyTicks = tickCount;

  await new Promise((r) => setTimeout(r, Math.max(0, PROBE_MS - TICK_WAIT_MS)));

  ib.cancelMktData(mktReqId);
  ib.disconnect();

  const relevant = errors.filter((e) => e.reqId === mktReqId || e.code === 354);
  console.log("[probe] errors (filtered):", JSON.stringify(relevant, null, 2));
  console.log(`[probe] tickCount=${tickCount} (after ${TICK_WAIT_MS}ms early=${earlyTicks}) saw354=${saw354}`);

  const pass = !saw354 && tickCount > 0 && !relevant.some((e) => e.code === 354);
  if (pass) {
    console.log("[probe] RESULT=PASS");
    process.exit(0);
  }
  console.log("[probe] RESULT=FAIL (no qualifying ticks or error 354 / entitlement)");
  process.exit(1);
}

main().catch((e) => {
  console.error("[probe] fatal", e);
  process.exit(99);
});
