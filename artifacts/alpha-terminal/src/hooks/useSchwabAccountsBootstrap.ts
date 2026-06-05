import { useEffect } from "react";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

/** Load Schwab accounts + server prefs when brokerage session is active. */
export function useSchwabAccountsBootstrap(enabled: boolean) {
  const refresh = useSchwabAccountStore((s) => s.refreshAccounts);
  const loadPrefs = useSchwabAccountStore((s) => s.loadPreferencesFromServer);

  useEffect(() => {
    if (!enabled) return;
    void loadPrefs().then(() => refresh());
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [enabled, refresh, loadPrefs]);
}
