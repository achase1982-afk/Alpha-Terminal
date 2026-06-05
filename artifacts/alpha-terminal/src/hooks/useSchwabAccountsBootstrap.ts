import { useEffect } from "react";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

/**
 * Load Schwab account preferences once. Portfolio holdings refresh at 1 Hz via
 * subscribePortfolio (same path as before multi-account) — no separate REST poll.
 */
export function useSchwabAccountsBootstrap(enabled: boolean) {
  const loadPrefs = useSchwabAccountStore((s) => s.loadPreferencesFromServer);
  const refreshAccounts = useSchwabAccountStore((s) => s.refreshAccounts);

  useEffect(() => {
    if (!enabled) return;
    void loadPrefs();
    void refreshAccounts();
  }, [enabled, loadPrefs, refreshAccounts]);
}
