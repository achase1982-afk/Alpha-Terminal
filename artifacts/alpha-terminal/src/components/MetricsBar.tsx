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

const GRID_CLS = "grid items-center gap-2 sm:gap-4 w-full min-h-[70px] sm:min-h-[80px]";
const GRID_COLS = "grid-cols-[minmax(80px,1fr)_minmax(90px,1.3fr)_auto]";
const STICKY_BASE = "sticky top-0 z-40 w-full border-b border-card-border shrink-0";
const HEADER_BG = "#0c0c0c";

function HeaderSkeleton() {
  return (
    <div className={`${GRID_CLS} ${GRID_COLS}`}>
      <div className="flex flex-col gap-1.5 overflow-hidden">
        <Skeleton className="h-6 w-16 bg-zinc-800" />
        <Skeleton className="h-3 w-24 bg-zinc-800" />
      </div>
      <div className="flex flex-col items-start gap-1.5 overflow-hidden">
        <Skeleton className="h-3 w-16 bg-zinc-800" />
        <Skeleton className="h-9 w-32 bg-zinc-800" />
        <Skeleton className="h-4 w-24 bg-zinc-800" />
      </div>
      <div className="grid grid-cols-2 gap-2 w-[148px] sm:w-[188px] flex-shrink-0">
        <Skeleton className="h-[48px] rounded-lg bg-zinc-800" />
        <Skeleton className="h-[48px] rounded-lg bg-zinc-800" />
      </div>
    </div>
  );
}

