import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { useTickColor }     from "@/hooks/useTickColor";
import { RefreshCw, SearchX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRef, useEffect, useState } from "react";

const UP_COLOR   = "#00d166";
const DOWN_COLOR = "#f23645";
const FLAT_COLOR = "#9CA3AF";

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

interface MetricsBarProps {
  compact?: boolean;
  onOpenTearSheet?: () => void;
}

function usePriceFlash(price: number | null, change: number | null): string {
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

export function MetricsBar({ compact = false, onOpenTearSheet }: MetricsBarProps) {
  const { symbol, accessToken } = useTerminalStore();
  const { data: quote, isLoading, source } = useQuote(symbol);
  const tickColor = useTickColor(symbol, quote?.last ?? null);
  const flashClass = usePriceFlash(quote?.last ?? null, quote?.change ?? null);

  const stickyBase = "sticky top-0 z-40 w-full border-b border-card-border shrink-0 transition-all duration-300 ease-in-out";

  if (!accessToken) {
    return (
      <div className={`${stickyBase} flex items-center justify-center px-4 py-3`} style={{ background: "#0c0c0c" }}>
        <p className="text-muted-foreground text-xs sm:text-sm animate-pulse text-center tracking-wider font-mono">
          CONNECT SCHWAB TO VIEW MARKET DATA
        </p>
      </div>
    );
  }

  if (quote?.error === "unauthorized") {
    return (
      <div className={`${stickyBase} flex items-center justify-center gap-2 px-4 py-3`} style={{ background: "#0c0c0c" }}>
        <RefreshCw className="w-3.5 h-3.5 text-yellow-500/80 animate-spin" />
        <p className="text-yellow-500/80 text-xs sm:text-sm font-mono tracking-wider">
          SESSION EXPIRED — REFRESHING TOKEN...
        </p>
      </div>
    );
  }

  if (isLoading && !quote) {
    return (
      <div className={`${stickyBase} flex items-center px-4 sm:px-6 gap-6 overflow-x-auto py-3`} style={{ background: "#0c0c0c" }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex flex-col gap-1.5 shrink-0">
            <Skeleton className="h-2.5 w-14 bg-card-border" />
            <Skeleton className="h-6 w-28 bg-card-border" />
          </div>
        ))}
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
      <div className={`${stickyBase} flex items-center gap-2.5 px-4 sm:px-6 py-3`} style={{ background: "#0c0c0c" }}>
        <SearchX className="w-3.5 h-3.5 text-red-500/70 shrink-0" />
        <span className="font-mono text-xs text-red-500/70 tracking-wider">
          {symbol} — SYMBOL NOT FOUND OR UNSUPPORTED BY API
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/50 ml-1">
          · LAST PRICE: —
        </span>
      </div>
    );
  }

  if (!quote) return null;

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
    :          `\u2212$${fmtPrice(Math.abs(rawChange))}`
    : "—";

  const changePctStr = rawPct !== null
    ? `(${isUp ? "+" : isDown ? "\u2212" : ""}${fmtPrice(Math.abs(rawPct))}%)`
    : "(—%)";

  if (compact) {
    return (
      <div
        className={`${stickyBase} flex items-center px-3 sm:px-4 gap-3 sm:gap-4 overflow-x-auto`}
        style={{ background: "#0c0c0c", height: 36 }}
      >
        <button onClick={onOpenTearSheet} className="font-bold text-white text-sm tracking-wide shrink-0 hover:text-primary transition-colors cursor-pointer">
          {quote.symbol}
        </button>

        <span className="tabular-nums shrink-0" style={{ fontSize: '0.95rem', fontWeight: 300, color: tickColor }}>
          {lastStr}
        </span>

        <span className="tabular-nums shrink-0" style={{ fontSize: '0.75rem', fontWeight: 300, color: priceColor }}>
          {changeStr}&nbsp;{changePctStr}
        </span>

        {(quote.bid != null && quote.ask != null) && (
          <>
            <span className="text-gray-600 shrink-0">|</span>
            <span
              className="tabular-nums text-gray-300 shrink-0 whitespace-nowrap"
              style={{ fontSize: '0.75rem', fontWeight: 400 }}
            >
              ${fmtPrice(quote.bid)}<span className="text-gray-600 mx-0.5">/</span>${fmtPrice(quote.ask)}
            </span>
          </>
        )}

      </div>
    );
  }

  const bidAskStr = quote.bid != null && quote.ask != null
    ? `$${fmtPrice(quote.bid)} / $${fmtPrice(quote.ask)}`
    : null;
  const bidAskLen = bidAskStr?.length ?? 0;
  const bidAskFontSize = bidAskLen > 22 ? '0.7rem' : bidAskLen > 18 ? '0.78rem' : '0.9rem';

  return (
    <div
      className={`${stickyBase} flex items-center px-3 sm:px-6 overflow-x-auto py-1.5 sm:py-2`}
      style={{ background: "#0c0c0c" }}
    >
      <div className="grid items-center w-full min-w-0 max-w-[640px]" style={{ gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr) minmax(0, auto)' }}>
        <button onClick={onOpenTearSheet} className="flex flex-col min-w-0 gap-0 text-left cursor-pointer group pr-3" aria-label={`View company profile for ${quote.symbol}`}>
          <span className="font-bold text-white leading-tight group-hover:text-primary transition-colors" style={{ fontSize: '1rem' }}>
            {quote.symbol}
          </span>
          <span
            className="block w-full min-w-0 leading-snug group-hover:text-[#FFB800] transition-colors"
            style={{ fontSize: '0.65rem', color: '#FFB800', fontWeight: 400, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {quote.description || ""}
          </span>
        </button>

        <div className="flex flex-col min-w-0 gap-0 border-l border-gray-800 pl-3">
          <span className={LABEL_CLS}>Last Price</span>
          <span className={`tabular-nums leading-tight whitespace-nowrap ${flashClass}`} style={{ fontSize: '1.25rem', fontWeight: 300, color: tickColor }}>
            {lastStr}
          </span>
          <span className="tabular-nums leading-tight whitespace-nowrap" style={{ fontSize: '0.7rem', fontWeight: 300, color: priceColor }}>
            {changeStr}&nbsp;{changePctStr}
          </span>
        </div>

        <div className="flex flex-col min-w-0 gap-0 border-l border-gray-800 pl-3">
          <span className={LABEL_CLS}>Bid / Ask</span>
          <span
            className="font-mono tabular-nums text-gray-200 whitespace-nowrap"
            style={{ fontSize: bidAskFontSize, fontWeight: 400 }}
          >
            {bidAskStr ?? <span className="text-gray-600">N/A</span>}
          </span>
        </div>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0 hidden sm:block ml-6" />

      <div className="hidden sm:flex flex-col shrink-0 gap-0.5 ml-6">
        <span className={LABEL_CLS}>Volume</span>
        <span className="font-mono tabular-nums text-gray-200" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
          {fmtVol(quote.volume)}
        </span>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0 hidden md:block ml-6" />

      <div className="hidden md:flex flex-col shrink-0 gap-0.5 ml-6">
        <span className={LABEL_CLS}>Day Range</span>
        <span className="font-mono tabular-nums" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
          <span style={{ color: DOWN_COLOR }}>${fmtPrice(quote.low)}</span>
          <span className="text-gray-600 mx-1">—</span>
          <span style={{ color: UP_COLOR }}>${fmtPrice(quote.high)}</span>
        </span>
      </div>

      <div className="w-px h-10 bg-gray-800 shrink-0 hidden lg:block ml-6" />

      <div className="hidden lg:flex flex-col shrink-0 gap-0.5 ml-6">
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
