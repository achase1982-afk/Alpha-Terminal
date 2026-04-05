import { useTerminalStore, useActiveWatchlist } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { useTickColor }     from "@/hooks/useTickColor";
import { RefreshCw, SearchX, FileText, PlusCircle, MinusCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRef, useEffect, useState, useLayoutEffect, useCallback } from "react";

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
  onTrade?: (side: "BUY" | "SELL") => void;
}

const TICK_UP = "#00d166";
const TICK_DN = "#f23645";
const TICK_NEUTRAL = "#e4e4e7";
const TICK_FLASH_MS = 800;

function usePriceFlash(price: number | null, _change: number | null): string {
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

function useTickFlashColor(price: number | null): string {
  const prevPrice = useRef<number | null>(null);
  const [color, setColor] = useState(TICK_NEUTRAL);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (price == null) {
      prevPrice.current = price;
      return;
    }
    if (prevPrice.current != null && price !== prevPrice.current) {
      const tickColor = price > prevPrice.current ? TICK_UP : TICK_DN;
      setColor(tickColor);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setColor(TICK_NEUTRAL), TICK_FLASH_MS);
    }
    prevPrice.current = price;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [price]);

  return color;
}

const COMPANY_FONT_LG = 15;
const COMPANY_FONT_SM = 11;
const COMPANY_BOX_H = 34;

function WatchlistToggle({ symbol }: { symbol: string }) {
  const watchlistSymbols = useActiveWatchlist();
  const addToWatchlist = useTerminalStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminalStore((s) => s.removeFromWatchlist);
  const isInWatchlist = watchlistSymbols.includes(symbol.toUpperCase());
  const [flash, setFlash] = useState(false);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInWatchlist) {
      removeFromWatchlist(symbol);
    } else {
      addToWatchlist(symbol);
    }
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
  }, [symbol, isInWatchlist, addToWatchlist, removeFromWatchlist]);

  const BadgeIcon = isInWatchlist ? MinusCircle : PlusCircle;

  return (
    <button
      onClick={handleToggle}
      className={`relative shrink-0 transition-all duration-200 active:scale-90 ${flash ? "scale-110" : ""}`}
      style={{ width: 18, height: 20 }}
      aria-label={isInWatchlist ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
    >
      <FileText
        style={{ color: "#ffffff", position: "absolute", top: 0, left: 0 }}
        strokeWidth={1.5}
        size={16}
      />
      <BadgeIcon
        style={{
          color: "#ffffff",
          position: "absolute",
          bottom: -2,
          right: -4,
          background: "#000000",
          borderRadius: "50%",
        }}
        strokeWidth={2}
        size={9}
      />
    </button>
  );
}

function TickerBlock({ symbol, description, showData, opacityCls, transitionCls, onOpenTearSheet }: {
  symbol?: string; description?: string; showData: boolean;
  opacityCls: string; transitionCls: string; onOpenTearSheet?: () => void;
}) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const [nameFontSize, setNameFontSize] = useState(COMPANY_FONT_LG);

  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el || !description) return;
    el.style.fontSize = `${COMPANY_FONT_LG}px`;
    if (el.scrollHeight > COMPANY_BOX_H) {
      el.style.fontSize = `${COMPANY_FONT_SM}px`;
      setNameFontSize(COMPANY_FONT_SM);
    } else {
      setNameFontSize(COMPANY_FONT_LG);
    }
  }, [description]);

  return (
    <div className={`flex flex-col min-w-0 text-left overflow-hidden ${opacityCls} ${transitionCls}`}>
      {showData ? (
        <>
          <span className="inline-flex items-center gap-0.5 leading-none">
            <span
              onClick={onOpenTearSheet}
              className="font-semibold text-white tracking-tight cursor-pointer hover:text-primary transition-colors whitespace-nowrap"
              style={{ fontSize: 24 }}
              role="button"
              tabIndex={0}
            >
              {symbol}
            </span>
            {symbol && <WatchlistToggle symbol={symbol} />}
          </span>
          <span
            ref={nameRef}
            onClick={onOpenTearSheet}
            className="font-medium tracking-wide uppercase leading-snug overflow-hidden text-ellipsis cursor-pointer"
            style={{ color: '#FFB800', fontSize: nameFontSize, maxHeight: COMPANY_BOX_H, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, marginTop: 2, wordBreak: 'break-word' }}
          >
            {description || ""}
          </span>
        </>
      ) : (
        <>
          <Skeleton className="h-6 w-16 bg-zinc-800" />
          <Skeleton className="h-3 w-24 bg-zinc-800 mt-1" />
        </>
      )}
    </div>
  );
}

