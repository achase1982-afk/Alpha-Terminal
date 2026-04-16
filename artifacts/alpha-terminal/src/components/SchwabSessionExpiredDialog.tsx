import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { useTerminalStore } from "@/lib/store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useGetAuthUrl } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function SchwabSessionExpiredDialog() {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const traderAccessToken = useTerminalStore((s) => s.traderAccessToken);
  const portfolioStatus = usePortfolioStreamStore((s) => s.portfolioStatus);

  const hadTokenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  const isConnected = !!(accessToken || traderAccessToken);
  const serverTokenExpired = portfolioStatus.status === "no_token";

  const { data: authUrlData, refetch: refetchAuthUrl, isFetching: isUrlFetching } = useGetAuthUrl({
    query: { enabled: isConnected && serverTokenExpired },
  });

  // Track that we previously had a connected session so we only popup on
  // a real expiry transition (not on first load when nothing is connected).
  useEffect(() => {
    if (isConnected && !serverTokenExpired) hadTokenRef.current = true;
  }, [isConnected, serverTokenExpired]);

  // Compute a unique key for this expiry incident so dismiss only suppresses
  // *this* event — a future expiry will pop again.
  const incidentKey = serverTokenExpired
    ? `${accessToken ?? "_"}:${traderAccessToken ?? "_"}`
    : null;

  useEffect(() => {
    if (
      hadTokenRef.current &&
      isConnected &&
      serverTokenExpired &&
      dismissedFor !== incidentKey
    ) {
      setOpen(true);
    } else if (!serverTokenExpired) {
      // Reset dismissal once the session is good again.
      setOpen(false);
      if (dismissedFor !== null) setDismissedFor(null);
    }
  }, [isConnected, serverTokenExpired, incidentKey, dismissedFor]);

  const handleReconnect = async () => {
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
    window.location.href = url;
  };

  const handleDismiss = () => {
    if (incidentKey) setDismissedFor(incidentKey);
    setOpen(false);
  };

  const isLoading = isUrlFetching || isNavigating;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDismiss(); }}>
      <DialogContent
        className="sm:max-w-md border-[#FFB800]/30"
        style={{ background: "#0d0d0f" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-[#FFB800] tracking-wider">
            <AlertTriangle className="w-5 h-5" />
            SCHWAB SESSION EXPIRED
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-zinc-400 leading-relaxed pt-2">
            Your Schwab access token has expired. Live market data, portfolio
            updates, and order execution are paused until you reconnect.
            <br /><br />
            Reconnect now to resume real-time data without losing your work.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            onClick={handleDismiss}
            disabled={isLoading}
            className="px-4 py-2 rounded font-mono text-xs tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            DISMISS
          </button>
          <button
            onClick={handleReconnect}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded border border-[#FFB800]/40 hover:border-[#FFB800]/70 bg-[#FFB800]/10 hover:bg-[#FFB800]/15 transition-all font-mono text-xs text-[#FFB800] tracking-wider disabled:opacity-50"
          >
            {isLoading ? (
              <><Loader2 className="w-3 h-3 animate-spin" />REDIRECTING…</>
            ) : (
              <>RECONNECT SCHWAB <ExternalLink className="w-3 h-3" /></>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
