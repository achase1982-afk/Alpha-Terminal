import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { verifyToken } from "@clerk/express";
import { logger } from "./logger.js";
import { getSnapshot, getStreamerStatus, registerWsBroadcast, addSymbols, addOptionSymbols, addFuturesSymbols, addFuturesOptionSymbols } from "./schwabStreamer.js";
import { getTokens } from "./tokenStore.js";

const WS_PATH = "/api/ws/prices";
const HEARTBEAT_MS = 25_000;
const PORTFOLIO_POLL_MS = 1_000;
const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

const clients = new Set<WebSocket>();
const portfolioSubs = new Map<WebSocket, ReturnType<typeof setInterval>>();

let cachedAccountHash: string | null = null;
let accountHashExpiry = 0;

async function schwabTraderGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Schwab ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
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

async function fetchAndPushPortfolio(ws: WebSocket) {
  if (ws.readyState !== WebSocket.OPEN) return;

  const trader = getTokens("trader");
  const token = trader?.accessToken;
  if (!token) {
    const now = Date.now();
    if (now - lastPortfolioAuthWarn > 30_000) {
      lastPortfolioAuthWarn = now;
      logger.warn("Portfolio poll: no Schwab trader token available — portfolio cannot update");
    }
    ws.send(JSON.stringify({ event: "portfolioStatus", data: { status: "no_token", message: "Schwab authentication required" } }));
    return;
  }

  try {
    const accounts = await schwabTraderGet("/accounts?fields=positions", token);
    if (accounts.length > 0) {
      const mapped = mapAccount(accounts[0]);
      ws.send(JSON.stringify({ event: "portfolioAccount", data: mapped }));

      // Subscribe every portfolio symbol to the live streamer so the LAST
      // column populates for ALL holdings (not just whichever ticker the
      // user happens to have selected/charted). Equity underlyings go to
      // LEVELONE_EQUITIES, options go to LEVELONE_OPTIONS.
      try {
        const equityUnderlyings = new Set<string>();
        const optionSymbols = new Set<string>();
        const futuresSymbols = new Set<string>();
        const futuresOptionSymbols = new Set<string>();
        for (const p of mapped.positions ?? []) {
          if (!p.symbol) continue;
          if (p.assetType === "OPTION" || p.assetType === "INDEX_OPTION") {
            optionSymbols.add(p.symbol);
            if (p.underlyingSymbol) equityUnderlyings.add(p.underlyingSymbol);
          } else if (p.assetType === "FUTURE_OPTION") {
            futuresOptionSymbols.add(p.symbol);
            if (p.underlyingSymbol) futuresSymbols.add(p.underlyingSymbol);
          } else if (p.assetType === "FUTURE") {
            futuresSymbols.add(p.symbol);
          } else if (p.assetType === "EQUITY" || p.assetType === "ETF" || p.assetType === "COLLECTIVE_INVESTMENT" || p.assetType === "INDEX") {
            equityUnderlyings.add(p.symbol);
          }
        }
        if (equityUnderlyings.size > 0) addSymbols([...equityUnderlyings]);
        if (optionSymbols.size > 0) addOptionSymbols([...optionSymbols]);
        if (futuresSymbols.size > 0) addFuturesSymbols([...futuresSymbols]);
        if (futuresOptionSymbols.size > 0) addFuturesOptionSymbols([...futuresOptionSymbols]);
      } catch (subErr) {
        logger.debug({ err: subErr }, "Portfolio streamer subscription failed");
      }
    }
  } catch (err) {
    logger.debug({ err }, "Portfolio WS account poll failed");
    ws.send(JSON.stringify({ event: "portfolioStatus", data: { status: "error", message: "Failed to fetch account data" } }));
  }

  try {
    const hash = await getAccountHash(token);
    if (!hash) return;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const orders = await schwabTraderGet(
      `/accounts/${hash}/orders?fromEnteredTime=${start.toISOString()}&toEnteredTime=${end.toISOString()}`,
      token
    );
    const mapped = mapOrders(Array.isArray(orders) ? orders : []);
    ws.send(JSON.stringify({ event: "portfolioOrders", data: mapped }));
  } catch (err) {
    logger.debug({ err }, "Portfolio WS orders poll failed");
  }
}

function startPortfolioPoll(ws: WebSocket) {
  if (portfolioSubs.has(ws)) return;

  fetchAndPushPortfolio(ws);

  const interval = setInterval(() => fetchAndPushPortfolio(ws), PORTFOLIO_POLL_MS);
  portfolioSubs.set(ws, interval);
  logger.info({ subs: portfolioSubs.size }, "Portfolio WS polling started");
}

function stopPortfolioPoll(ws: WebSocket) {
  const interval = portfolioSubs.get(ws);
  if (interval) {
    clearInterval(interval);
    portfolioSubs.delete(ws);
    logger.info({ subs: portfolioSubs.size }, "Portfolio WS polling stopped");
  }
}

export function broadcastToClients(event: string, data: unknown) {
  if (event === "orderAlert") {
    const openCount = [...clients].filter(ws => ws.readyState === WebSocket.OPEN).length;
    logger.info({ event, totalClients: clients.size, openClients: openCount }, "broadcastToClients orderAlert");
  }
  if (clients.size === 0) return;

  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function initWsServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  registerWsBroadcast(broadcastToClients);

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

    const snapshot = getSnapshot();
    const status = getStreamerStatus();

    if (status) {
      ws.send(JSON.stringify({ event: "streamerStatus", data: status }));
    }
    if (snapshot && Object.keys(snapshot).length > 0) {
      ws.send(JSON.stringify({ event: "snapshot", data: snapshot }));
    }

    const hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, HEARTBEAT_MS);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.action === "subscribePortfolio") {
          startPortfolioPoll(ws);
        } else if (msg.action === "unsubscribePortfolio") {
          stopPortfolioPoll(ws);
        }
      } catch {}
    });

    ws.on("close", () => {
      clearInterval(hb);
      stopPortfolioPoll(ws);
      clients.delete(ws);
      logger.info({ total: clients.size }, "WS price client disconnected");
    });

    ws.on("error", (err) => {
      clearInterval(hb);
      stopPortfolioPoll(ws);
      clients.delete(ws);
      logger.warn({ err }, "WS client error");
    });
  });

  logger.info("WebSocket price server initialized at " + WS_PATH);
}
