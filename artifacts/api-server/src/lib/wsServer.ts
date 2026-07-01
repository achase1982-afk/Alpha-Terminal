import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { verifyToken } from "@clerk/express";
import { logger } from "./logger.js";
import { getSnapshot, getStreamerStatus, registerWsBroadcast, addSymbols, addOptionSymbols, addFuturesSymbols, addFuturesOptionSymbols } from "./schwabStreamer.js";
import { getTokens } from "./tokenStore.js";
import { registerPortfolioErrorBroadcast } from "./portfolioWsErrorHub.js";
import { fetchMappedSchwabAccounts } from "./schwabPortfolioAccounts.js";

const WS_PATH = "/api/ws/prices";
const HEARTBEAT_MS = 25_000;
const PORTFOLIO_POLL_MS = 1_000;
const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

const clients = new Set<WebSocket>();
const portfolioSubs = new Map<WebSocket, ReturnType<typeof setInterval>>();

/** Per WS: first full [PL_CALC] after subscribe; then log only when computed P/L % changes. */
const plCalcLogState = new WeakMap<
  WebSocket,
  { firstFullDone: boolean; lastPlPctByKey: Map<string, number> }
>();

const WS_SERVER_FILE = fileURLToPath(import.meta.url);

/** JSON.stringify replacer so WS payloads can include bigint (e.g. IBKR imbalance share counts). */
function jsonStringifyForWire(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** File:line of the `readPlCalcPriceInputsFromPosition` stack frame (Schwab price field reads). */
function plCalcPriceInputReadSiteLine(): string {
  const lines = (new Error().stack ?? "").split("\n");
  const frame = lines.find(l => l.includes("readPlCalcPriceInputsFromPosition"));
  const m = frame?.match(/\((.+):(\d+):\d+\)/);
  if (m) return `${m[1]}:${m[2]}`;
  const m2 = frame?.match(/at (.+):(\d+):\d+/);
  return m2 ? `${m2[1]}:${m2[2]}` : `${WS_SERVER_FILE}:?`;
}

/** Schwab `pos` fields used as inputs to implied mark / P/L % (see `currentPriceSourceLine`). */
function readPlCalcPriceInputsFromPosition(pos: Record<string, unknown>) {
  const marketValue = Number(pos.marketValue ?? 0) || 0;
  const longQty = Number(pos.longQuantity ?? 0) || 0;
  const shortQty = Number(pos.shortQuantity ?? 0) || 0;
  return {
    marketValue,
    longQty,
    shortQty,
    currentPriceSourceLine: plCalcPriceInputReadSiteLine(),
  };
}

function plCalcPositionKey(pos: Record<string, unknown>): string {
  const inst = (pos.instrument as Record<string, unknown> | undefined) ?? {};
  const sym = typeof inst.symbol === "string" ? inst.symbol : "";
  const cusip = (typeof inst.cusip === "string" ? inst.cusip : null) ?? (typeof pos.cusip === "string" ? pos.cusip : "");
  return `${sym}|${cusip}`;
}

function buildPlCalcAuditRow(pos: Record<string, unknown>): Record<string, unknown> | null {
  if (pos === null || typeof pos !== "object") return null;
  const inst = (pos.instrument as Record<string, unknown> | undefined) ?? {};
  const assetType = inst.assetType;
  const symbol = inst.symbol;
  const isOptionLike =
    assetType === "OPTION" ||
    assetType === "INDEX_OPTION" ||
    assetType === "FUTURE_OPTION";
  const multiplier = isOptionLike ? 100 : 1;
  const { marketValue, longQty, shortQty, currentPriceSourceLine } = readPlCalcPriceInputsFromPosition(pos);
  const qty = isOptionLike ? (shortQty > 0 ? shortQty : longQty) : longQty || shortQty;
  const averagePrice = Number(pos.averagePrice ?? 0) || 0;
  const longOpenProfitLoss = Number(pos.longOpenProfitLoss ?? 0) || 0;

  const currentPriceField = "marketValue/(longQuantity|shortQuantity)";
  const currentPriceValue =
    qty > 0.0001 ? marketValue / (isOptionLike ? qty * multiplier : qty) : null;

  const costBasisField = "averagePrice";
  const costBasisTotal =
    isOptionLike
      ? Math.abs(averagePrice * (shortQty > 0 ? shortQty : longQty) * multiplier)
      : averagePrice > 0 && qty > 0
        ? averagePrice * qty
        : 0;

  const computedPlPct =
    costBasisTotal > 0.01 ? (longOpenProfitLoss / costBasisTotal) * 100 : 0;

  return {
    symbol,
    instrumentType: assetType,
    quantityLong: longQty,
    quantityShort: shortQty,
    multiplier,
    currentPriceSchwabFields: { marketValue, longQuantity: longQty, shortQuantity: shortQty },
    currentPriceField,
    currentPriceValue,
    currentPriceSourceLine,
    costBasisSchwabField: costBasisField,
    costBasisSchwabValue: averagePrice,
    costBasisTotalForPlPct: costBasisTotal,
    computedPlOpen: longOpenProfitLoss,
    plOpenSource: "schwab_field:longOpenProfitLoss",
    computedPlPct,
    rawSchwabPosition: pos,
  };
}

function maybeLogPlCalcForRawPositions(ws: WebSocket, rawPositions: unknown[]) {
  if (!Array.isArray(rawPositions) || rawPositions.length === 0) return;

  let state = plCalcLogState.get(ws);
  if (!state) {
    state = { firstFullDone: false, lastPlPctByKey: new Map() };
    plCalcLogState.set(ws, state);
  }

  const rows: { key: string; pct: number; payload: Record<string, unknown> }[] = [];
  for (const p of rawPositions) {
    if (p === null || typeof p !== "object") continue;
    const pos = p as Record<string, unknown>;
    const audit = buildPlCalcAuditRow(pos);
    if (!audit) continue;
    const key = plCalcPositionKey(pos);
    const pct = typeof audit.computedPlPct === "number" ? audit.computedPlPct : 0;
    rows.push({ key, pct, payload: audit });
  }

  if (!state.firstFullDone) {
    if (rows.length === 0) return;
    for (const r of rows) {
      logger.info(r.payload, "[PL_CALC] position P/L audit row");
    }
    state.firstFullDone = true;
    for (const r of rows) state.lastPlPctByKey.set(r.key, r.pct);
    return;
  }

  for (const r of rows) {
    const prev = state.lastPlPctByKey.get(r.key);
    if (prev !== r.pct) {
      logger.info(r.payload, "[PL_CALC] position P/L audit row");
      state.lastPlPctByKey.set(r.key, r.pct);
    }
  }
}

let cachedAccountHash: string | null = null;
let accountHashExpiry = 0;

async function schwabTraderFetch(
  path: string,
  token: string,
): Promise<{ ok: boolean; status: number; bodyText: string; json: unknown }> {
  const res = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bodyText = await res.text().catch(() => "");
  let json: unknown;
  if (bodyText) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = undefined;
    }
  }
  return { ok: res.ok, status: res.status, bodyText, json };
}

