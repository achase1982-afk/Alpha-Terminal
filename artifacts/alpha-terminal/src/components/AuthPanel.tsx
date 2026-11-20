import { useState, useCallback, type MouseEvent } from "react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { queryClient } from "@/App";
import { ExternalLink, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useBrokerConnect } from "@/hooks/useBrokerConnect";
import { useWebullConnect } from "@/hooks/useWebullConnect";
import { useShallow } from "zustand/react/shallow";

export function AuthPanel() {
  const { accessToken, traderAccessToken, clearTokens, clearTraderTokens } = useTerminalStore(useShallow((s) => ({ accessToken: s.accessToken, traderAccessToken: s.traderAccessToken, clearTokens: s.clearTokens, clearTraderTokens: s.clearTraderTokens })));
  const portfolioStatus = usePortfolioStreamStore((s) => s.portfolioStatus);
  const removeBrokerAccounts = useSchwabAccountStore((s) => s.removeBrokerAccounts);
  const [isSchwabDisconnecting, setIsSchwabDisconnecting] = useState(false);
  const { oauthUrl, isNavigating, onClick } = useBrokerConnect();
  const {
    connect: connectWebull,
    disconnect: disconnectWebull,
    isConnecting: webullConnecting,
    isDisconnecting: webullDisconnecting,
    isConnected: webullConnected,
  } = useWebullConnect();

  const schwabConnected = !!(accessToken || traderAccessToken);
  const serverTokenExpired = portfolioStatus.status === "no_token";

  const handleSchwabDisconnect = useCallback(async () => {
    if (isSchwabDisconnecting) return;
    setIsSchwabDisconnecting(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      // Clear the canonical server/DB token first. Clearing local state first
      // starts PendingSessionLoader, which can immediately restore the token
      // and make Disconnect appear inert.
      const res = await fetchWithAuth("/api/auth/disconnect", {
        method: "POST",
        signal: controller.signal,
        clerkTokenTimeoutMs: 3_000,
      });
      if (!res.ok) return;
      clearTokens();
      clearTraderTokens();
      removeBrokerAccounts("schwab");
      queryClient.clear();
    } catch {
      /* Keep the connected state when the server could not be reached. */
    } finally {
      window.clearTimeout(timer);
      setIsSchwabDisconnecting(false);
    }
  }, [
    clearTokens,
    clearTraderTokens,
    isSchwabDisconnecting,
    removeBrokerAccounts,
  ]);

  const isLoading = isNavigating;
  const loginDisabled = !oauthUrl || isLoading;
  const handleLoginClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (loginDisabled) {
      event.preventDefault();
      return;
    }
    onClick();
  };

  const webullControl = webullConnected ? (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d166] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d166]" />
        </span>
        <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">WEBULL</span>
        <span className="font-mono text-[10px] text-[#00d166] tracking-wider">CONNECTED</span>
      </div>
      <button
        type="button"
        onClick={() => void disconnectWebull()}
        disabled={webullDisconnecting}
        className="font-mono text-[10px] text-zinc-500 hover:text-red-400 transition-colors tracking-wider disabled:opacity-50"
      >
        {webullDisconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : "DISCONNECT"}
      </button>
    </div>
  ) : (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        {webullConnecting ? (
          <AlertTriangle className="w-3.5 h-3.5 text-[#FFB800]" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-500" />
        )}
        <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">WEBULL</span>
        <span
          className={`font-mono text-[10px] tracking-wider ${
            webullConnecting ? "text-[#FFB800]" : "text-red-500"
          }`}
        >
          {webullConnecting ? "AWAITING VERIFICATION" : "DISCONNECTED"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void connectWebull()}
        disabled={webullConnecting}
        className="flex items-center justify-center gap-2 w-full py-2 rounded border border-zinc-700 hover:border-[#FFB800]/50 hover:bg-[#FFB800]/5 transition-all font-mono text-xs text-zinc-300 hover:text-[#FFB800] tracking-wider disabled:opacity-50"
      >
        {webullConnecting ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            CONNECTING WEBULL…
          </>
        ) : (
          "CONNECT WEBULL"
        )}
      </button>
      {webullConnecting && (
        <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
          Open Webull → Menu → Messages → OpenAPI Notifications, then verify.
        </p>
      )}
    </div>
  );

  if (schwabConnected && serverTokenExpired) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-[#FFB800]" />
            <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">SCHWAB</span>
            <span className="font-mono text-[10px] text-[#FFB800] tracking-wider">SESSION EXPIRED</span>
          </div>
          <button
            type="button"
            onClick={handleSchwabDisconnect}
            disabled={isSchwabDisconnecting}
            className="font-mono text-[10px] text-zinc-500 hover:text-red-400 transition-colors tracking-wider disabled:opacity-50"
          >
            {isSchwabDisconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : "DISCONNECT"}
          </button>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
          Your Schwab session has expired. Reconnect to resume portfolio updates and order execution.
        </p>
        <a
          href={oauthUrl ?? "#"}
          target="_blank"
          onClick={handleLoginClick}
          aria-disabled={loginDisabled}
          role="button"
          className="flex items-center justify-center gap-2 w-full py-2 rounded border border-[#FFB800]/30 hover:border-[#FFB800]/60 bg-[#FFB800]/5 hover:bg-[#FFB800]/10 transition-all font-mono text-xs text-[#FFB800] tracking-wider disabled:opacity-50"
          style={{ opacity: loginDisabled && !isLoading ? 0.5 : 1, pointerEvents: loginDisabled ? "none" : "auto", textDecoration: "none" }}
        >
          {isLoading ? (
            <><Loader2 className="w-3 h-3 animate-spin" />REDIRECTING...</>
          ) : (
            <>RECONNECT SCHWAB <ExternalLink className="w-3 h-3" /></>
          )}
        </a>
        <div className="pt-3 border-t border-zinc-800/70">{webullControl}</div>
      </div>
    );
  }

  if (schwabConnected) {
    return (
      <div className="space-y-3">
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
            type="button"
            onClick={handleSchwabDisconnect}
            disabled={isSchwabDisconnecting}
            className="font-mono text-[10px] text-zinc-500 hover:text-red-400 transition-colors tracking-wider disabled:opacity-50"
          >
            {isSchwabDisconnecting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              "DISCONNECT"
            )}
          </button>
        </div>
        <div className="pt-3 border-t border-zinc-800/70">{webullControl}</div>
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
      <a
        href={oauthUrl ?? "#"}
        target="_blank"
        onClick={handleLoginClick}
        aria-disabled={loginDisabled}
        role="button"
        className="flex items-center justify-center gap-2 w-full py-2 rounded border border-zinc-700 hover:border-[#FFB800]/50 hover:bg-[#FFB800]/5 transition-all font-mono text-xs text-zinc-300 hover:text-[#FFB800] tracking-wider disabled:opacity-50"
        style={{ opacity: loginDisabled && !isLoading ? 0.5 : 1, pointerEvents: loginDisabled ? "none" : "auto", textDecoration: "none" }}
      >
        {isLoading ? (
          <><Loader2 className="w-3 h-3 animate-spin" />REDIRECTING...</>
        ) : (
          <>CONNECT SCHWAB <ExternalLink className="w-3 h-3" /></>
        )}
      </a>
      <div className="pt-3 border-t border-zinc-800/70">{webullControl}</div>
    </div>
  );
}