const GRID_CLS = "grid items-center gap-2 sm:gap-4 w-full min-h-[70px] sm:min-h-[80px]";
const GRID_COLS = "grid-cols-[minmax(80px,1fr)_minmax(90px,1.3fr)_auto]";
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

export function VolumeBar() {
  const { symbol, streamPrices } = useTerminalStore();
  const { data: quote } = useQuote(symbol);
  const vol = streamPrices[symbol]?.volume ?? quote?.volume ?? null;
  const dayHigh = streamPrices[symbol]?.high ?? quote?.high ?? null;
  const dayLow = streamPrices[symbol]?.low ?? quote?.low ?? null;
  const wk52High = quote?.fiftyTwoWeekHigh ?? null;
  const wk52Low = quote?.fiftyTwoWeekLow ?? null;

  return (
    <div
      className="w-full grid grid-cols-3 px-3 sm:px-6 border-b border-card-border py-1.5"
      style={{ background: HEADER_BG }}
    >
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-[9px] tracking-[0.12em] text-zinc-500 font-semibold leading-none">Volume</span>
        <span className="font-mono tabular-nums text-zinc-300 text-[13px] font-medium leading-none">{fmtVol(vol)}</span>
      </div>
      <div className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-[9px] tracking-[0.12em] text-zinc-500 font-semibold leading-none">Day Range</span>
        <span className="font-mono tabular-nums text-[13px] font-medium leading-none whitespace-nowrap">
          <span style={{ color: DOWN_COLOR }}>${fmtPrice(dayLow)}</span>
          <span className="text-zinc-600 mx-0.5">—</span>
          <span style={{ color: UP_COLOR }}>${fmtPrice(dayHigh)}</span>
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[9px] tracking-[0.12em] text-zinc-500 font-semibold leading-none">52W Range</span>
        <span className="font-mono tabular-nums text-zinc-300 text-[13px] font-medium leading-none">
          {wk52Low != null ? `$${fmtPrice(wk52Low)} — $${fmtPrice(wk52High)}` : "—"}
        </span>
      </div>
    </div>
  );
}