async function schwabTraderGet(path: string, token: string): Promise<any> {
  const { ok, status, bodyText, json } = await schwabTraderFetch(path, token);
  if (!ok) {
    throw new Error(`Schwab ${path} returned ${status}: ${bodyText.slice(0, 200)}`);
  }
  return json;
}

async function getAccountHash(token: string): Promise<string | null> {
  if (cachedAccountHash && Date.now() < accountHashExpiry) return cachedAccountHash;
  try {
    const nums = await schwabTraderGet("/accounts/accountNumbers", token);
    if (!nums.length) return null;
    cachedAccountHash = nums[0].hashValue;
    accountHashExpiry = Date.now() + 300_000;
    return cachedAccountHash;
  } catch {
    return cachedAccountHash;
  }
}

function mapAccount(acct: any) {
  const sa = acct.securitiesAccount;
  const proj = sa.projectedBalances ?? {};
  const cur = sa.currentBalances ?? {};
  const bal = {
    ...cur,
    liquidationValue: proj.liquidationValue ?? cur.liquidationValue ?? 0,
    availableFunds: proj.availableFunds ?? cur.availableFunds ?? 0,
    buyingPower: proj.buyingPower ?? cur.buyingPower ?? 0,
    dayTradingBuyingPower: proj.dayTradingBuyingPower ?? cur.dayTradingBuyingPower ?? 0,
    cashBalance: proj.cashBalance ?? cur.cashBalance ?? 0,
    equity: proj.equity ?? cur.equity ?? 0,
  };
  const initBal = sa.initialBalances ?? {};

  const curLiq = bal.liquidationValue ?? 0;
  const initLiq = initBal.liquidationValue ?? initBal.accountValue ?? 0;
  const dayPL = curLiq - initLiq;
  const totalPL = (sa.positions ?? []).reduce(
    (sum: number, p: any) => sum + (p.longOpenProfitLoss ?? 0), 0);

  const positions = (sa.positions ?? []).map((p: any) => {
    const inst = p.instrument ?? {};
    return {
      symbol: inst.symbol,
      underlyingSymbol: inst.underlyingSymbol ?? inst.symbol,
      description: inst.description ?? inst.symbol,
      assetType: inst.assetType,
      putCall: inst.putCall ?? null,
      cusip: inst.cusip,
      longQuantity: p.longQuantity ?? 0,
      shortQuantity: p.shortQuantity ?? 0,
      averagePrice: p.averagePrice ?? 0,
      marketValue: p.marketValue ?? 0,
      currentDayProfitLoss: p.currentDayProfitLoss ?? 0,
      currentDayProfitLossPercentage: p.currentDayProfitLossPercentage ?? 0,
      longOpenProfitLoss: p.longOpenProfitLoss ?? 0,
      maintenanceRequirement: p.maintenanceRequirement ?? 0,
      settledLongQuantity: p.settledLongQuantity ?? 0,
      settledShortQuantity: p.settledShortQuantity ?? 0,
      previousSessionLongQuantity: p.previousSessionLongQuantity ?? 0,
    };
  });

  const acctNum = String(sa.accountNumber ?? "");
  return {
    accountNumber: acctNum.length > 4 ? `****${acctNum.slice(-4)}` : acctNum,
    type: sa.type,
    isDayTrader: sa.isDayTrader ?? false,
    roundTrips: sa.roundTrips ?? 0,
    balances: {
      liquidationValue: bal.liquidationValue ?? 0,
      equity: bal.equity ?? 0,
      buyingPower: bal.buyingPower ?? 0,
      dayTradingBuyingPower: bal.dayTradingBuyingPower ?? 0,
      cashBalance: bal.cashBalance ?? 0,
      availableFunds: bal.availableFunds ?? 0,
      marginBalance: bal.marginBalance ?? 0,
      maintenanceRequirement: bal.maintenanceRequirement ?? 0,
      longMarketValue: bal.longMarketValue ?? 0,
      shortMarketValue: bal.shortMarketValue ?? 0,
      longOptionMarketValue: bal.longOptionMarketValue ?? 0,
      shortOptionMarketValue: bal.shortOptionMarketValue ?? 0,
      moneyMarketFund: bal.moneyMarketFund ?? 0,
      mutualFundValue: bal.mutualFundValue ?? 0,
      bondValue: bal.bondValue ?? 0,
      pendingDeposits: bal.pendingDeposits ?? 0,
      sma: bal.sma ?? 0,
    },
    initialBalances: {
      accountValue: initBal.accountValue ?? initBal.liquidationValue ?? 0,
      equity: initBal.equity ?? 0,
      liquidationValue: initBal.liquidationValue ?? 0,
    },
    dayPL,
    totalPL,
    positions,
  };
}

