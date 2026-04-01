import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { useTickColor }     from "@/hooks/useTickColor";
import { RefreshCw, SearchX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRef, useEffect, useState } from "react";

const UP_COLOR   = "#00d166";
const DOWN_COLOR = "#f23645";
const FLAT_COLOR = "#9CA3AF";

function fmtPrice(n: number | null, digits = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(digits);
}

interface MetricsBarProps {
  compact?: boolean;
}

function usePriceFlash(price: number | null): string {
  const [flash, setFlash] = useState("");
  const prevPrice = useRef<number | null>(null);

  useEffect(() => {
    if (price == null || prevPrice.current == null || price === prevPrice.current) {
      prevPrice.current = price;
      return;
    }
    const cls = price > prevPrice.current ? "price-flash-up" : "price-flash-down";
    prevPrice.current = price;
    setFlash(cls);
    const t = setTimeout(() => setFlash(""), 600);
    return () => clearTimeout(t);
  }, [price]);

  return flash;
}

export function MetricsBar({ compact = false }: MetricsBarProps) {
  const { symbol, accessToken } = useTerminalStore();
  const { data: quote } = useQuote(symbol);
  const tickColor = useTickColor(symbol, quote?.last ?? null);
  const flashClass = usePriceFlash(quote?.last ?? null);

  const noSchwab = !accessToken && !quote?.last;

  if (noSchwab) {
    return (
      <div className={`w-full border-b border-card-border flex items-center justify-center px-4 transition-all duration-300 ${compact ? "h-11" : "h-20"}`} style={{ background: "#0c0c0c" }}>
        <p className="text-muted-foreground text-xs animate-pulse text-center tracking-wider font-mono">
          CONNECT SCHWAB TO VIEW MARKET DATA
        </p>
      </div>
    );
  }

  if (quote?.error === "unauthorized") {
    return (
      <div className="w-full border-b border-card-border flex items-center justify-center gap-2 px-4 h-11" style={{ background: "#0c0c0c" }}>
        <RefreshCw className="w-3.5 h-3.5 text-yellow-500/80 animate-spin" />
        <p className="text-yellow-500/80 text-xs font-mono tracking-wider">SESSION EXPIRED — REFRESHING...</p>
      </div>
    );
  }

  const quoteErr = quote?.error;
  const isNotFound =
    quoteErr === "no_data" ||
    quoteErr === "internal_error" ||
    quoteErr?.startsWith("api_error_4") ||
    quoteErr?.startsWith("api_error_5");

  if (isNotFound) {
    return (
      <div className="w-full border-b border-card-border flex items-center gap-2.5 px-4 h-11" style={{ background: "#0c0c0c" }}>
        <SearchX className="w-3.5 h-3.5 text-red-500/70 shrink-0" />
        <span className="font-mono text-xs text-red-500/70 tracking-wider">{symbol} — NOT FOUND</span>
      </div>
    );
  }

  const rawChange = quote?.change ?? null;
  const rawPct    = quote?.changePct ?? null;
  const isUp   = rawChange !== null && rawChange > 0;
  const isDown = rawChange !== null && rawChange < 0;
  const priceColor = isDown ? DOWN_COLOR : isUp ? UP_COLOR : FLAT_COLOR;

  const lastStr = quote?.last != null ? `$${fmtPrice(quote.last)}` : "—";
  const changePctStr = rawPct !== null
    ? `${isUp ? "+" : isDown ? "\u2212" : ""}${fmtPrice(Math.abs(rawPct))}%`
    : "—%";

  const bidStr = quote?.bid != null ? fmtPrice(quote.bid) : "—";
  const askStr = quote?.ask != null ? fmtPrice(quote.ask) : "—";
  const showData = !!quote && quote.symbol?.toUpperCase() === symbol.toUpperCase();

  const handleInitiateTrade = (side: "buy" | "sell") => {
    console.log(`[Trade] ${side.toUpperCase()} initiated for ${quote?.symbol} — bid: ${quote?.bid}, ask: ${quote?.ask}`);
  };

  return (
    <div
      className={`w-full border-b border-card-border flex items-center px-4 transition-all duration-300 ${compact ? "h-11" : "h-24"}`}
      style={{ background: "#0c0c0c" }}
    >
      {!compact && (
        <div className="flex-1 min-w-0 mr-3">
          {showData ? (
            <>
              <span className={`text-2xl font-bold tabular-nums leading-tight block ${flashClass}`} style={{ color: tickColor }}>
                {lastStr}
              </span>
              <p className="text-xs font-mono font-medium tabular-nums mt-0.5" style={{ color: priceColor }}>
                {changePctStr}
              </p>
            </>
          ) : (
            <>
              <Skeleton className="h-7 w-24 bg-zinc-800" />
              <Skeleton className="h-3.5 w-16 bg-zinc-800 mt-1" />
            </>
          )}
        </div>
      )}

      <div className={`flex gap-1 ${compact ? "w-full" : "w-40 sm:w-48"} h-full py-1`}>
        <button
          onClick={() => handleInitiateTrade("sell")}
          className={`flex-1 bg-red-950/60 border border-red-500/40 rounded-lg flex flex-col items-center justify-center transition-colors active:bg-red-800/70 trade-btn-sell ${compact ? "h-9" : "h-full"}`}
        >
          {!compact && showData && (
            <span className="text-[10px] font-mono tabular-nums text-white/60 leading-tight">{bidStr}</span>
          )}
          <span className="font-bold text-xs text-white tracking-wider">SELL</span>
        </button>
        <button
          onClick={() => handleInitiateTrade("buy")}
          className={`flex-1 bg-emerald-950/60 border border-emerald-500/40 rounded-lg flex flex-col items-center justify-center transition-colors active:bg-emerald-800/70 trade-btn-buy ${compact ? "h-9" : "h-full"}`}
        >
          <span className="font-bold text-xs text-white tracking-wider">BUY</span>
          {!compact && showData && (
            <span className="text-[10px] font-mono tabular-nums text-white/60 leading-tight">{askStr}</span>
          )}
        </button>
      </div>
    </div>
  );
}
