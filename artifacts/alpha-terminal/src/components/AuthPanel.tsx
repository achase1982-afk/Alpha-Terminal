import { useState, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { queryClient } from "@/App";
import { ExternalLink, CheckCircle2, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";

export function AuthPanel() {
  const { accessToken, traderAccessToken, clearTokens, clearTraderTokens, setTokens, setTraderTokens } = useTerminalStore();
  const portfolioStatus = usePortfolioStreamStore((s) => s.portfolioStatus);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = !!(accessToken || traderAccessToken);
  const serverTokenExpired = portfolioStatus.status === "no_token";

  const { data: authUrlData, refetch: refetchAuthUrl, isFetching: isUrlFetching } = useGetAuthUrl({
    query: { enabled: !isConnected || serverTokenExpired },
  });

  // Pull server-side tokens written by the OAuth callback into the in-memory
  // store. Used after the popup closes so the UI flips to CONNECTED without
  // waiting for the visibilitychange poll in PendingSessionLoader.
  const rehydrateFromServer = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auth/server-tokens");
      if (!res.ok) return false;
      const data = await res.json() as {
        market?: { accessToken: string; refreshToken: string } | null;
        trader?: { accessToken: string; refreshToken: string } | null;
      };
      const tok = data.trader ?? data.market;
      if (tok?.accessToken) {
        setTokens(tok.accessToken, tok.refreshToken || "");
        setTraderTokens(tok.accessToken, tok.refreshToken || "");
        return true;
      }
    } catch {}
    return false;
  }, [setTokens, setTraderTokens]);

  const handleLogin = useCallback(async () => {
    setIsNavigating(true);
    let url = authUrlData?.url || "";
    if (!url) {
      const result = await refetchAuthUrl();
      url = result.data?.url || "";
    }
    if (!url) { setIsNavigating(false); return; }

    // Open Schwab OAuth in a popup so the original tab — and its in-memory
    // Clerk session — stays mounted across the cross-domain bounce. This
    // sidesteps a Clerk dev-mode session re-check on iOS Safari that
    // intermittently remounts the sign-in widget when the SPA cold-boots
    // after a same-tab redirect. The /trader-callback success page already
    // calls window.close() on completion, so the popup self-disposes.
    // Mark this attempt as a popup-mode attempt. The server reads this cookie
    // on the OAuth callback to decide between window.close() (popup) and a
    // bare 302 → "/" (same-tab, e.g. iOS PWA where popups are blocked).
    document.cookie = "schwab_oauth_mode=popup; Path=/api/auth; Max-Age=600; SameSite=Lax";

    const popup = window.open(
      url,
      "schwab-oauth",
      "width=600,height=800,menubar=no,toolbar=no,location=yes,status=no",
    );

    // Popup blocked (rare from a direct user click, but possible) — fall
    // back to the original same-tab redirect so we never regress. Clear the
    // popup-mode cookie so the server returns a 302 (no HTML flash) instead
    // of trying to close the now-non-existent popup window.
    if (!popup) {
      document.cookie = "schwab_oauth_mode=; Path=/api/auth; Max-Age=0; SameSite=Lax";
      window.location.href = url;
      return;
    }

    // Poll for popup closure. When it closes, immediately try to pull the
    // tokens the callback persisted server-side. PendingSessionLoader's
    // visibilitychange listener provides a second chance if this misses
    // (e.g., callback still in-flight when the window closed).
    const pollMs = 500;
    const maxWaitMs = 5 * 60 * 1000; // give up after 5 min
    const startedAt = Date.now();
    const interval = window.setInterval(async () => {
      if (popup.closed) {
        window.clearInterval(interval);
        await rehydrateFromServer();
        setIsNavigating(false);
      } else if (Date.now() - startedAt > maxWaitMs) {
        window.clearInterval(interval);
        setIsNavigating(false);
      }
    }, pollMs);
  }, [authUrlData, refetchAuthUrl, rehydrateFromServer]);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    clearTokens();
    clearTraderTokens();
    queryClient.clear();
    try { await fetchWithAuth("/api/auth/disconnect", { method: "POST" }); } catch {}
    setIsDisconnecting(false);
  }, [clearTokens, clearTraderTokens]);

  const isLoading = isUrlFetching || isNavigating;

  if (isConnected && serverTokenExpired) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-[#FFB800]" />
            <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">SCHWAB</span>
            <span className="font-mono text-[10px] text-[#FFB800] tracking-wider">SESSION EXPIRED</span>
          </div>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
          Your Schwab session has expired. Reconnect to resume portfolio updates and order execution.
        </p>
        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="flex items-center justify-center gap-2 w-full py-2 rounded border border-[#FFB800]/30 hover:border-[#FFB800]/60 bg-[#FFB800]/5 hover:bg-[#FFB800]/10 transition-all font-mono text-xs text-[#FFB800] tracking-wider disabled:opacity-50"
        >
          {isLoading ? (
            <><Loader2 className="w-3 h-3 animate-spin" />REDIRECTING...</>
          ) : (
            <>RECONNECT SCHWAB <ExternalLink className="w-3 h-3" /></>
          )}
        </button>
      </div>
    );
  }

  if (isConnected) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d166] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d166]" />
          </span>
          <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">SCHWAB</span>
          <span className="font-mono text-[10px] text-[#00d166] tracking-wider">CONNECTED</span>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          className="font-mono text-[10px] text-zinc-500 hover:text-red-400 transition-colors tracking-wider"
        >
          {isDisconnecting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            "DISCONNECT"
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <XCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">SCHWAB</span>
          <span className="font-mono text-[10px] text-red-500 tracking-wider">DISCONNECTED</span>
        </div>
      </div>
      <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
        Connect for put/call ratios, portfolio syncing, and order execution.
      </p>
      <button
        onClick={handleLogin}
        disabled={isLoading}
        className="flex items-center justify-center gap-2 w-full py-2 rounded border border-zinc-700 hover:border-[#FFB800]/50 hover:bg-[#FFB800]/5 transition-all font-mono text-xs text-zinc-300 hover:text-[#FFB800] tracking-wider disabled:opacity-50"
      >
        {isLoading ? (
          <><Loader2 className="w-3 h-3 animate-spin" />REDIRECTING...</>
        ) : (
          <>CONNECT SCHWAB <ExternalLink className="w-3 h-3" /></>
        )}
      </button>
    </div>
  );
}