function mapOrders(orders: any[]) {
  return orders.map((o: any) => {
    const legs = (o.orderLegCollection ?? []).map((leg: any) => ({
      instruction: leg.instruction,
      quantity: leg.quantity,
      symbol: leg.instrument?.symbol,
      underlyingSymbol: leg.instrument?.underlyingSymbol ?? leg.instrument?.symbol,
      assetType: leg.instrument?.assetType,
      putCall: leg.instrument?.putCall ?? null,
      description: leg.instrument?.description ?? leg.instrument?.symbol,
    }));
    const fills = (o.orderActivityCollection ?? []).flatMap((act: any) =>
      (act.executionLegs ?? []).map((el: any) => ({
        legId: el.legId,
        price: el.price,
        quantity: el.quantity,
        time: el.time,
      }))
    );
    return {
      orderId: o.orderId,
      orderType: o.orderType,
      session: o.session,
      duration: o.duration,
      status: o.status,
      filledQuantity: o.filledQuantity ?? 0,
      remainingQuantity: o.remainingQuantity ?? 0,
      price: o.price ?? o.stopPrice ?? null,
      complexStrategy: o.complexOrderStrategyType ?? "NONE",
      enteredTime: o.enteredTime,
      closeTime: o.closeTime ?? null,
      legs,
      fills,
      tag: o.tag ?? null,
    };
  }).sort((a: any, b: any) =>
    new Date(b.enteredTime).getTime() - new Date(a.enteredTime).getTime()
  );
}

