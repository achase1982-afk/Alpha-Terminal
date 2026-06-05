import type { SchwabAccountSummary } from "./schwab-account-types";
import { aggregateSchwabAccounts } from "./schwabAccountAggregate";
import type { SchwabViewSelection } from "./schwab-account-types";

/** Resolve portfolio view (all vs one sub-account) from the latest Schwab account list. */
export function resolvePortfolioDisplayAccount(
  accounts: SchwabAccountSummary[],
  viewSelection: SchwabViewSelection,
): SchwabAccountSummary | null {
  if (!accounts.length) return null;
  if (viewSelection === "all") return aggregateSchwabAccounts(accounts);
  return accounts.find((a) => a.hashValue === viewSelection) ?? accounts[0] ?? null;
}
