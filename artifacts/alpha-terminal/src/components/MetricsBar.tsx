import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { useTickColor }     from "@/hooks/useTickColor";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const UP_COLOR   = "#00E676";
const DOWN_COLOR = "#FF1744";
const FLAT_COLOR = "#9CA3AF";

// Small muted uppercase label used above every metric
const LABEL_CLS = "text-[9px] sm:text-[10px] text-gray-500 font-normal tracking-wider uppercase leading-none";

function fmtPrice(n: number | null, digits = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtVol(n: number | null): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function MetricsBar() {
  const { symbol, accessToken, streamConnected } = useTerminalStore();
  const { data: quote, isLoading, source } = useQuote(symbol);
  const tickColor = useTickColor(symbol, quote?.last ?? null);

  if (!accessToken) {
    return (
      <div className="w-full border-b border-card-border flex items-center justify-center px-4 py-3 shrink-0" style={{ background: "#060A10" }}>
        <p className="text-muted-foreground text-xs sm:text-sm animate-pulse text-center tracking-wider font-mono">
          CONNECT SCHWAB TO VIEW MARKET DATA
        </p>
      </div>
    );
  }

  if (quote?.error === "unauthorized") {
    return (
      <div className="w-full border-b border-card-border flex items-center justify-center gap-2 px-4 py-3 shrink-0" style={{ background: "#060A10" }}>
        <RefreshCw className="w-3.5 h-3.5 text-yellow-500/80 animate-spin" />
        <p className="text-yellow-500/80 text-xs sm:text-sm font-mono tracking-wider">
          SESSION EXPIRED — REFRESHING TOKEN...
        </p>
      </div>
    );
  }

  if (isLoading && !quote) {
    return (
      <div className="w-full border-b border-card-border flex items-center px-4 sm:px-6 gap-6 overflow-x-auto py-3 shrink-0" style={{ background: "#060A10" }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex flex-col gap-1.5 shrink-0">
            <Skeleton className="h-2.5 w-14 bg-card-border" />
            <Skeleton className="h-6 w-28 bg-card-border" />
          </div>
        ))}
      </div>
    );
  }

  if (!quote) return null;

  // Strict null-aware directional logic
  const rawChange = quote.change;
  const rawPct    = quote.changePct;

  const isUp   = rawChange !== null && rawChange > 0;
  const isDown = rawChange !== null && rawChange < 0;
  const isFlat = rawChange !== null && rawChange === 0;

  const priceColor = isDown ? DOWN_COLOR : isUp ? UP_COLOR : FLAT_COLOR;

  const lastStr = quote.last != null ? `$${fmtPrice(quote.last)}` : "—";

  const changeStr = rawChange !== null
    ? isUp   ? `+$${fmtPrice(rawChange)}`
    : isFlat ? "$0.00"
    :          `-$${fmtPrice(Math.abs(rawChange))}`
    : "—";

  const changePctStr = rawPct !== null
    ? `(${isUp ? "+" : ""}${fmtPrice(rawPct)}%)`
    : "(—%)";

  return (
    <div
      className="w-full border-b border-card-border flex items-center px-4 sm:px-6 gap-4 sm:gap-6 lg:gap-8 overflow-x-auto shrink-0 py-2 sm:h-16"
      style={{ background: "#0A0F16" }}
    >
      {/* Ticker + company name */}
      <div className="flex flex-col shrink-0 gap-0.5">
        <span className={LABEL_CLS}>Ticker</span>
        <span className="font-bold text-white leading-tight" style={{ fontSize: '1.1rem' }}>
          {quote.symbol}
        </span>
        {/* Company name: 0.8rem, #9CA3AF, weight 400 — always rendered */}
        <span
          className="leading-tight truncate max-w-[130px] sm:max-w-[200px]"
          style={{ fontSize: '0.8rem', color: '#9CA3AF', fontWeight: 400, lineHeight: 1.3 }}
        >
          {quote.description || "Name Unavailable"}
        </span>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0" />

      {/* LAST PRICE */}
      <div className="flex flex-col shrink-0 gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className={LABEL_CLS}>Last Price</span>
          {source === "stream"
            ? <span title="Live stream" className="flex items-center gap-0.5 text-[7px] font-mono text-emerald-400 leading-none font-semibold">
                <Wifi className="w-2.5 h-2.5" />LIVE
              </span>
            : streamConnected
              ? null
              : <span title="REST poll" className="flex items-center gap-0.5 text-[7px] font-mono text-gray-600 leading-none">
                  <WifiOff className="w-2.5 h-2.5" />POLL
                </span>
          }
        </div>
        {/* All price data: font-weight 300 — thin and crisp, native system mono like TOS */}
        <div className="flex flex-col">
          <span className="tabular-nums leading-tight" style={{ fontSize: '1.4rem', fontWeight: 300, color: tickColor }}>
            {lastStr}
          </span>
          <span className="tabular-nums leading-tight" style={{ fontSize: '0.8rem', fontWeight: 300, color: priceColor }}>
            {changeStr}&nbsp;<span style={{ opacity: 0.8 }}>{changePctStr}</span>
          </span>
        </div>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0" />

      {/* BID / ASK */}
      <div className="flex flex-col shrink-0 gap-0.5">
        <span className={LABEL_CLS}>Bid / Ask</span>
        <span className="font-mono tabular-nums text-gray-200" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
          ${fmtPrice(quote.bid)}&nbsp;<span className="text-gray-600">/</span>&nbsp;${fmtPrice(quote.ask)}
        </span>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0 hidden sm:block" />

      {/* VOLUME */}
      <div className="hidden sm:flex flex-col shrink-0 gap-0.5">
        <span className={LABEL_CLS}>Volume</span>
        <span className="font-mono tabular-nums text-gray-200" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
          {fmtVol(quote.volume)}
        </span>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0 hidden md:block" />

      {/* DAY RANGE */}
      <div className="hidden md:flex flex-col shrink-0 gap-0.5">
        <span className={LABEL_CLS}>Day Range</span>
        <span className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
          <span style={{ color: DOWN_COLOR }}>${fmtPrice(quote.low)}</span>
          <span className="text-gray-600 mx-1">—</span>
          <span style={{ color: UP_COLOR }}>${fmtPrice(quote.high)}</span>
        </span>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0 hidden lg:block" />

      {/* 52W RANGE */}
      <div className="hidden lg:flex flex-col shrink-0 gap-0.5">
        <span className={LABEL_CLS}>52W Range</span>
        <span className="font-mono tabular-nums text-gray-500" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
          {quote.fiftyTwoWeekLow != null
            ? `$${fmtPrice(quote.fiftyTwoWeekLow)} — $${fmtPrice(quote.fiftyTwoWeekHigh)}`
            : "—"}
        </span>
      </div>
    </div>
  );
}