export function MetricsBar({ compact = false, onOpenTearSheet }: MetricsBarProps) {
  const { symbol, accessToken } = useTerminalStore();
  const { data: quote, isLoading, source } = useQuote(symbol);
  const tickColor = useTickColor(symbol, quote?.last ?? null);
  const flashClass = usePriceFlash(quote?.last ?? null, quote?.change ?? null);
  const prevQuoteRef = useRef(quote);
  const [fadeIn, setFadeIn] = useState(true);

  useEffect(() => {
    if (quote && quote.symbol !== prevQuoteRef.current?.symbol) {
      setFadeIn(false);
      const t = requestAnimationFrame(() => {
        requestAnimationFrame(() => setFadeIn(true));
      });
      prevQuoteRef.current = quote;
      return () => cancelAnimationFrame(t);
    }
    prevQuoteRef.current = quote;
  }, [quote]);

  if (!accessToken) {
    return (
      <div className={`${STICKY_BASE} flex items-center justify-center px-4 min-h-[70px] sm:min-h-[80px]`} style={{ background: HEADER_BG }}>
        <p className="text-muted-foreground text-xs sm:text-sm animate-pulse text-center tracking-wider font-mono">
          CONNECT SCHWAB TO VIEW MARKET DATA
        </p>
      </div>
    );
  }

  if (quote?.error === "unauthorized") {
    return (
      <div className={`${STICKY_BASE} flex items-center justify-center gap-2 px-4 min-h-[70px] sm:min-h-[80px]`} style={{ background: HEADER_BG }}>
        <RefreshCw className="w-3.5 h-3.5 text-yellow-500/80 animate-spin" />
        <p className="text-yellow-500/80 text-xs sm:text-sm font-mono tracking-wider">
          SESSION EXPIRED — REFRESHING TOKEN...
        </p>
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
      <div className={`${STICKY_BASE} flex items-center gap-2.5 px-4 sm:px-6 min-h-[70px] sm:min-h-[80px]`} style={{ background: HEADER_BG }}>
        <SearchX className="w-3.5 h-3.5 text-red-500/70 shrink-0" />
        <span className="font-mono text-xs text-red-500/70 tracking-wider">
          {symbol} — SYMBOL NOT FOUND OR UNSUPPORTED BY API
        </span>
      </div>
    );
  }

  const rawChange = quote?.change ?? null;
  const rawPct    = quote?.changePct ?? null;
  const isUp   = rawChange !== null && rawChange > 0;
  const isDown = rawChange !== null && rawChange < 0;
  const isFlat = rawChange !== null && rawChange === 0;
  const priceColor = isDown ? DOWN_COLOR : isUp ? UP_COLOR : FLAT_COLOR;

  const lastStr = quote?.last != null ? `$${fmtPrice(quote.last)}` : "—";

  const changeStr = rawChange !== null
    ? isUp   ? `+$${fmtPrice(rawChange)}`
    : isFlat ? "$0.00"
    :          `\u2212$${fmtPrice(Math.abs(rawChange))}`
    : "—";

  const changePctStr = rawPct !== null
    ? `(${isUp ? "+" : isDown ? "\u2212" : ""}${fmtPrice(Math.abs(rawPct))}%)`
    : "(—%)";

  const bidStr = quote?.bid != null ? `$${fmtPrice(quote.bid)}` : null;
  const askStr = quote?.ask != null ? `$${fmtPrice(quote.ask)}` : null;
  const hasBidAsk = bidStr != null && askStr != null;
  const maxPriceLen = Math.max(bidStr?.length ?? 0, askStr?.length ?? 0);
  const btnPriceCls = maxPriceLen > 9
    ? "text-[10px] sm:text-xs"
    : maxPriceLen > 7
    ? "text-xs sm:text-sm"
    : "text-sm sm:text-base";

  const handleInitiateTrade = (side: 'buy' | 'sell') => {
    console.log(`[Trade] ${side.toUpperCase()} initiated for ${quote?.symbol} — bid: ${quote?.bid}, ask: ${quote?.ask}`);
  };

  if (compact) {
    return (
      <div
        className={`${STICKY_BASE} flex items-center px-3 sm:px-4 gap-3 sm:gap-4 overflow-x-auto`}
        style={{ background: HEADER_BG, height: 36 }}
      >
        {quote ? (
          <>
            <button onClick={onOpenTearSheet} className="font-semibold text-white text-sm tracking-wide shrink-0 hover:text-primary transition-colors cursor-pointer">
              {quote.symbol}
            </button>
            <span className="tabular-nums shrink-0" style={{ fontSize: '0.95rem', fontWeight: 300, color: tickColor }}>
              {lastStr}
            </span>
            <span className="tabular-nums shrink-0 whitespace-nowrap" style={{ fontSize: '0.75rem', fontWeight: 300, color: priceColor }}>
              {changeStr}&nbsp;{changePctStr}
            </span>
            {hasBidAsk && (
              <>
                <span className="text-zinc-700 shrink-0">|</span>
                <span className="tabular-nums text-zinc-400 shrink-0 whitespace-nowrap" style={{ fontSize: '0.75rem', fontWeight: 400 }}>
                  {bidStr}<span className="text-zinc-700 mx-0.5">/</span>{askStr}
                </span>
              </>
            )}
          </>
        ) : (
          <Skeleton className="h-4 w-48 bg-zinc-800" />
        )}
      </div>
    );
  }

  const showData = !!quote;
  const opacityCls = fadeIn && showData ? "opacity-100" : "opacity-0";
  const transitionCls = "transition-opacity duration-150 ease-in-out";

  return (
    <div
      className={`${STICKY_BASE} px-3 sm:px-6 py-2 sm:py-3 overflow-hidden`}
      style={{ background: HEADER_BG }}
    >
      <div className={`${GRID_CLS} ${GRID_COLS}`}>

        <button
          onClick={onOpenTearSheet}
          className={`flex flex-col min-w-0 gap-0.5 text-left cursor-pointer group overflow-hidden ${opacityCls} ${transitionCls}`}
          aria-label={`View company profile for ${quote?.symbol}`}
        >
          {showData ? (
            <>
              <span className="font-semibold text-xl md:text-2xl text-white tracking-tight leading-tight group-hover:text-primary transition-colors whitespace-nowrap">
                {quote.symbol}
              </span>
              <span className="text-[11px] font-medium tracking-wide line-clamp-2 overflow-hidden text-ellipsis uppercase leading-snug" style={{ color: '#FFB800' }}>
                {quote.description || ""}
              </span>
            </>
          ) : (
            <>
              <Skeleton className="h-6 w-16 bg-zinc-800" />
              <Skeleton className="h-3 w-24 bg-zinc-800 mt-1" />
            </>
          )}
        </button>

        <div className={`flex flex-col items-start min-w-0 overflow-hidden ${opacityCls} ${transitionCls}`}>
          <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-semibold leading-none mb-1">Last Price</span>
          {showData ? (
            <>
              <span className={`tabular-nums leading-none whitespace-nowrap font-normal md:font-medium text-2xl sm:text-3xl md:text-4xl text-white tracking-tight ${flashClass}`} style={{ color: tickColor }}>
                {lastStr}
              </span>
              <span
                className="tabular-nums whitespace-nowrap text-sm font-medium h-[20px] flex items-center mt-0.5"
                style={{ color: priceColor }}
              >
                {changeStr} {changePctStr}
              </span>
            </>
          ) : (
            <>
              <Skeleton className="h-9 w-32 bg-zinc-800" />
              <Skeleton className="h-4 w-24 bg-zinc-800 mt-1" />
            </>
          )}
        </div>

        <div className="w-[164px] sm:w-[200px] flex-shrink-0 grid grid-cols-2 gap-1.5 sm:gap-2">
          {showData && hasBidAsk ? (
            <>
              <button
                onClick={() => handleInitiateTrade('sell')}
                className={`trade-btn-sell h-[68px] bg-red-950/40 border border-red-500/50 rounded-lg flex flex-col items-center justify-center p-1.5 cursor-pointer transition-colors active:bg-red-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 overflow-hidden ${opacityCls} ${transitionCls}`}
                aria-label={`Sell ${quote?.symbol} at ${bidStr}`}
              >
                <span className="text-[9px] uppercase font-bold tracking-widest text-red-400 leading-none">SELL</span>
                <span className={`${btnPriceCls} font-bold text-white tabular-nums whitespace-nowrap leading-tight mt-0.5`}>
                  {bidStr}
                </span>
              </button>
              <button
                onClick={() => handleInitiateTrade('buy')}
                className={`trade-btn-buy h-[68px] bg-emerald-950/40 border border-emerald-500/50 rounded-lg flex flex-col items-center justify-center p-1.5 cursor-pointer transition-colors active:bg-emerald-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 overflow-hidden ${opacityCls} ${transitionCls}`}
                aria-label={`Buy ${quote?.symbol} at ${askStr}`}
              >
                <span className="text-[9px] uppercase font-bold tracking-widest text-emerald-400 leading-none">BUY</span>
                <span className={`${btnPriceCls} font-bold text-white tabular-nums whitespace-nowrap leading-tight mt-0.5`}>
                  {askStr}
                </span>
              </button>
            </>
          ) : (
            <>
              <div className="h-[68px] border border-zinc-800/50 rounded-lg flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-600 leading-none">SELL</span>
                <span className="text-sm font-bold text-zinc-600 tabular-nums mt-0.5">—</span>
              </div>
              <div className="h-[68px] border border-zinc-800/50 rounded-lg flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-600 leading-none">BUY</span>
                <span className="text-sm font-bold text-zinc-600 tabular-nums mt-0.5">—</span>
              </div>
            </>
          )}
        </div>

      </div>

      <div className="hidden sm:flex items-center gap-6 mt-2 pt-2 border-t border-zinc-800/60">
        <div className="flex flex-col shrink-0 gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-semibold">Volume</span>
          <span className={`font-mono tabular-nums text-zinc-300 text-sm font-medium ${opacityCls} ${transitionCls}`}>
            {fmtVol(quote?.volume ?? null)}
          </span>
        </div>

        <div className="w-px h-8 bg-zinc-800 shrink-0 hidden md:block" />

        <div className="hidden md:flex flex-col shrink-0 gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-semibold">Day Range</span>
          <span className={`font-mono tabular-nums text-sm font-medium ${opacityCls} ${transitionCls}`}>
            <span style={{ color: DOWN_COLOR }}>${fmtPrice(quote?.low ?? null)}</span>
            <span className="text-zinc-600 mx-1">—</span>
            <span style={{ color: UP_COLOR }}>${fmtPrice(quote?.high ?? null)}</span>
          </span>
        </div>

        <div className="w-px h-8 bg-zinc-800 shrink-0 hidden lg:block" />

        <div className="hidden lg:flex flex-col shrink-0 gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-semibold">52W Range</span>
          <span className={`font-mono tabular-nums text-zinc-500 text-sm font-medium ${opacityCls} ${transitionCls}`}>
            {quote?.fiftyTwoWeekLow != null
              ? `$${fmtPrice(quote.fiftyTwoWeekLow)} — $${fmtPrice(quote.fiftyTwoWeekHigh)}`
              : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
