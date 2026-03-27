import { useState, useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl, useExchangeCode } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, KeyRound, ExternalLink, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export function AuthPanel() {
  const { accessToken, setTokens, clearTokens } = useTerminalStore();
  const [redirectUrl, setRedirectUrl] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [waitingForCallback, setWaitingForCallback] = useState(false);
  const [registeredRedirectUri, setRegisteredRedirectUri] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: authUrlData } = useGetAuthUrl();
  const exchangeMutation = useExchangeCode();

  useEffect(() => {
    fetch("/api/auth/redirect-uri")
      .then(r => {
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("non-json");
        return r.json();
      })
      .then(data => {
        if (data.redirectUri) setRegisteredRedirectUri(data.redirectUri);
      })
      .catch(() => {});
  }, []);

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
    setTimeout(() => {
      if (pollRef.current) stopPolling();
    }, 5 * 60 * 1000);
  }, [setTokens, stopPolling]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (accessToken) stopPolling();
  }, [accessToken, stopPolling]);

  const handleSignIn = () => {
    startPolling();
  };

  const handleExchange = () => {
    if (!redirectUrl.trim()) return;
    setErrorMsg("");

    let code: string | null = null;
    try {
      const url = new URL(redirectUrl.trim());
      code = url.searchParams.get("code");
    } catch {
      setErrorMsg("Invalid URL. Paste the full redirect URL starting with https://");
      return;
    }

    if (!code) {
      setErrorMsg("No 'code' parameter found in the URL.");
      return;
    }

    exchangeMutation.mutate(
      { data: { code, redirectUri: registeredRedirectUri } },
      {
        onSuccess: (data) => {
          setTokens(data.accessToken, data.refreshToken);
          setRedirectUrl("");
          setIsOpen(false);
          setErrorMsg("");
          stopPolling();
        },
        onError: (err: any) => {
          const hasHttpStatus = typeof err?.status === "number" && err.status > 0;
          if (!hasHttpStatus) {
            setErrorMsg("API server is not reachable. Make sure the API Server workflow is running, then try again.");
          } else {
            const detail = err?.data?.message ?? err?.message ?? "Unknown error";
            setErrorMsg(`Auth failed: ${detail}. The code may have expired — generate a new one.`);
          }
        }
      }
    );
  };

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
                      <p>Complete the sign-in on the Schwab page that opened. Once you're done, this screen will update automatically.</p>
                      <p className="text-muted-foreground">If the Schwab tab closed or nothing happened, tap the button below to try again.</p>
                    </div>
                  </div>
                  <Button
                    asChild
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-10"
                  >
                    <a href={authUrlData?.url || "#"} target="_blank" rel="noreferrer" onClick={handleSignIn}>
                      RETRY SCHWAB LOGIN <ExternalLink className="ml-2 w-3.5 h-3.5" />
                    </a>
                  </Button>
                  <button
                    onClick={stopPolling}
                    className="text-[9px] text-muted-foreground/50 font-mono hover:text-muted-foreground transition-colors w-full text-center"
                  >
                    CANCEL
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-2.5">
                    <KeyRound className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px] text-gray-300 leading-snug">
                      Sign in with your Schwab brokerage account. A new page will open — after you complete login there, this screen will update automatically.
                    </p>
                  </div>
                  <Button
                    asChild
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-10"
                  >
                    <a href={authUrlData?.url || "#"} target="_blank" rel="noreferrer" onClick={handleSignIn}>
                      SIGN IN WITH SCHWAB <ExternalLink className="ml-2 w-3.5 h-3.5" />
                    </a>
                  </Button>
                </>
              )}

              <div className="border-t border-card-border pt-3">
                <button
                  onClick={() => setShowManual(!showManual)}
                  className="text-[9px] text-muted-foreground/50 font-mono hover:text-muted-foreground transition-colors w-full text-center"
                >
                  {showManual ? "▲ HIDE MANUAL ENTRY" : "▼ MANUAL CODE ENTRY (ADVANCED)"}
                </button>
              </div>

              {showManual && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <p className="text-[9px] text-muted-foreground font-mono leading-relaxed">
                    If auto-redirect didn't work, paste the full callback URL from your browser's address bar:
                  </p>
                  <Input
                    placeholder="Paste the full redirect URL here..."
                    className="font-mono text-[10px] bg-background border-card-border focus-visible:ring-primary/50 h-9"
                    value={redirectUrl}
                    onChange={(e) => { setRedirectUrl(e.target.value); setErrorMsg(""); }}
                  />
                  {errorMsg && (
                    <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-2.5 rounded-md border border-destructive/20">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <p className="font-mono text-[9px] leading-relaxed">{errorMsg}</p>
                    </div>
                  )}
                  <Button
                    onClick={handleExchange}
                    disabled={!redirectUrl.trim() || exchangeMutation.isPending}
                    className="w-full font-mono bg-foreground text-background hover:bg-foreground/90 text-[10px] h-8"
                    size="sm"
                  >
                    {exchangeMutation.isPending ? (
                      <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> CONNECTING...</>
                    ) : (
                      "CONNECT MANUALLY"
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
