import { useEffect } from "react";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

/** Load Schwab accounts + server prefs when brokerage session is active. */
export function useSchwabAccountsBootstrap(enabled: boolean) {
  const refresh = useSchwabAccountStore((s) => s.refreshAccounts);
  const loadPrefs = useSchwabAccountStore((s) => s.loadPreferencesFromServer);

  useEffect(() => {
    if (!enabled) return;
    void loadPrefs().then(() => refresh());
    // Slow background refresh — fast polling re-rendered the portfolio table and broke horizontal swipe.
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [enabled, refresh, loadPrefs]);
}
