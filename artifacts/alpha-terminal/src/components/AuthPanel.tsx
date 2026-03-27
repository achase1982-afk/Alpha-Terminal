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
          const raw = err?.data ?? err?.rawBody ?? err?.message ?? "";
          const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw);
          const isUnreachable =
            rawStr.includes("<!DOCTYPE") ||
            rawStr.includes("<html") ||
            rawStr.includes("Run this app") ||
            rawStr.includes("ECONNREFUSED") ||
            rawStr.includes("Failed to fetch") ||
            rawStr.includes("NetworkError") ||
            rawStr.includes("fetch failed");
          if (isUnreachable) {
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
            <div className="space-y-4">
              {/* Step 1 */}
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

              {/* Step 2 */}
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

              {/* Error */}
              {errorMsg && (
                <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="font-mono text-[10px] leading-relaxed">{errorMsg}</p>
                </div>
              )}

              <Button
                onClick={handleExchange}
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
