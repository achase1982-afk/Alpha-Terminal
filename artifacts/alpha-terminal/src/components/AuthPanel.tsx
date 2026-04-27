import { useState, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { queryClient } from "@/App";
import { ExternalLink, CheckCircle2, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useGetAuthUrl } from "@workspace/api-client-react";

export function AuthPanel() {
  const { accessToken, traderAccessToken, clearTokens, clearTraderTokens } = useTerminalStore();
  const portfolioStatus = usePortfolioStreamStore((s) => s.portfolioStatus);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = !!(accessToken || traderAccessToken);
  const serverTokenExpired = portfolioStatus.status === "no_token";

  const { data: authUrlData, refetch: refetchAuthUrl } = useGetAuthUrl({
    query: { enabled: isConnected && serverTokenExpired },
  });

  const handleLogin = useCallback(async () => {
    setIsNavigating(true);
    let url = authUrlData?.url || "";
    if (!url) {
      const result = await refetchAuthUrl();
      url = result.data?.url || "";
    }
    if (!url) {
      setIsNavigating(false);
      return;
    }
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) window.location.href = url;
  }, [authUrlData, refetchAuthUrl]);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    clearTokens();
    clearTraderTokens();
    queryClient.clear();
    try { await fetchWithAuth("/api/auth/disconnect", { method: "POST" }); } catch {}
    setIsDisconnecting(false);
  }, [clearTokens, clearTraderTokens]);

  const isLoading = isNavigating;

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
