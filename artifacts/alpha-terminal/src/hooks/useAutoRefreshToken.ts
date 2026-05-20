import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTerminalStore } from "@/lib/store";
import { signalSchwabAuthLost } from "@/lib/authNoticeStore";
import {
  refreshSchwabViaServer,
  schwabRefreshErrorDetail,
  syncSchwabTokensFromServer,
} from "@/lib/schwabTokenSync";

const REFRESH_INTERVAL_MS = 25 * 60 * 1000; // 25 minutes — server also refreshes ~5 min before expiry

function schwabSessionActive(): boolean {
  const { accessToken, traderAccessToken, refreshToken, traderRefreshToken } =
    useTerminalStore.getState();
  return !!(accessToken || traderAccessToken || refreshToken || traderRefreshToken);
}

export function useAutoRefreshToken() {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const traderAccessToken = useTerminalStore((s) => s.traderAccessToken);
  const clearTokens = useTerminalStore((s) => s.clearTokens);
  const clearTraderTokens = useTerminalStore((s) => s.clearTraderTokens);
  const isRefreshing = useRef(false);
  const didInitialSync = useRef(false);

  const handleRefreshFailure = useCallback(
    (status: number, bodyText: string) => {
      if (status === 0) return false;
      const detail = schwabRefreshErrorDetail(bodyText);
      const isRevoked =
        status === 400 &&
        /invalid_grant|expired|revoked|refresh_token/i.test(bodyText);

      if (!isRevoked) return false;

      signalSchwabAuthLost(
        "Schwab login could not be renewed automatically.",
        detail ??
          "Your saved Schwab session is no longer valid. Use Reconnect Schwab — you should not need to sign out of your account.",
      );
      toast.error("Schwab session ended", {
        id: "schwab-session-ended",
        description: "Reconnect Schwab to restore live quotes and portfolio.",
      });
      clearTokens();
      clearTraderTokens();
      return true;
    },
    [clearTokens, clearTraderTokens],
  );

  /** Server-canonical refresh — never sends a stale client refresh_token to Schwab. */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!schwabSessionActive() || isRefreshing.current) return false;
    isRefreshing.current = true;
    try {
      const { ok, status, bodyText } = await refreshSchwabViaServer();
      if (ok) return true;
      handleRefreshFailure(status, bodyText);
      return false;
    } catch {
      return false;
    } finally {
      isRefreshing.current = false;
    }
  }, [handleRefreshFailure]);

  useEffect(() => {
    if (!schwabSessionActive()) {
      didInitialSync.current = false;
      return;
    }
    if (didInitialSync.current) return;
    didInitialSync.current = true;

    void (async () => {
      await syncSchwabTokensFromServer();
      await refresh();
    })();
  }, [accessToken, traderAccessToken, refresh]);

  useEffect(() => {
    if (!schwabSessionActive()) return;
    const id = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [accessToken, traderAccessToken, refresh]);

  // Tab focus: sync tokens from server only (server owns the refresh grant).
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !schwabSessionActive()) return;
      void syncSchwabTokensFromServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [accessToken, traderAccessToken]);

  return { refresh, refreshTrader: refresh };
}
