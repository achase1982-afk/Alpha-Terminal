import { getTokens } from "./tokenStore.js";
import { logger } from "./logger.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";
const ACCOUNT_POLL_MS = 1_000;
const ORDERS_POLL_MS = 3_000;

let broadcastFn: ((event: string, data: unknown) => void) | null = null;
let accountTimer: ReturnType<typeof setInterval> | null = null;
let ordersTimer: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;
let lastAccountJson = "";
let lastOrdersJson = "";
let lastAccountHash = "";

function getTraderToken(): string | null {
  const trader = getTokens("trader");
  return trader?.accessToken ?? null;
}

async function schwabGet(path: string, token: string) {
  const res = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Schwab ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function mapAccount(acct: any) {
  const sa = acct.securitiesAccount;
  const bal = sa.currentBalances ?? {};
  const initBal = sa.initialBalances ?? {};

  const dayPL = (sa.positions ?? []).reduce(
    (sum: number, p: any) => sum + (p.currentDayProfitLoss ?? 0),
    0
  );
  const totalPL = (sa.positions ?? []).reduce(
    (sum: number, p: any) => sum + (p.longOpenProfitLoss ?? 0),
    0
  );

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

async function pollAccount() {
  const token = getTraderToken();
  if (!token || !broadcastFn) return;

  try {
    const accounts = await schwabGet("/accounts?fields=positions", token);
    if (!Array.isArray(accounts) || accounts.length === 0) return;

    const mapped = mapAccount(accounts[0]);
    const json = JSON.stringify(mapped);

    if (json !== lastAccountJson) {
      lastAccountJson = json;
      broadcastFn("portfolioAccount", mapped);
    }
  } catch (err) {
    logger.debug({ err }, "Portfolio poller: account fetch failed");
  }
}

async function pollOrders() {
  const token = getTraderToken();
  if (!token || !broadcastFn) return;

  try {
    if (!lastAccountHash) {
      const nums = await schwabGet("/accounts/accountNumbers", token);
      if (nums.length > 0) lastAccountHash = nums[0].hashValue;
      else return;
    }

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);

    const orders = await schwabGet(
      `/accounts/${lastAccountHash}/orders?fromEnteredTime=${start.toISOString()}&toEnteredTime=${end.toISOString()}`,
      token
    );

    const mapped = mapOrders(Array.isArray(orders) ? orders : []);
    const json = JSON.stringify(mapped);

    if (json !== lastOrdersJson) {
      lastOrdersJson = json;
      broadcastFn("portfolioOrders", mapped);
    }
  } catch (err) {
    logger.debug({ err }, "Portfolio poller: orders fetch failed");
  }
}

function startPolling() {
  if (accountTimer) return;
  logger.info("Portfolio poller: starting (5s accounts, 10s orders)");

  pollAccount();
  pollOrders();

  accountTimer = setInterval(pollAccount, ACCOUNT_POLL_MS);
  ordersTimer = setInterval(pollOrders, ORDERS_POLL_MS);
}

function stopPolling() {
  if (accountTimer) {
    clearInterval(accountTimer);
    accountTimer = null;
  }
  if (ordersTimer) {
    clearInterval(ordersTimer);
    ordersTimer = null;
  }
  lastAccountJson = "";
  lastOrdersJson = "";
  lastAccountHash = "";
  logger.info("Portfolio poller: stopped");
}

export function registerPortfolioBroadcast(fn: (event: string, data: unknown) => void) {
  broadcastFn = fn;
}

export function onPortfolioSubscribe() {
  subscriberCount++;
  if (subscriberCount === 1) startPolling();
}

export function onPortfolioUnsubscribe() {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0) stopPolling();
}

export function forcePortfolioPoll() {
  pollAccount();
  pollOrders();
}

export function getLastPortfolioSnapshot(): { account: unknown; orders: unknown } | null {
  if (!lastAccountJson) return null;
  return {
    account: JSON.parse(lastAccountJson),
    orders: lastOrdersJson ? JSON.parse(lastOrdersJson) : [],
  };
}
