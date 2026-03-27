import { useState, useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ChevronRight, KeyRound, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";

export function AuthPanel() {
  const { accessToken, setTokens, clearTokens } = useTerminalStore();
  const [isOpen, setIsOpen] = useState(false);
  const [waitingForCallback, setWaitingForCallback] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: authUrlData } = useGetAuthUrl();

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setWaitingForCallback(false);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setWaitingForCallback(true);

    const poll = async () => {
      try {
        const res = await fetch("/api/auth/pending-session");
        if (!res.ok) return;
        const data = await res.json();
        if (data.found && data.accessToken) {
          setTokens(data.accessToken, data.refreshToken || "");
          stopPolling();
          setIsOpen(false);
        }
      } catch {}
    };

    pollRef.current = setInterval(poll, 2000);
    setTimeout(() => { if (pollRef.current) stopPolling(); }, 5 * 60 * 1000);
  }, [setTokens, stopPolling]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  useEffect(() => { if (accessToken) stopPolling(); }, [accessToken, stopPolling]);

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
        <div className="p-3 sm:p-4 border-t border-card-border bg-[#0D1117] space-y-4 animate-in fade-in slide-in-from-top-2">
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
              {waitingForCallback ? (
                <>
                  <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                    <Loader2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-spin" />
                    <div className="text-[10px] text-gray-300 leading-snug space-y-1.5">
                      <p className="text-amber-400 font-semibold text-[11px]">Waiting for Schwab login...</p>
                      <p>Complete the sign-in on the Schwab page. Once done, this will update automatically.</p>
                    </div>
                  </div>
                  <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-10">
                    <a href={authUrlData?.url || "#"} target="_blank" rel="noreferrer" onClick={startPolling}>
                      RETRY SCHWAB LOGIN <ExternalLink className="ml-2 w-3.5 h-3.5" />
                    </a>
                  </Button>
                  <button onClick={stopPolling} className="text-[9px] text-muted-foreground/50 font-mono hover:text-muted-foreground transition-colors w-full text-center">
                    CANCEL
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-2.5">
                    <KeyRound className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px] text-gray-300 leading-snug">
                      Sign in with your Schwab brokerage account. A new page will open — after you sign in, this screen will update automatically.
                    </p>
                  </div>
                  <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-10">
                    <a href={authUrlData?.url || "#"} target="_blank" rel="noreferrer" onClick={startPolling}>
                      SIGN IN WITH SCHWAB <ExternalLink className="ml-2 w-3.5 h-3.5" />
                    </a>
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
