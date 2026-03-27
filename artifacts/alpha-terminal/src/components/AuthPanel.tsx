import { useState, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl, useExchangeCode } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, KeyRound, ExternalLink, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

export function AuthPanel() {
  const { accessToken, setTokens, clearTokens } = useTerminalStore();
  const [redirectUrl, setRedirectUrl] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [registeredRedirectUri, setRegisteredRedirectUri] = useState("https://127.0.0.1/");

  const { data: authUrlData } = useGetAuthUrl();
  const exchangeMutation = useExchangeCode();

  // Fetch the exact redirect URI registered with Schwab from the backend
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
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 p-2.5">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-primary font-bold text-[10px]">1</span>
                </div>
                <p className="text-[10px] text-gray-300 leading-snug">
                  Tap below to open Schwab login. Sign in with your Schwab credentials.
                </p>
              </div>
              <Button
                asChild
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs h-10"
              >
                <a href={authUrlData?.url || "#"} target="_blank" rel="noreferrer">
                  OPEN SCHWAB LOGIN <ExternalLink className="ml-2 w-3.5 h-3.5" />
                </a>
              </Button>

              <div className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5">
                <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-amber-400 font-bold text-[10px]">2</span>
                </div>
                <div className="text-[10px] text-gray-300 leading-snug space-y-1">
                  <p>After login, you'll see a <span className="text-amber-400 font-semibold">blank page</span> or an error — <span className="text-amber-400 font-semibold">this is normal!</span></p>
                  <p>Look at your <span className="text-white font-semibold">browser address bar</span> — it will show a URL like:</p>
                  <p className="text-primary break-all bg-black/30 rounded px-1.5 py-1 border border-card-border">
                    {registeredRedirectUri}?code=abc123...
                  </p>
                  <p><span className="text-white font-semibold">Copy that entire URL</span> and paste it below.</p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 p-2.5">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-primary font-bold text-[10px]">3</span>
                </div>
                <p className="text-[10px] text-gray-300 leading-snug">
                  Paste the redirect URL here and tap Connect.
                </p>
              </div>
              <Input
                placeholder="Paste the full redirect URL here..."
                className="font-mono text-[10px] bg-background border-card-border focus-visible:ring-primary/50 h-10"
                value={redirectUrl}
                onChange={(e) => { setRedirectUrl(e.target.value); setErrorMsg(""); }}
              />

              {errorMsg && (
                <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="font-mono text-[10px] leading-relaxed">{errorMsg}</p>
                </div>
              )}

              <Button
                onClick={handleExchange}
                disabled={!redirectUrl.trim() || exchangeMutation.isPending}
                className="w-full font-mono bg-foreground text-background hover:bg-foreground/90 text-xs h-10"
              >
                {exchangeMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> CONNECTING...</>
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
