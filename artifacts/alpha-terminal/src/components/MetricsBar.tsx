import { useGetQuote } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";
import { RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// High-contrast ThinkorSwim-inspired colors
const UP_COLOR   = "#00E676";  // vibrant green
const DOWN_COLOR = "#FF1744";  // vibrant red
const FLAT_COLOR = "#9CA3AF";  // neutral gray

function fmtPrice(n: number | undefined, digits = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtVol(n: number | undefined): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function MetricsBar() {
  const { symbol, accessToken } = useTerminalStore();
  const { data: quote, isLoading, error } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken && !!symbol, refetchInterval: 8000, staleTime: 5000 } }
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

  if (isLoading && !quote) {
    return (
      <div className="w-full bg-card border-b border-card-border flex items-center px-4 sm:px-6 gap-6 overflow-x-auto py-3 shrink-0">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex flex-col gap-1.5 shrink-0">
            <Skeleton className="h-2.5 w-14 bg-card-border" />
            <Skeleton className="h-6 w-28 bg-card-border" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="w-full bg-card border-b border-card-border flex items-center px-4 sm:px-6 py-3 shrink-0">
        <p className="text-destructive font-mono text-[10px] sm:text-sm">
          ERROR FETCHING {symbol}
        </p>
      </div>
    );
  }

  // Strict directional logic per task spec
  const netChange = quote.change ?? 0;
  const isUp   = netChange > 0;
  const isDown = netChange < 0;
  const priceColor = isDown ? DOWN_COLOR : isUp ? UP_COLOR : FLAT_COLOR;

  // ThinkorSwim-style: "$582.56  -5.26  (-0.89%)"
  const lastStr    = quote.last != null ? `$${fmtPrice(quote.last)}` : "—";
  const changeStr  = netChange !== 0
    ? `${isUp ? "+" : ""}${fmtPrice(netChange)}`
    : "0.00";
  const changePctStr = quote.changePct != null
    ? `(${isUp ? "+" : ""}${fmtPrice(quote.changePct)}%)`
    : "(—%)";

  return (
    <div
      className="w-full border-b border-card-border flex items-center px-4 sm:px-6 gap-4 sm:gap-6 lg:gap-8 overflow-x-auto shrink-0 py-2 sm:h-16"
      style={{ background: "#0A0F16" }}
    >
      {/* Symbol */}
      <div className="flex flex-col shrink-0">
        <span className="text-[8px] sm:text-[10px] text-gray-500 font-mono font-semibold tracking-widest">TICKER</span>
        <span className="text-base sm:text-xl font-black text-white leading-tight tracking-wide">{quote.symbol}</span>
      </div>

      <div className="w-px h-8 bg-gray-800 shrink-0" />

      {/* ── ThinkorSwim-style price block ── */}
      <div className="flex flex-col shrink-0">
        <span className="text-[8px] sm:text-[10px] text-gray-500 font-mono font-semibold tracking-widest">LAST PRICE</span>
        <div className="flex items-baseline gap-2" style={{ color: priceColor }}>
          {/* Large last price */}
          <span className="text-lg sm:text-2xl font-mono font-black leading-tight tabular-nums">
            {lastStr}
          </span>
          {/* Dollar change + pct in same color — hidden on very small screens */}
          <span className="hidden sm:flex items-center gap-1 font-mono font-bold text-sm tabular-nums">
            {changeStr}
            <span className="text-xs opacity-90">{changePctStr}</span>
          </span>
          {/* Mobile: just pct */}
          <span className="sm:hidden font-mono font-bold text-xs tabular-nums opacity-90">
            {changePctStr}
          </span>
        </div>
      </div>

      <div className="w-px h-8 bg-gray-800 shrink-0" />

      {/* BID / ASK */}
      <div className="flex flex-col shrink-0">
        <span className="text-[8px] sm:text-[10px] text-gray-500 font-mono font-semibold tracking-widest">BID / ASK</span>
        <span className="text-sm sm:text-base font-mono font-semibold text-gray-200 leading-tight tabular-nums">
          ${fmtPrice(quote.bid)} / ${fmtPrice(quote.ask)}
        </span>
      </div>

      <div className="w-px h-8 bg-gray-800 shrink-0 hidden sm:block" />

      {/* VOLUME */}
      <div className="hidden sm:flex flex-col shrink-0">
        <span className="text-[8px] sm:text-[10px] text-gray-500 font-mono font-semibold tracking-widest">VOLUME</span>
        <span className="text-sm sm:text-base font-mono font-semibold text-gray-200 leading-tight tabular-nums">
          {fmtVol(quote.volume)}
        </span>
      </div>

      <div className="w-px h-8 bg-gray-800 shrink-0 hidden md:block" />

      {/* DAY RANGE */}
      <div className="hidden md:flex flex-col shrink-0">
        <span className="text-[8px] sm:text-[10px] text-gray-500 font-mono font-semibold tracking-widest">DAY RANGE</span>
        <span className="text-sm sm:text-base font-mono font-semibold text-gray-200 leading-tight tabular-nums">
          <span style={{ color: DOWN_COLOR }}>${fmtPrice(quote.low)}</span>
          <span className="text-gray-600 mx-1">—</span>
          <span style={{ color: UP_COLOR }}>${fmtPrice(quote.high)}</span>
        </span>
      </div>

      <div className="w-px h-8 bg-gray-800 shrink-0 hidden lg:block" />

      {/* 52W RANGE */}
      <div className="hidden lg:flex flex-col shrink-0">
        <span className="text-[8px] sm:text-[10px] text-gray-500 font-mono font-semibold tracking-widest">52W RANGE</span>
        <span className="text-sm sm:text-base font-mono font-semibold text-gray-500 leading-tight tabular-nums">
          ${fmtPrice(quote.fiftyTwoWeekLow)} — ${fmtPrice(quote.fiftyTwoWeekHigh)}
        </span>
      </div>

      <div className="w-px h-8 bg-gray-800 shrink-0 hidden xl:block" />

      {/* P/E RATIO — only if available */}
      {quote.peRatio != null && (
        <div className="hidden xl:flex flex-col shrink-0">
          <span className="text-[8px] sm:text-[10px] text-gray-500 font-mono font-semibold tracking-widest">P/E</span>
          <span className="text-sm sm:text-base font-mono font-semibold text-gray-200 leading-tight tabular-nums">
            {fmtPrice(quote.peRatio, 1)}
          </span>
        </div>
      )}
    </div>
  );
}
