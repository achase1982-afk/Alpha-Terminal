import { useState, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { queryClient } from "@/App";
import { Button } from "@/components/ui/button";
import { ChevronRight, KeyRound, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";

export function AuthPanel() {
  const { accessToken, traderAccessToken, clearTokens, clearTraderTokens } = useTerminalStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = !!(accessToken || traderAccessToken);

  const { data: authUrlData, refetch: refetchAuthUrl, isFetching: isUrlFetching } = useGetAuthUrl({
    query: { enabled: isOpen && !isConnected },
  });

  const handleLogin = useCallback(async () => {
    setIsNavigating(true);
    let url = authUrlData?.url || "";
    if (!url) {
      const result = await refetchAuthUrl();
      url = result.data?.url || "";
    }
    if (!url) { setIsNavigating(false); return; }
    window.location.href = url;
  }, [authUrlData, refetchAuthUrl]);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    clearTokens();
    clearTraderTokens();
    queryClient.clear();
    try { await fetchWithAuth("/api/auth/disconnect", { method: "POST" }); } catch {}
    setIsDisconnecting(false);
  }, [clearTokens, clearTraderTokens]);

  const isLoading = isUrlFetching || isNavigating;

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 text-sm font-mono font-bold hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <span className="text-foreground">BROKER</span>
        </div>
        <div className="flex items-center gap-3">
          {isConnected ? (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              CONNECTED
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
              DISCONNECTED
            </span>
          )}
          <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`} />
        </div>
      </button>

      {isOpen && (
        <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] space-y-3 animate-in fade-in slide-in-from-top-2">
          {isConnected ? (
            <div className="flex items-center gap-2 text-sm text-primary p-2.5 rounded-md border border-primary/20">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono text-[10px]">Quotes, streaming & trading active</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[9px] text-gray-400 font-mono leading-snug">
                One login connects quotes, live streaming, portfolio and trading.
              </p>
              <Button
                onClick={handleLogin}
                disabled={isLoading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-9"
              >
                {isLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />REDIRECTING...</>
                ) : (
                  <>SIGN IN <ExternalLink className="ml-2 w-3.5 h-3.5" /></>
                )}
              </Button>
            </div>
          )}

          {isConnected && (
            <Button
              variant="outline"
              size="sm"
              className="w-full font-mono border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive text-xs"
              disabled={isDisconnecting}
              onClick={handleDisconnect}
            >
              {isDisconnecting ? (
                <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />DISCONNECTING...</>
              ) : (
                "DISCONNECT"
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
