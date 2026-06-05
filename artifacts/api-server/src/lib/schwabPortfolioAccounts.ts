import { logger } from "./logger.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

export interface SchwabAccountNumberRow {
  accountNumber: string;
  hashValue: string;
}

export async function schwabTraderGet(path: string, token: string, retries = 1): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => "");
    if (res.status >= 500 && attempt < retries) {
      logger.warn({ path, status: res.status, attempt }, "Schwab 5xx, retrying...");
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`Schwab ${path} returned ${res.status}: ${body.slice(0, 300)}`);
  }
  throw new Error(`Schwab ${path} exhausted retries`);
}

export async function fetchAccountNumberRows(token: string): Promise<SchwabAccountNumberRow[]> {
  const nums = await schwabTraderGet("/accounts/accountNumbers", token);
  if (!Array.isArray(nums)) return [];
  return nums
    .map((row: { accountNumber?: string; hashValue?: string }) => ({
      accountNumber: String(row.accountNumber ?? ""),
      hashValue: String(row.hashValue ?? ""),
    }))
    .filter((r) => r.accountNumber && r.hashValue);
}

export function hashByAccountNumber(rows: SchwabAccountNumberRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.accountNumber, row.hashValue);
  return map;
}

/** Resolve hash from query/body; falls back to first linked account. */
export async function resolveAccountHash(
  token: string,
  requestedHash?: string | null,
): Promise<string | null> {
  const rows = await fetchAccountNumberRows(token);
  if (!rows.length) return null;
  const trimmed = typeof requestedHash === "string" ? requestedHash.trim() : "";
  if (trimmed && rows.some((r) => r.hashValue === trimmed)) return trimmed;
  return rows[0].hashValue;
}

export function mapSchwabSecuritiesAccount(acct: any, hashValue: string | null) {
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

  const curLiq = proj.liquidationValue ?? cur.liquidationValue ?? 0;
  const initLiq = initBal.liquidationValue ?? initBal.accountValue ?? 0;
  const dayPL = curLiq - initLiq;
  const totalPL = (sa.positions ?? []).reduce(
    (sum: number, p: any) => sum + (p.longOpenProfitLoss ?? 0),
    0,
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
      closePrice: p.closePrice ?? null,
      currentDayCost: p.currentDayCost ?? null,
    };
  });

  const acctNumRaw = String(sa.accountNumber ?? "");
  const acctNum = acctNumRaw.length > 4 ? `****${acctNumRaw.slice(-4)}` : acctNumRaw;

  return {
    accountNumber: acctNum,
    accountNumberRaw: acctNumRaw,
    hashValue,
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

export async function fetchMappedSchwabAccounts(token: string) {
  const [accounts, numberRows] = await Promise.all([
    schwabTraderGet("/accounts?fields=positions", token, 2),
    fetchAccountNumberRows(token),
  ]);
  const hashMap = hashByAccountNumber(numberRows);
  const list = Array.isArray(accounts) ? accounts : [];
  return list.map((acct: any) => {
    const raw = String(acct?.securitiesAccount?.accountNumber ?? "");
    return mapSchwabSecuritiesAccount(acct, hashMap.get(raw) ?? null);
  });
}
