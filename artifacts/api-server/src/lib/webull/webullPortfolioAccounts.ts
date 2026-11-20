import { webullSignedFetch } from "./webullClient.js";
import { isWebullTradingReady, webullAccountHash, getWebullToken } from "./webullTokenStore.js";
import { logger } from "../logger.js";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function mapWebullAccountType(row: Record<string, unknown>): string {
  const mapping = typeof row.account_class_mapping === "string" ? row.account_class_mapping : "";
  const accountType = typeof row.account_type === "string" ? row.account_type : "";
  const label = typeof row.account_label === "string" ? row.account_label : "";
  if (/events/i.test(mapping) || /events/i.test(accountType) || /events/i.test(label)) {
    return "Events Cash";
  }
  if (/futures/i.test(mapping) || /futures/i.test(accountType) || /futures/i.test(label)) {
    return "Futures";
  }
  if (/margin/i.test(mapping) || accountType === "MARGIN" || /margin/i.test(label)) {
    return "Margin";
  }
  return label || accountType || "Margin";
}

function mapPosition(p: Record<string, unknown>) {
  const qty = num(p.quantity);
  const isShort = qty < 0;
  const absQty = Math.abs(qty);
  const instrumentType = String(p.instrument_type ?? "EQUITY");
  const symbol = String(p.symbol ?? "");
  const isOption = instrumentType === "OPTION";
  return {
    symbol,
    underlyingSymbol: String(p.underlying_symbol ?? symbol),
    description: String(p.symbol_name ?? symbol),
    assetType: isOption ? "OPTION" : instrumentType === "FUTURES" ? "FUTURES" : "EQUITY",
    putCall: typeof p.option_type === "string" ? p.option_type : null,
    cusip: String(p.position_id ?? ""),
    longQuantity: isShort ? 0 : absQty,
    shortQuantity: isShort ? absQty : 0,
    averagePrice: num(p.cost_price ?? p.average_cost),
    marketValue: num(p.market_value),
    currentDayProfitLoss: num(p.day_profit_loss),
    currentDayProfitLossPercentage: 0,
    longOpenProfitLoss: num(p.unrealized_profit_loss),
    maintenanceRequirement: 0,
    settledLongQuantity: 0,
    settledShortQuantity: 0,
    previousSessionLongQuantity: 0,
    closePrice: p.last_price != null ? num(p.last_price) : null,
    currentDayCost: null,
  };
}

function mapBalances(balance: Record<string, unknown>, currencyAssets: Record<string, unknown> | undefined) {
  const usd = currencyAssets ?? {};
  return {
    liquidationValue: num(balance.total_net_liquidation_value),
    equity: num(balance.total_net_liquidation_value),
    buyingPower: num(usd.buying_power ?? balance.total_cash_balance),
    dayTradingBuyingPower: num(usd.day_buying_power),
    cashBalance: num(balance.total_cash_balance ?? usd.cash_balance),
    availableFunds: num(usd.buying_power ?? balance.total_cash_balance),
    marginBalance: num(balance.used_margin),
    maintenanceRequirement: num(balance.maintenance_margin),
    longMarketValue: num(balance.total_market_value),
    shortMarketValue: 0,
    longOptionMarketValue: 0,
    shortOptionMarketValue: 0,
    moneyMarketFund: 0,
    mutualFundValue: 0,
    bondValue: 0,
    pendingDeposits: 0,
    sma: 0,
  };
}

export async function fetchMappedWebullAccounts(): Promise<
  Awaited<ReturnType<typeof import("../schwabPortfolioAccounts.js").fetchMappedSchwabAccounts>>
> {
  const token = await getWebullToken();
  if (!isWebullTradingReady(token)) return [];

  const accountRows = await webullSignedFetch<Array<Record<string, unknown>>>({
    method: "GET",
    path: "/trading/accounts/list",
    withAccessToken: true,
  });
  const list = Array.isArray(accountRows) ? accountRows : [];
  const out: Awaited<
    ReturnType<typeof import("../schwabPortfolioAccounts.js").fetchMappedSchwabAccounts>
  > = [];

  for (const row of list) {
    const accountId = String(row.account_id ?? "");
    if (!accountId) continue;
    let balance: Record<string, unknown> = {};
    let positions: unknown[] = [];
    try {
      balance = await webullSignedFetch<Record<string, unknown>>({
        method: "GET",
        path: "/trading/assets/balances/get",
        query: { account_id: accountId },
        withAccessToken: true,
      });
    } catch (err) {
      logger.warn({ err, accountId }, "Webull balance fetch failed");
    }
    try {
      const posPayload = await webullSignedFetch<unknown>({
        method: "GET",
        path: "/trading/assets/positions/list",
        query: { account_id: accountId },
        withAccessToken: true,
      });
      positions = Array.isArray(posPayload) ? posPayload : [];
    } catch (err) {
      logger.warn({ err, accountId }, "Webull positions fetch failed");
    }

    const currencyAssets = Array.isArray(balance.account_currency_assets)
      ? (balance.account_currency_assets[0] as Record<string, unknown>)
      : undefined;
    const acctNumRaw = String(row.account_number ?? accountId);
    const acctNum = acctNumRaw.length > 4 ? `****${acctNumRaw.slice(-4)}` : acctNumRaw;
    const dayPL = num(balance.total_day_profit_loss);
    const totalPL = num(balance.total_unrealized_profit_loss);
    const liq = num(balance.total_net_liquidation_value);

    out.push({
      accountNumber: acctNum,
      accountNumberRaw: acctNumRaw,
      hashValue: webullAccountHash(accountId),
      type: mapWebullAccountType(row),
      isDayTrader: false,
      roundTrips: 0,
      balances: mapBalances(balance, currencyAssets),
      initialBalances: {
        accountValue: liq - dayPL,
        equity: liq - dayPL,
        liquidationValue: liq - dayPL,
      },
      dayPL,
      totalPL,
      positions: (positions as Record<string, unknown>[]).map(mapPosition),
    });
  }
  return out;
}