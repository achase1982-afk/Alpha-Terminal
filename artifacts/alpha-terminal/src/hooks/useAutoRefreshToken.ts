import { useCallback, useEffect, useRef } from "react";
import { useTerminalStore } from "@/lib/store";

const REFRESH_INTERVAL_MS = 25 * 60 * 1000; // 25 minutes

export function useAutoRefreshToken() {
  const { refreshToken, setTokens, clearTokens } = useTerminalStore();
  const isRefreshing = useRef(false);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!refreshToken || isRefreshing.current) return false;
    isRefreshing.current = true;
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearTokens();
        return false;
      }
      const data = await res.json() as { accessToken?: string; refreshToken?: string };
      if (data.accessToken) {
        setTokens(data.accessToken, data.refreshToken ?? refreshToken);
        return true;
      }
      clearTokens();
      return false;
    } catch {
      return false;
    } finally {
      isRefreshing.current = false;
    }
  }, [refreshToken, setTokens, clearTokens]);

  // Auto-refresh on a 25-minute interval (access tokens last ~30 min)
  useEffect(() => {
    if (!refreshToken) return;
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshToken, refresh]);

  return { refresh };
}