let lastPortfolioAuthWarn = 0;

function subscribeStreamerForPortfolioAccounts(
  mapped: Array<{ positions?: Array<{ symbol?: string; underlyingSymbol?: string; assetType?: string }> }>,
) {
  const equityUnderlyings = new Set<string>();
  const optionSymbols = new Set<string>();
  const futuresSymbols = new Set<string>();
  const futuresOptionSymbols = new Set<string>();
  for (const acct of mapped) {
    for (const p of acct.positions ?? []) {
      if (!p.symbol) continue;
      if (p.assetType === "OPTION" || p.assetType === "INDEX_OPTION") {
        optionSymbols.add(p.symbol);
        if (p.underlyingSymbol) equityUnderlyings.add(p.underlyingSymbol);
      } else if (p.assetType === "FUTURE_OPTION") {
        futuresOptionSymbols.add(p.symbol);
        if (p.underlyingSymbol) futuresSymbols.add(p.underlyingSymbol);
      } else if (p.assetType === "FUTURE") {
        futuresSymbols.add(p.symbol);
      } else if (
        p.assetType === "EQUITY" ||
        p.assetType === "ETF" ||
        p.assetType === "COLLECTIVE_INVESTMENT" ||
        p.assetType === "INDEX"
      ) {
        equityUnderlyings.add(p.symbol);
      }
    }
  }
  if (equityUnderlyings.size > 0) addSymbols([...equityUnderlyings]);
  if (optionSymbols.size > 0) addOptionSymbols([...optionSymbols]);
  if (futuresSymbols.size > 0) addFuturesSymbols([...futuresSymbols]);
  if (futuresOptionSymbols.size > 0) addFuturesOptionSymbols([...futuresOptionSymbols]);
}

