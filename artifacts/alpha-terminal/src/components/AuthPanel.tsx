import { useState, useCallback, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ChevronRight, KeyRound, ExternalLink, CheckCircle2, Loader2, Radio } from "lucide-react";

export function AuthPanel() {
  const { accessToken, clearTokens } = useTerminalStore();
  const { traderAccessToken, setTraderTokens, clearTraderTokens } = useTerminalStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isTraderNavigating, setIsTraderNavigating] = useState(false);

  const needsAuth = !accessToken && isOpen;

  const { data: authUrlData, refetch: refetchAuthUrl, isFetching: isUrlFetching } = useGetAuthUrl({
    query: { enabled: needsAuth },
  });

  const authUrl = authUrlData?.url || "";

  const handleLoginClick = useCallback(async () => {
    setIsNavigating(true);
    let url = authUrl;
    if (!url) {
      const result = await refetchAuthUrl();
      url = result.data?.url || "";
    }
    if (!url) {
      setIsNavigating(false);
      return;
    }
    window.location.href = url;
  }, [authUrl, refetchAuthUrl]);

  const handleTraderLoginClick = useCallback(async () => {
    setIsTraderNavigating(true);
    try {
      const res = await fetch("/api/auth/trader-url");
      const data = await res.json() as { url?: string; configured?: boolean };
      if (!data.url) {
        setIsTraderNavigating(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setIsTraderNavigating(false);
    }
  }, []);

  useEffect(() => {
    if (traderAccessToken) {
      setIsTraderNavigating(false);
    }
  }, [traderAccessToken]);

  const isLoading = isUrlFetching || isNavigating;
  const bothConnected = !!accessToken && !!traderAccessToken;

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 text-sm font-mono font-bold hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <span className="text-foreground">SCHWAB AUTH</span>
        </div>
        <div className="flex items-center gap-3">
          {bothConnected ? (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              CONNECTED
            </span>
          ) : accessToken ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
              PARTIAL
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
              DISCONNECTED
            </span>
          )}
          <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${isOpen ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] space-y-3 animate-in fade-in slide-in-from-top-2">
          {bothConnected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 p-2.5 rounded-md border border-primary/20">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono text-[10px]">Market Data — quotes & charts active</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 p-2.5 rounded-md border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono text-[10px]">Streaming — WebSocket live data enabled</span>
              </div>
            </div>
          ) : accessToken && !traderAccessToken ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 p-2.5 rounded-md border border-primary/20">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono text-[10px]">Market Data — quotes & charts active</span>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 p-2">
                <Radio className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-gray-300 leading-snug">
                  Streaming not connected. Click below to enable live WebSocket data.
                </p>
              </div>
              <Button
                onClick={handleTraderLoginClick}
                disabled={isTraderNavigating}
                variant="outline"
                className="w-full font-mono text-xs h-9 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              >
                {isTraderNavigating ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />REDIRECTING...</>
                ) : (
                  <>CONNECT STREAMING <ExternalLink className="ml-2 w-3.5 h-3.5" /></>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[9px] text-gray-400 font-mono leading-snug">
                Sign in once to connect both Market Data and Live Streaming automatically.
              </p>
              <Button
                onClick={handleLoginClick}
                disabled={isLoading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-9"
              >
                {isLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />REDIRECTING...</>
                ) : (
                  <>SIGN IN TO SCHWAB <ExternalLink className="ml-2 w-3.5 h-3.5" /></>
                )}
              </Button>
            </div>
          )}

          {accessToken && (
            <Button
              variant="outline"
              size="sm"
              className="w-full font-mono border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive text-xs"
              onClick={() => { clearTokens(); clearTraderTokens(); }}
            >
              DISCONNECT ALL
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
