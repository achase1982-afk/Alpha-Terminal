import { fetchMappedSchwabAccounts, schwabTraderGet } from "./schwabPortfolioAccounts.js";

export interface LiveBook {
  accountRef: string;
  type: string | null;
  accountNumber: string | null;
  liquidation: number | null;
  positions: {
    symbol?: string | null;
    assetType?: string | null;
    longQuantity?: number | null;
    shortQuantity?: number | null;
    marketValue?: number | null;
  }[];
}

export async function listLiveBooks(token: string): Promise<LiveBook[]> {
  const accounts = await fetchMappedSchwabAccounts(token);
  return accounts.flatMap((account) => {
    if (!account.hashValue) return [];
    return [{
      accountRef: account.hashValue,
      type: account.type ?? null,
      accountNumber: account.accountNumberRaw ?? null,
      liquidation: typeof account.balances?.liquidationValue === "number" ? account.balances.liquidationValue : null,
      positions: account.positions ?? [],
    }];
  });
}

export async function fetchHistory(
  token: string,
  accountRef: string,
  kind: "orders" | "activities",
  window: { start: Date; end: Date },
): Promise<unknown> {
  const hash = encodeURIComponent(accountRef);
  const path = kind === "orders"
    ? `/accounts/${hash}/orders?fromEnteredTime=${encodeURIComponent(window.start.toISOString())}&toEnteredTime=${encodeURIComponent(window.end.toISOString())}`
    : `/accounts/${hash}/transactions?startDate=${encodeURIComponent(window.start.toISOString())}&endDate=${encodeURIComponent(window.end.toISOString())}`;
  return schwabTraderGet(path, token, 2);
}