function safeSend(ws: WebSocket, data: string) {
  if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

async function fetchAndPushPortfolio(ws: WebSocket, isClosed: () => boolean) {
  if (ws.readyState !== WebSocket.OPEN) return;

  const trader = getTokens("trader");
  const token = trader?.accessToken;
  if (!token) {
    const now = Date.now();
    if (now - lastPortfolioAuthWarn > 30_000) {
      lastPortfolioAuthWarn = now;
      logger.warn("Portfolio poll: no Schwab trader token available — portfolio cannot update");
    }
    safeSend(ws, JSON.stringify({ event: "portfolioStatus", data: { status: "no_token", message: "Schwab authentication required" } }));
    return;
  }

  try {
    const mapped = await fetchMappedSchwabAccounts(token);
    if (isClosed()) return;
    logger.info(
      { ts: Date.now(), accountCount: mapped.length },
      `[PORTFOLIO_POLL] GET /accounts?fields=positions OK (${mapped.length} accounts)`,
    );
    // Explicit healthy signal: clients infer "ok" from account payloads, but
    // an account list of zero would otherwise leave them stuck on a stale
    // no_token/error status (and a "reconnect Schwab" banner) forever.
    safeSend(ws, JSON.stringify({ event: "portfolioStatus", data: { status: "ok" } }));
    if (mapped.length > 0) {
      safeSend(ws, JSON.stringify({ event: "portfolioAccounts", data: mapped }));
      safeSend(ws, JSON.stringify({ event: "portfolioAccount", data: mapped[0] }));
      try {
        subscribeStreamerForPortfolioAccounts(mapped);
        logger.debug(
          { accounts: mapped.length, positions: mapped.reduce((n, a) => n + (a.positions?.length ?? 0), 0) },
          "Portfolio streamer subscriptions updated",
        );
      } catch (subErr) {
        logger.debug({ err: subErr }, "Portfolio streamer subscription failed");
      }
    }
  } catch (err) {
    logger.debug({ err }, "Portfolio account poll failed");
    if (!isClosed()) safeSend(ws, JSON.stringify({ event: "portfolioStatus", data: { status: "error", message: "Failed to fetch account data" } }));
  }

  if (isClosed()) return;

  try {
    const hash = await getAccountHash(token);
    if (!hash || isClosed()) return;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const orders = await schwabTraderGet(
      `/accounts/${hash}/orders?fromEnteredTime=${start.toISOString()}&toEnteredTime=${end.toISOString()}`,
      token
    );
    if (isClosed()) return;
    const mapped = mapOrders(Array.isArray(orders) ? orders : []);
    safeSend(ws, JSON.stringify({ event: "portfolioOrders", data: mapped }));
  } catch (err) {
    logger.debug({ err }, "Portfolio WS orders poll failed");
  }
}

function startPortfolioPoll(ws: WebSocket, isClosed: () => boolean) {
  if (portfolioSubs.has(ws)) return;

  plCalcLogState.set(ws, { firstFullDone: false, lastPlPctByKey: new Map() });
  void fetchAndPushPortfolio(ws, isClosed);

  const interval = setInterval(() => void fetchAndPushPortfolio(ws, isClosed), PORTFOLIO_POLL_MS);
  portfolioSubs.set(ws, interval);
  logger.info({ subs: portfolioSubs.size }, "Portfolio WS polling started");
}

function stopPortfolioPoll(ws: WebSocket) {
  const interval = portfolioSubs.get(ws);
  if (interval) {
    clearInterval(interval);
    portfolioSubs.delete(ws);
    plCalcLogState.delete(ws);
    logger.info({ subs: portfolioSubs.size }, "Portfolio WS polling stopped");
  }
}

export function broadcastToClients(event: string, data: unknown) {
  if (event === "orderAlert") {
    const openCount = [...clients].filter(ws => ws.readyState === WebSocket.OPEN).length;
    logger.info({ event, totalClients: clients.size, openClients: openCount }, "broadcastToClients orderAlert");
  }
  if (clients.size === 0) return;

  const msg = jsonStringifyForWire({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function initWsServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  registerWsBroadcast(broadcastToClients);
  registerPortfolioErrorBroadcast((data) => broadcastToClients("portfolio_error", data));

  httpServer.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    if (!DEV_BYPASS) {
      const token = url.searchParams.get("clerk_token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! });
      } catch (err) {
        logger.warn({ err }, "WS Clerk token verification failed");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.info({ total: clients.size }, "WS price client connected");

    let closed = false;
    const isClosed = () => closed;

    const snapshot = getSnapshot();
    const status = getStreamerStatus();

    if (status) {
      ws.send(JSON.stringify({ event: "streamerStatus", data: { status } }));
    }
    if (snapshot && snapshot.length > 0) {
      ws.send(JSON.stringify({ event: "snapshot", data: snapshot }));
    }

    const hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, HEARTBEAT_MS);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.action === "subscribePortfolio") {
          startPortfolioPoll(ws, isClosed);
        } else if (msg.action === "unsubscribePortfolio") {
          stopPortfolioPoll(ws);
        }
      } catch {}
    });

    ws.on("close", () => {
      closed = true;
      clearInterval(hb);
      stopPortfolioPoll(ws);
      clients.delete(ws);
      logger.info({ total: clients.size }, "WS price client disconnected");
    });

    ws.on("error", (err) => {
      closed = true;
      clearInterval(hb);
      stopPortfolioPoll(ws);
      clients.delete(ws);
      logger.warn({ err }, "WS client error");
    });
  });

  logger.info("WebSocket price server initialized at " + WS_PATH);
}
