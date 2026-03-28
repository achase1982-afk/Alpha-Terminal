import { useState, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ChevronRight, KeyRound, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";

export function AuthPanel() {
  const { accessToken, clearTokens } = useTerminalStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

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

  const isLoading = isUrlFetching || isNavigating;

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
          {accessToken ? (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              CONNECTED
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
        <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] space-y-4 animate-in fade-in slide-in-from-top-2">
          {accessToken ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 p-3 rounded-md border border-primary/20">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="font-mono text-xs">Connected. Token will auto-refresh.</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-mono border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={clearTokens}
              >
                DISCONNECT SESSION
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-2.5">
                <KeyRound className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-[10px] text-gray-300 leading-snug">
                  Sign in with your Schwab brokerage account. You'll be redirected to Schwab and then brought right back here.
                </p>
              </div>
              <Button
                onClick={handleLoginClick}
                disabled={isLoading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-10"
              >
                {isLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />REDIRECTING...</>
                ) : (
                  <>SIGN IN WITH SCHWAB <ExternalLink className="ml-2 w-3.5 h-3.5" /></>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
