import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { signalSchwabAuthLost } from "@/lib/authNoticeStore";

const REFRESH_INTERVAL_MS = 25 * 60 * 1000; // 25 minutes

async function readSchwabRefreshErrorDetail(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    const j = JSON.parse(text) as { message?: string; error?: string };
    const pick = j.message || j.error;
    return typeof pick === "string" && pick.length > 0 ? pick : undefined;
  } catch {
    return text.length > 200 ? `${text.slice(0, 199)}…` : text;
  }
}

export function useAutoRefreshToken() {
  const { refreshToken, setTokens, clearTokens } = useTerminalStore();
  const { traderRefreshToken, setTraderTokens, clearTraderTokens } = useTerminalStore();
  const isRefreshing = useRef(false);
  const isRefreshingTrader = useRef(false);
  const didInitialRefresh = useRef(false);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!refreshToken || isRefreshing.current) return false;
    isRefreshing.current = true;
    try {
      const res = await fetchWithAuth("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        const detail = await readSchwabRefreshErrorDetail(res);
        signalSchwabAuthLost(
          "Schwab login could not be renewed automatically.",
          detail ??
            "Your saved Schwab session is no longer valid. Use Reconnect Schwab — you should not need to sign out of your account.",
        );
        toast.error("Schwab session ended", {
          description: "Reconnect Schwab to restore live quotes and portfolio.",
        });
        clearTokens();
        return false;
      }
      const data = await res.json() as { accessToken?: string; refreshToken?: string };
      if (data.accessToken) {
        setTokens(data.accessToken, data.refreshToken ?? refreshToken);
        return true;
      }
      signalSchwabAuthLost(
        "Schwab login could not be renewed automatically.",
        "The server returned an empty token. Reconnect Schwab from the banner or sidebar.",
      );
      toast.error("Schwab session ended", {
        description: "Reconnect Schwab to restore live quotes and portfolio.",
      });
      clearTokens();
      return false;
    } catch {
      return false;
    } finally {
      isRefreshing.current = false;
    }
  }, [refreshToken, setTokens, clearTokens]);

  const refreshTrader = useCallback(async (): Promise<boolean> => {
    if (!traderRefreshToken || isRefreshingTrader.current) return false;
    isRefreshingTrader.current = true;
    try {
      const res = await fetchWithAuth("/api/auth/trader-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: traderRefreshToken }),
      });
      if (!res.ok) {
        const detail = await readSchwabRefreshErrorDetail(res);
        signalSchwabAuthLost(
          "Schwab login could not be renewed automatically.",
          detail ??
            "Your saved Schwab session is no longer valid. Use Reconnect Schwab — you should not need to sign out of your account.",
        );
        toast.error("Schwab session ended", {
          description: "Reconnect Schwab to restore live quotes and portfolio.",
        });
        clearTraderTokens();
        return false;
      }
      const data = await res.json() as { accessToken?: string; refreshToken?: string };
      if (data.accessToken) {
        setTraderTokens(data.accessToken, data.refreshToken ?? traderRefreshToken);
        return true;
      }
      signalSchwabAuthLost(
        "Schwab login could not be renewed automatically.",
        "The server returned an empty token. Reconnect Schwab from the banner or sidebar.",
      );
      toast.error("Schwab session ended", {
        description: "Reconnect Schwab to restore live quotes and portfolio.",
      });
      clearTraderTokens();
      return false;
    } catch {
      return false;
    } finally {
      isRefreshingTrader.current = false;
    }
  }, [traderRefreshToken, setTraderTokens, clearTraderTokens]);

  useEffect(() => {
    if (didInitialRefresh.current) return;
    if (!refreshToken && !traderRefreshToken) return;
    didInitialRefresh.current = true;

    const doInitial = async () => {
      if (refreshToken) await refresh();
      if (traderRefreshToken) await refreshTrader();
    };
    void doInitial();
  }, [refreshToken, traderRefreshToken, refresh, refreshTrader]);

  useEffect(() => {
    if (!refreshToken) return;
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshToken, refresh]);

  useEffect(() => {
    if (!traderRefreshToken) return;
    const id = setInterval(refreshTrader, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [traderRefreshToken, refreshTrader]);

  // When returning from a backgrounded mobile tab, timers may have been throttled —
  // opportunistically refresh so Schwab tokens do not sit stale until the next interval.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      void refresh();
      void refreshTrader();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [refresh, refreshTrader]);

  return { refresh, refreshTrader };
}
