import type { SchwabAccountSummary } from "./schwab-account-types";

/** Compact signature — skip React updates when Schwab poll returns identical holdings. */
export function schwabAccountsFingerprint(accounts: SchwabAccountSummary[]): string {
  return accounts
    .map((a) => {
      const pos = a.positions
        .map(
          (p) =>
            `${p.symbol}|${p.longQuantity}|${p.shortQuantity}|${p.marketValue}|${p.longOpenProfitLoss}|${p.currentDayProfitLoss}`,
        )
        .join(";");
      return [
        a.hashValue ?? "",
        a.balances.liquidationValue,
        a.balances.availableFunds,
        a.balances.buyingPower,
        a.dayPL,
        a.totalPL,
        pos,
      ].join(":");
    })
    .join("||");
}
