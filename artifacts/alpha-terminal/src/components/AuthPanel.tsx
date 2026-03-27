import { useState, useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl, useExchangeCode } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, KeyRound, ExternalLink, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
}

export function AuthPanel() {
  const { accessToken, setTokens, clearTokens } = useTerminalStore();
  const [redirectUrl, setRedirectUrl] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [registeredRedirectUri, setRegisteredRedirectUri] = useState("https://127.0.0.1/");
  const [isNativeCallback, setIsNativeCallback] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flowIdRef = useRef<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const { data: authUrlData, isLoading: authLoading } = useGetAuthUrl();
  const exchangeMutation = useExchangeCode({
    request: {
      headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
    },
  });

  useEffect(() => {
    fetch("/api/auth/redirect-uri")
      .then(r => {
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("non-json");
        return r.json();
      })
      .then(data => {
        if (data.redirectUri) {
          setRegisteredRedirectUri(data.redirectUri);
          setIsNativeCallback(data.redirectUri.includes("/api/auth/callback"));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("schwab");
    const flowId = params.get("flowId") || params.get("session");

    if (status === "connected" && flowId) {
      setConnecting(true);
      fetch(`/api/auth/flow-tokens/${flowId}`, {
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
      })
        .then(r => {
          if (!r.ok) throw new Error("Session expired");
          return r.json();
        })
        .then(data => {
          if (data.accessToken && data.refreshToken) {
            setTokens(data.accessToken, data.refreshToken);
            setIsOpen(false);
          }
        })
        .catch(() => setErrorMsg("Session expired. Please try connecting again."))
        .finally(() => setConnecting(false));

      window.history.replaceState({}, "", window.location.pathname);
    } else if (status === "error") {
      const msg = params.get("message");
      if (msg) setErrorMsg(msg);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [setTokens]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    flowIdRef.current = null;
    setConnecting(false);
  }, []);

  const consumeFlow = useCallback(async (flowId: string) => {
    try {
      const resp = await fetch(`/api/auth/flow-tokens/${flowId}`, {
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.accessToken && data.refreshToken) {
        setTokens(data.accessToken, data.refreshToken);
        setIsOpen(false);
      }
    } catch {
    } finally {
      stopPolling();
    }
  }, [setTokens, stopPolling]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "schwab-oauth-success" && e.data.flowId) {
        consumeFlow(e.data.flowId);
      } else if (e.data?.type === "schwab-oauth-error") {
        setErrorMsg(e.data.message || "Authentication failed.");
        stopPolling();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [consumeFlow, stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleConnect = async () => {
    if (!authUrlData?.configured) return;
    setErrorMsg("");
    setConnecting(true);

    try {
      const initResp = await fetch("/api/auth/init-flow", { method: "POST" });
      const initData = await initResp.json();
      if (!initData.flowId) {
        setErrorMsg("Could not initialize auth flow.");
        setConnecting(false);
        return;
      }
      const flowId = initData.flowId as string;
      flowIdRef.current = flowId;

      const urlResp = await fetch(`/api/auth/url?state=${flowId}`);
      const urlData = await urlResp.json();
      if (!urlData.url) {
        setErrorMsg("Could not generate auth URL.");
        setConnecting(false);
        return;
      }

      if (isMobile()) {
        window.location.href = urlData.url;
        return;
      }

      const w = 600;
      const h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      popupRef.current = window.open(
        urlData.url,
        "schwab_login",
        `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,status=no`
      );

      if (!popupRef.current || popupRef.current.closed) {
        window.location.href = urlData.url;
        return;
      }

      let pollCount = 0;
      pollRef.current = setInterval(async () => {
        pollCount++;

        if (popupRef.current?.closed && pollCount > 3) {
          stopPolling();
          return;
        }

        if (pollCount > 90) {
          setErrorMsg("Authorization timed out. Please try again.");
          stopPolling();
          return;
        }

        try {
          const r = await fetch(`/api/auth/flow-status?flowId=${flowId}`, {
            headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
          });
          const result = await r.json();
          if (result.connected) {
            await consumeFlow(flowId);
          }
        } catch {
        }
      }, 2000);
    } catch {
      setErrorMsg("Network error. Check your connection and try again.");
      setConnecting(false);
    }
  };

  const handleManualExchange = () => {
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
          ) : isNativeCallback ? (
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground font-mono leading-relaxed bg-card p-2 rounded border border-card-border">
                Click below to securely log in with your Schwab account. {isMobile() ? "You'll be redirected back after authorizing." : "A popup will open — once you authorize, the connection happens automatically."}
              </p>
              {errorMsg && (
                <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="font-mono text-[10px] leading-relaxed">{errorMsg}</p>
                </div>
              )}
              <Button
                onClick={handleConnect}
                disabled={authLoading || !authUrlData?.configured || connecting}
                className="w-full font-mono bg-primary/10 text-primary border border-primary/50 hover:bg-primary/20 text-xs gap-2"
              >
                {connecting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> WAITING FOR AUTHORIZATION...</>
                ) : authLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> LOADING...</>
                ) : !authUrlData?.configured ? (
                  "SCHWAB NOT CONFIGURED"
                ) : (
                  <>CONNECT TO SCHWAB <ExternalLink className="w-3.5 h-3.5" /></>
                )}
              </Button>
              {connecting && !isMobile() && (
                <p className="text-[10px] text-muted-foreground font-mono text-center">
                  Complete login in the popup window...
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Step 1 — Authorize with Schwab</p>
                <Button
                  asChild
                  className="w-full bg-primary/10 text-primary border border-primary/50 hover:bg-primary/20 font-mono text-xs"
                >
                  <a href={authUrlData?.url || "#"} target="_blank" rel="noreferrer">
                    OPEN SCHWAB LOGIN <ExternalLink className="ml-2 w-3.5 h-3.5" />
                  </a>
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                  Step 2 — Paste the full redirect URL
                </p>
                <p className="text-[10px] text-muted-foreground font-mono leading-relaxed bg-card p-2 rounded border border-card-border">
                  After login, your browser redirects to a page starting with <span className="text-primary">{registeredRedirectUri}</span> — copy that full URL from your browser's address bar and paste it below.
                </p>
                <Input
                  placeholder={`${registeredRedirectUri}?code=...`}
                  className="font-mono text-[10px] bg-background border-card-border focus-visible:ring-primary/50 h-9"
                  value={redirectUrl}
                  onChange={(e) => { setRedirectUrl(e.target.value); setErrorMsg(""); }}
                />
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="font-mono text-[10px] leading-relaxed">{errorMsg}</p>
                </div>
              )}

              <Button
                onClick={handleManualExchange}
                disabled={!redirectUrl.trim() || exchangeMutation.isPending}
                className="w-full font-mono bg-foreground text-background hover:bg-foreground/90 text-xs"
              >
                {exchangeMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> EXCHANGING...</>
                ) : (
                  "CONNECT TO SCHWAB"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
