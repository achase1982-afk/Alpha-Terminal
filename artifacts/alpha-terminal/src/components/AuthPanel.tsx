import { useState } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetAuthUrl, useExchangeCode } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, KeyRound, ExternalLink, RefreshCw, CheckCircle2 } from "lucide-react";

export function AuthPanel() {
  const { accessToken, setTokens, clearTokens } = useTerminalStore();
  const [redirectUrl, setRedirectUrl] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const { data: authUrlData, isLoading: isLoadingUrl } = useGetAuthUrl();
  const exchangeMutation = useExchangeCode();

  const handleExchange = () => {
    if (!redirectUrl) return;
    try {
      const url = new URL(redirectUrl);
      const code = url.searchParams.get("code");
      if (!code) {
        alert("Could not find 'code' parameter in the URL.");
        return;
      }
      
      exchangeMutation.mutate(
        { data: { code, redirectUri: "https://127.0.0.1" } },
        {
          onSuccess: (data) => {
            setTokens(data.accessToken, data.refreshToken);
            setRedirectUrl("");
            setIsOpen(false);
          },
          onError: (err) => {
            alert(`Authentication failed: ${err.message}`);
          }
        }
      );
    } catch (e) {
      alert("Invalid URL format.");
    }
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
            <span className="flex items-center gap-1.5 text-xs text-primary glow-text">
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
        <div className="p-4 border-t border-card-border bg-[#0D1117] space-y-4">
          {accessToken ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 p-3 rounded-md border border-primary/20">
                <CheckCircle2 className="w-4 h-4" />
                <span>API Keys securely stored. Ready for trading.</span>
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
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-mono">STEP 1: LOGIN TO SCHWAB</p>
                <Button 
                  asChild
                  className="w-full bg-primary/10 text-primary border border-primary/50 hover:bg-primary/20 font-mono shadow-[0_0_15px_rgba(0,212,170,0.15)] transition-all hover:shadow-[0_0_20px_rgba(0,212,170,0.3)]"
                >
                  <a href={authUrlData?.url || "#"} target="_blank" rel="noreferrer">
                    AUTHORIZE APP <ExternalLink className="ml-2 w-4 h-4" />
                  </a>
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-mono">STEP 2: PASTE REDIRECT URL</p>
                <Input
                  placeholder="https://127.0.0.1/?code=..."
                  className="font-mono text-xs bg-background border-card-border focus-visible:ring-primary/50 focus-visible:border-primary"
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                />
              </div>

              <Button 
                onClick={handleExchange}
                disabled={!redirectUrl || exchangeMutation.isPending}
                className="w-full font-mono bg-foreground text-background hover:bg-foreground/90"
              >
                {exchangeMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                EXCHANGE TOKEN
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
