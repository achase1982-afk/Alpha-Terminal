import { useGetQuote } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function MetricsBar() {
  const { symbol, accessToken } = useTerminalStore();
  const { data: quote, isLoading, error } = useGetQuote(
    { symbol, accessToken: accessToken || '' },
    { query: { enabled: !!accessToken && !!symbol, refetchInterval: 10000 } }
  );

  if (!accessToken) {
    return (
      <div className="w-full bg-card border-b border-card-border flex items-center justify-center px-4 py-3 shrink-0">
        <p className="text-muted-foreground font-mono text-[10px] sm:text-sm animate-pulse text-center">
          CONNECT SCHWAB TO VIEW MARKET DATA
        </p>
      </div>
    );
  }

  // Token exists but is expired
  if (quote?.error === "unauthorized") {
    return (
      <div className="w-full bg-card border-b border-card-border flex items-center justify-center gap-2 px-4 py-3 shrink-0">
        <RefreshCw className="w-3.5 h-3.5 text-yellow-500/80 animate-spin" />
        <p className="text-yellow-500/80 font-mono text-[10px] sm:text-sm">
          SESSION EXPIRED — REFRESHING TOKEN...
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full bg-card border-b border-card-border flex items-center px-4 sm:px-6 gap-4 sm:gap-8 overflow-x-auto py-3 shrink-0">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex flex-col gap-1.5 shrink-0">
            <Skeleton className="h-2.5 w-12 sm:w-16 bg-card-border" />
            <Skeleton className="h-5 sm:h-6 w-20 sm:w-24 bg-card-border" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="w-full bg-card border-b border-card-border flex items-center px-4 sm:px-6 py-3 shrink-0">
        <p className="text-destructive font-mono text-[10px] sm:text-sm">ERROR FETCHING {symbol}</p>
      </div>
    );
  }

  const isUp = (quote.change || 0) >= 0;

  return (
    <div className="w-full bg-card border-b border-card-border flex items-center px-4 sm:px-6 gap-4 sm:gap-6 lg:gap-8 overflow-x-auto shrink-0 py-2 sm:py-0 sm:h-16 lg:h-20">

      {/* Symbol + Price — always visible */}
      <div className="flex flex-col shrink-0">
        <span className="text-[9px] sm:text-xs text-muted-foreground font-mono font-semibold">TICKER</span>
        <span className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground leading-tight">{quote.symbol}</span>
      </div>

      <div className="w-px h-8 bg-card-border shrink-0" />

      <div className="flex flex-col shrink-0">
        <span className="text-[9px] sm:text-xs text-muted-foreground font-mono font-semibold">LAST PRICE</span>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-lg sm:text-xl lg:text-2xl font-mono font-bold leading-tight">
            ${quote.last?.toFixed(2) ?? '—'}
          </span>
          <span className={`text-[10px] sm:text-sm font-mono flex items-center gap-0.5 ${isUp ? 'text-primary' : 'text-destructive'}`}>
            {isUp ? <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" /> : <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4" />}
            <span className="hidden sm:inline">{quote.change?.toFixed(2)} ({quote.changePct?.toFixed(2)}%)</span>
            <span className="sm:hidden">{quote.changePct?.toFixed(1)}%</span>
          </span>
        </div>
      </div>

      <div className="w-px h-8 bg-card-border shrink-0" />

      {/* BID/ASK */}
      <div className="flex flex-col shrink-0">
        <span className="text-[9px] sm:text-xs text-muted-foreground font-mono font-semibold">BID / ASK</span>
        <span className="text-sm sm:text-base lg:text-lg font-mono leading-tight">
          ${quote.bid?.toFixed(2) ?? '—'} / ${quote.ask?.toFixed(2) ?? '—'}
        </span>
      </div>

      <div className="w-px h-8 bg-card-border shrink-0 hidden sm:block" />

      {/* VOLUME */}
      <div className="flex flex-col shrink-0 hidden sm:flex">
        <span className="text-[9px] sm:text-xs text-muted-foreground font-mono font-semibold">VOLUME</span>
        <span className="text-sm sm:text-base lg:text-lg font-mono leading-tight">
          {(quote.volume || 0).toLocaleString()}
        </span>
      </div>

      <div className="w-px h-8 bg-card-border shrink-0 hidden md:block" />

      {/* DAY RANGE */}
      <div className="flex flex-col shrink-0 hidden md:flex">
        <span className="text-[9px] sm:text-xs text-muted-foreground font-mono font-semibold">DAY RANGE</span>
        <span className="text-sm sm:text-base lg:text-lg font-mono leading-tight">
          ${quote.low?.toFixed(2) ?? '—'} — ${quote.high?.toFixed(2) ?? '—'}
        </span>
      </div>

      <div className="w-px h-8 bg-card-border shrink-0 hidden lg:block" />

      {/* 52W RANGE */}
      <div className="flex flex-col shrink-0 hidden lg:flex">
        <span className="text-[9px] sm:text-xs text-muted-foreground font-mono font-semibold">52W RANGE</span>
        <span className="text-sm sm:text-base lg:text-lg font-mono text-muted-foreground leading-tight">
          ${quote.fiftyTwoWeekLow?.toFixed(2) ?? '—'} — ${quote.fiftyTwoWeekHigh?.toFixed(2) ?? '—'}
        </span>
      </div>
    </div>
  );
}
