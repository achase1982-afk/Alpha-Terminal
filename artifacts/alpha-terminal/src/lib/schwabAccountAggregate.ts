import type { SchwabAccountSummary, SchwabBalances, SchwabPosition } from "./schwab-account-types";
import { schwabAccountsFingerprint } from "./schwabAccountFingerprint";

let aggregatedCache: { fingerprint: string; result: SchwabAccountSummary } | null = null;

function emptyBalances(): SchwabBalances {
  return {
    liquidationValue: 0,
    equity: 0,
    buyingPower: 0,
    dayTradingBuyingPower: 0,
    cashBalance: 0,
    availableFunds: 0,
    marginBalance: 0,
    maintenanceRequirement: 0,
    longMarketValue: 0,
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

function mergePosition(existing: SchwabPosition, incoming: SchwabPosition): SchwabPosition {
  const longQty = existing.longQuantity + incoming.longQuantity;
  const shortQty = existing.shortQuantity + incoming.shortQuantity;
  const totalQty = longQty + shortQty;
  const weightedAvg =
    totalQty > 0
      ? (existing.averagePrice * (existing.longQuantity + existing.shortQuantity) +
          incoming.averagePrice * (incoming.longQuantity + incoming.shortQuantity)) /
        totalQty
      : existing.averagePrice;

  return {
    ...existing,
    longQuantity: longQty,
    shortQuantity: shortQty,
    averagePrice: weightedAvg,
    marketValue: existing.marketValue + incoming.marketValue,
    currentDayProfitLoss: existing.currentDayProfitLoss + incoming.currentDayProfitLoss,
    longOpenProfitLoss: existing.longOpenProfitLoss + incoming.longOpenProfitLoss,
    maintenanceRequirement: existing.maintenanceRequirement + incoming.maintenanceRequirement,
    settledLongQuantity: existing.settledLongQuantity + incoming.settledLongQuantity,
    settledShortQuantity: existing.settledShortQuantity + incoming.settledShortQuantity,
    previousSessionLongQuantity:
      existing.previousSessionLongQuantity + incoming.previousSessionLongQuantity,
  };
}

/** Combine all Schwab sub-accounts into one portfolio view (Thinkorswim "All Accounts"). */
export function aggregateSchwabAccounts(accounts: SchwabAccountSummary[]): SchwabAccountSummary | null {
  if (!accounts.length) return null;
  if (accounts.length === 1) return accounts[0]!;

  const fingerprint = schwabAccountsFingerprint(accounts);
  if (aggregatedCache?.fingerprint === fingerprint) return aggregatedCache.result;

  const balances = emptyBalances();
  const initial = { accountValue: 0, equity: 0, liquidationValue: 0 };
  let dayPL = 0;
  let totalPL = 0;
  let isDayTrader = false;
  let roundTrips = 0;

  const positionMap = new Map<string, SchwabPosition>();

  for (const acct of accounts) {
    const b = acct.balances;
    balances.liquidationValue += b.liquidationValue ?? 0;
    balances.equity += b.equity ?? 0;
    balances.buyingPower += b.buyingPower ?? 0;
    balances.dayTradingBuyingPower += b.dayTradingBuyingPower ?? 0;
    balances.cashBalance += b.cashBalance ?? 0;
    balances.availableFunds += b.availableFunds ?? 0;
    balances.marginBalance += b.marginBalance ?? 0;
    balances.maintenanceRequirement += b.maintenanceRequirement ?? 0;
    balances.longMarketValue += b.longMarketValue ?? 0;
    balances.shortMarketValue += b.shortMarketValue ?? 0;
    balances.longOptionMarketValue += b.longOptionMarketValue ?? 0;
    balances.shortOptionMarketValue += b.shortOptionMarketValue ?? 0;
    balances.moneyMarketFund += b.moneyMarketFund ?? 0;
    balances.mutualFundValue += b.mutualFundValue ?? 0;
    balances.bondValue += b.bondValue ?? 0;
    balances.pendingDeposits += b.pendingDeposits ?? 0;
    balances.sma += b.sma ?? 0;

    initial.accountValue += acct.initialBalances.accountValue ?? 0;
    initial.equity += acct.initialBalances.equity ?? 0;
    initial.liquidationValue += acct.initialBalances.liquidationValue ?? 0;

    dayPL += acct.dayPL ?? 0;
    totalPL += acct.totalPL ?? 0;
    if (acct.isDayTrader) isDayTrader = true;
    roundTrips = Math.max(roundTrips, acct.roundTrips ?? 0);

    for (const pos of acct.positions) {
      const key = `${pos.symbol}:${pos.cusip ?? ""}`;
      const prev = positionMap.get(key);
      positionMap.set(key, prev ? mergePosition(prev, pos) : { ...pos });
    }
  }

  const result: SchwabAccountSummary = {
    accountNumber: "ALL",
    accountNumberRaw: "ALL",
    hashValue: null,
    type: "ALL_ACCOUNTS",
    isDayTrader,
    roundTrips,
    balances,
    initialBalances: initial,
    dayPL,
    totalPL,
    positions: Array.from(positionMap.values()),
  };
  aggregatedCache = { fingerprint, result };
  return result;
}

export function formatSchwabAccountType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
