import { fetchMappedSchwabAccounts, schwabTraderGet } from "./schwabPortfolioAccounts.js";

export interface LiveBook {
  accountRef: string;
  type: string | null;
  accountNumber: string | null;
  label: string;
  paper: boolean;
  liquidation: number | null;
  positions: {
    symbol?: string | null;
    assetType?: string | null;
    longQuantity?: number | null;
    shortQuantity?: number | null;
    marketValue?: number | null;
  }[];
}

function paperBook(type: string | null, accountNumber: string | null): boolean {
  const blob = `${type ?? ""} ${accountNumber ?? ""}`.toLowerCase();
  return blob.includes("paper") || blob.includes("sandbox");
}

export async function listLiveBooks(token: string): Promise<LiveBook[]> {
  const accounts = await fetchMappedSchwabAccounts(token);
  return accounts.flatMap((account) => {
    if (!account.hashValue) return [];
    const type = account.type ?? null;
    const accountNumber = account.accountNumberRaw ?? null;
    const paper = paperBook(type, accountNumber);
    return [{
      accountRef: account.hashValue,
      type,
      accountNumber,
      label: paper ? "Paper Sandbox" : (type?.trim() || "Live account"),
      paper,
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