export function MetricsBar({ compact = false, onOpenTearSheet, onTrade }: MetricsBarProps) {
  const { symbol, accessToken, streamPrices } = useTerminalStore();
  const { data: quote, isLoading, source } = useQuote(symbol);
  const tickColor = useTickColor(symbol, quote?.last ?? null);
  const bidTickColor = useTickColor(`${symbol}__bid`, quote?.bid ?? null);
  const askTickColor = useTickColor(`${symbol}__ask`, quote?.ask ?? null);
  const prevSymbolRef = useRef<string | null>(quote?.symbol ?? null);
  const [fadeIn, setFadeIn] = useState(true);

  useEffect(() => {
    const sym = quote?.symbol ?? null;
    if (!sym) return;
    if (sym !== prevSymbolRef.current) {
      prevSymbolRef.current = sym;
      setFadeIn(false);
      let inner: number | null = null;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setFadeIn(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        if (inner !== null) cancelAnimationFrame(inner);
      };
    }
  }, [quote?.symbol]);

  const hasAnyStreamData = Object.keys(streamPrices).length > 0;
  // Only show "connect" message if stream has no data at all — not just because this symbol hasn't arrived yet
  const noSchwab = !accessToken && !quote?.last && !hasAnyStreamData;
  // Stream is working but new symbol data hasn't arrived yet — show skeleton instead of "connect" message
  const waitingForSymbol = !accessToken && !quote?.last && hasAnyStreamData;

  if (noSchwab) {
    return (
      <div
        className="w-full border-b border-card-border flex items-center justify-center px-4 overflow-hidden"
        style={{
          background: HEADER_BG,
          height: compact ? 36 : 70,
          minHeight: compact ? 36 : 70,
          transition: "height 500ms ease, min-height 500ms ease",
        }}
      >
        <p
          className="text-muted-foreground animate-pulse text-center tracking-wider font-mono whitespace-nowrap"
          style={{ fontSize: compact ? 11 : 12, transition: "font-size 500ms ease" }}
        >
          Connect Brokerage For Market Data
        </p>
      </div>
    );
  }

  if (waitingForSymbol) {
    return (
      <div className="w-full border-b border-card-border px-4 sm:px-6 min-h-[70px] sm:min-h-[80px] flex items-center" style={{ background: HEADER_BG }}>
        <HeaderSkeleton />
      </div>
    );
  }

  if (quote?.error === "unauthorized") {
    return (
      <div className="w-full border-b border-card-border flex items-center justify-center gap-2 px-4 min-h-[70px] sm:min-h-[80px]" style={{ background: HEADER_BG }}>
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
      <div className="w-full border-b border-card-border flex items-center gap-2.5 px-4 sm:px-6 min-h-[70px] sm:min-h-[80px]" style={{ background: HEADER_BG }}>
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
  const bidSizeStr = quote?.bidSize != null ? String(Math.round(quote.bidSize)) : null;
  const askSizeStr = quote?.askSize != null ? String(Math.round(quote.askSize)) : null;

  const symbolMatches = quote?.symbol?.toUpperCase() === symbol.toUpperCase();
  const showData = !!quote && symbolMatches;

  const handleInitiateTrade = (side: 'buy' | 'sell') => {
    onTrade?.(side === 'buy' ? 'BUY' : 'SELL');
  };

  if (compact) {
    return (
      <div
        className="w-full border-b border-card-border flex items-center px-3 sm:px-6 overflow-x-auto"
        style={{ background: HEADER_BG, height: 36 }}
      >
        {quote ? (
          <>
            <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
              <button onClick={onOpenTearSheet} className="font-semibold text-white text-sm tracking-wide shrink-0 hover:text-primary transition-colors cursor-pointer">
                {quote.symbol}
              </button>
              <span className="tabular-nums shrink-0" style={{ fontSize: '0.95rem', fontWeight: 300, color: tickColor }}>
                {lastStr}
              </span>
              <span className="tabular-nums shrink-0 whitespace-nowrap" style={{ fontSize: '0.75rem', fontWeight: 300, color: priceColor }}>
                {changeStr}&nbsp;{changePctStr}
              </span>
            </div>
            <div className="w-[164px] sm:w-[200px] flex-shrink-0 grid grid-cols-2 gap-1.5 sm:gap-2">
              <button
                onClick={() => handleInitiateTrade('sell')}
                className="h-6 bg-red-950/40 border border-red-500/50 rounded flex items-center justify-center cursor-pointer transition-colors active:bg-red-800/70 trade-btn-sell"
                aria-label={`Sell ${quote?.symbol}`}
              >
                <span className="text-[9px] font-bold tracking-widest text-white leading-none">Sell</span>
              </button>
              <button
                onClick={() => handleInitiateTrade('buy')}
                className="h-6 bg-emerald-950/40 border border-emerald-500/50 rounded flex items-center justify-center cursor-pointer transition-colors active:bg-emerald-800/70 trade-btn-buy"
                aria-label={`Buy ${quote?.symbol}`}
              >
                <span className="text-[9px] font-bold tracking-widest text-white leading-none">Buy</span>
              </button>
            </div>
          </>
        ) : (
          <Skeleton className="h-4 w-48 bg-zinc-800" />
        )}
      </div>
    );
  }

  const opacityCls = fadeIn || !showData ? "opacity-100" : "opacity-0";
  const transitionCls = "transition-opacity duration-150 ease-in-out";

  return (
    <div
      className="w-full border-b border-card-border px-3 sm:px-6 py-1 sm:py-1.5 overflow-hidden"
      style={{ background: HEADER_BG }}
    >
      <div className={`${GRID_CLS} ${GRID_COLS}`}>

        <TickerBlock
          symbol={quote?.symbol}
          description={quote?.description}
          showData={showData}
          opacityCls={opacityCls}
          transitionCls={transitionCls}
          onOpenTearSheet={onOpenTearSheet}
        />

        <div className={`flex flex-col justify-center items-start min-w-0 overflow-hidden ${opacityCls} ${transitionCls}`}>
          {showData ? (
            <>
              <span className="tabular-nums leading-none whitespace-nowrap font-normal md:font-medium text-2xl sm:text-3xl md:text-4xl tracking-tight" style={{ color: tickColor }}>
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
                className={`trade-btn-sell h-[68px] bg-red-950/40 border border-red-500/50 rounded-lg flex flex-col items-stretch p-1 pt-0.5 cursor-pointer transition-colors active:bg-red-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 overflow-hidden ${opacityCls} ${transitionCls}`}
                aria-label={`Sell ${quote?.symbol} at ${bidStr}`}
              >
                <span className="text-[9px] font-bold tracking-widest text-white leading-none text-center py-0.5">Sell</span>
                <span className="flex-1 rounded-md flex flex-col items-center justify-center" style={{ background: '#0c0c0c' }}>
                  <span className={`${btnPriceCls} font-medium tabular-nums whitespace-nowrap leading-tight`} style={{ color: bidTickColor }}>
                    {bidStr}
                  </span>
                  {bidSizeStr && (
                    <span className="text-[9px] text-white font-semibold tabular-nums leading-none mt-1.5">Bid Size: {bidSizeStr}</span>
                  )}
                </span>
              </button>
              <button
                onClick={() => handleInitiateTrade('buy')}
                className={`trade-btn-buy h-[68px] bg-emerald-950/40 border border-emerald-500/50 rounded-lg flex flex-col items-stretch p-1 pt-0.5 cursor-pointer transition-colors active:bg-emerald-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 overflow-hidden ${opacityCls} ${transitionCls}`}
                aria-label={`Buy ${quote?.symbol} at ${askStr}`}
              >
                <span className="text-[9px] font-bold tracking-widest text-white leading-none text-center py-0.5">Buy</span>
                <span className="flex-1 rounded-md flex flex-col items-center justify-center" style={{ background: '#0c0c0c' }}>
                  <span className={`${btnPriceCls} font-medium tabular-nums whitespace-nowrap leading-tight`} style={{ color: askTickColor }}>
                    {askStr}
                  </span>
                  {askSizeStr && (
                    <span className="text-[9px] text-white font-semibold tabular-nums leading-none mt-1.5">Ask Size: {askSizeStr}</span>
                  )}
                </span>
              </button>
            </>
          ) : (
            <>
              <div className="h-[68px] border border-zinc-800/50 rounded-lg flex flex-col items-stretch p-1 pt-0.5">
                <span className="text-[9px] font-bold tracking-widest text-zinc-600 leading-none text-center py-0.5">Sell</span>
                <span className="flex-1 rounded-md flex flex-col items-center justify-center" style={{ background: '#0c0c0c' }}>
                  <span className="text-sm font-bold text-zinc-600 tabular-nums">—</span>
                </span>
              </div>
              <div className="h-[68px] border border-zinc-800/50 rounded-lg flex flex-col items-stretch p-1 pt-0.5">
                <span className="text-[9px] font-bold tracking-widest text-zinc-600 leading-none text-center py-0.5">Buy</span>
                <span className="flex-1 rounded-md flex flex-col items-center justify-center" style={{ background: '#0c0c0c' }}>
                  <span className="text-sm font-bold text-zinc-600 tabular-nums">—</span>
                </span>
              </div>
            </>
          )}
        </div>

      </div>

      <div className="hidden sm:flex items-center gap-6 mt-2 pt-2 border-t border-zinc-800/60">
        <div className="flex flex-col shrink-0 gap-0.5">
          <span className="text-[10px] tracking-[0.1em] text-zinc-500 font-semibold">Volume</span>
          <span className={`font-mono tabular-nums text-zinc-300 text-sm font-medium ${opacityCls} ${transitionCls}`}>
            {fmtVol(quote?.volume ?? null)}
          </span>
        </div>

        <div className="w-px h-8 bg-zinc-800 shrink-0 hidden md:block" />

        <div className="hidden md:flex flex-col shrink-0 gap-0.5">
          <span className="text-[10px] tracking-[0.1em] text-zinc-500 font-semibold">Day Range</span>
          <span className={`font-mono tabular-nums text-sm font-medium ${opacityCls} ${transitionCls}`}>
            <span style={{ color: DOWN_COLOR }}>${fmtPrice(quote?.low ?? null)}</span>
            <span className="text-zinc-600 mx-1">—</span>
            <span style={{ color: UP_COLOR }}>${fmtPrice(quote?.high ?? null)}</span>
          </span>
        </div>

        <div className="w-px h-8 bg-zinc-800 shrink-0 hidden lg:block" />

        <div className="hidden lg:flex flex-col shrink-0 gap-0.5">
          <span className="text-[10px] tracking-[0.1em] text-zinc-500 font-semibold">52W Range</span>
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
