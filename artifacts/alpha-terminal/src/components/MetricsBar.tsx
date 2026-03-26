import { useGetQuote } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";
import { TrendingUp, TrendingDown, Activity, DollarSign, BarChart2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function MetricsBar() {
  const { symbol, accessToken } = useTerminalStore();
  const { data: quote, isLoading, error } = useGetQuote(
    { symbol, accessToken: accessToken || '' },
    { query: { enabled: !!accessToken && !!symbol, refetchInterval: 10000 } }
  );

  if (!accessToken) {
    return (
      <div className="h-20 w-full bg-card border-b border-card-border flex items-center justify-center">
        <p className="text-muted-foreground font-mono text-sm animate-pulse">CONNECT SCHWAB TO VIEW MARKET DATA</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-20 w-full bg-card border-b border-card-border flex items-center px-6 gap-8 overflow-x-auto">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16 bg-card-border" />
            <Skeleton className="h-6 w-24 bg-card-border" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="h-20 w-full bg-card border-b border-card-border flex items-center px-6">
        <p className="text-destructive font-mono text-sm">ERROR FETCHING QUOTE DATA FOR {symbol}</p>
      </div>
    );
  }

  const isUp = (quote.change || 0) >= 0;

  return (
    <div className="h-20 w-full bg-card border-b border-card-border flex items-center px-6 gap-8 overflow-x-auto terminal-panel rounded-none shadow-none border-t-0 border-l-0 border-r-0">
      <div className="flex flex-col flex-shrink-0">
        <span className="text-xs text-muted-foreground font-mono font-semibold">TICKER</span>
        <div className="flex items-end gap-3">
          <span className="text-2xl font-bold text-foreground">{quote.symbol}</span>
        </div>
      </div>

      <div className="w-px h-10 bg-card-border flex-shrink-0" />

      <div className="flex flex-col flex-shrink-0 min-w-[120px]">
        <span className="text-xs text-muted-foreground font-mono font-semibold">LAST PRICE</span>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono font-bold">${quote.last?.toFixed(2)}</span>
          <span className={`text-sm font-mono flex items-center ${isUp ? 'text-primary' : 'text-destructive'}`}>
            {isUp ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
            {quote.change?.toFixed(2)} ({quote.changePct?.toFixed(2)}%)
          </span>
        </div>
      </div>

      <div className="w-px h-10 bg-card-border flex-shrink-0" />

      <div className="flex flex-col flex-shrink-0">
        <span className="text-xs text-muted-foreground font-mono font-semibold">BID / ASK</span>
        <span className="text-lg font-mono">${quote.bid?.toFixed(2)} / ${quote.ask?.toFixed(2)}</span>
      </div>

      <div className="w-px h-10 bg-card-border flex-shrink-0" />

      <div className="flex flex-col flex-shrink-0">
        <span className="text-xs text-muted-foreground font-mono font-semibold">VOLUME</span>
        <span className="text-lg font-mono">{(quote.volume || 0).toLocaleString()}</span>
      </div>

      <div className="w-px h-10 bg-card-border flex-shrink-0" />

      <div className="flex flex-col flex-shrink-0">
        <span className="text-xs text-muted-foreground font-mono font-semibold">DAY RANGE</span>
        <span className="text-lg font-mono">${quote.low?.toFixed(2)} - ${quote.high?.toFixed(2)}</span>
      </div>

      <div className="w-px h-10 bg-card-border flex-shrink-0" />

      <div className="flex flex-col flex-shrink-0">
        <span className="text-xs text-muted-foreground font-mono font-semibold">52W RANGE</span>
        <span className="text-lg font-mono text-muted-foreground">${quote.fiftyTwoWeekLow?.toFixed(2)} - ${quote.fiftyTwoWeekHigh?.toFixed(2)}</span>
      </div>
    </div>
  );
}
