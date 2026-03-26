import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { TrendingUp, TrendingDown } from "lucide-react";

// Fear symbols: rising = bad = red (inverse color logic)
const FEAR_SYMBOLS = new Set(["VIX", "VXN"]);
const INDEX_SYMS   = new Set(["VIX", "SPX", "NDX", "RUT", "DJI", "COMP", "DXY", "TNX"]);

function MacroCard({ symbol }: { symbol: string }) {
  const { accessToken, symbol: activeSymbol, setSymbol } = useTerminalStore();
  const { data, isLoading } = useQuote(symbol);

  const isActive   = activeSymbol === symbol;
  const change     = data?.change ?? 0;
  const isPositive = change > 0;
  const isNeg      = change < 0;
  const isFear     = FEAR_SYMBOLS.has(symbol.toUpperCase());
  const isIndex    = INDEX_SYMS.has(symbol.toUpperCase());

  // Fear symbols invert: rising VIX = red, falling = green
  const colorClass = isFear
    ? (isPositive ? "text-destructive" : isNeg ? "text-primary" : "text-muted-foreground")
    : (isPositive ? "text-primary"     : isNeg ? "text-destructive" : "text-muted-foreground");

  return (
    <button
      onClick={() => setSymbol(symbol)}
      className={`
        flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg border min-w-0
        transition-all duration-200 group cursor-pointer
        ${isActive
          ? "border-primary/60 bg-primary/10 shadow-[0_0_12px_rgba(0,212,170,0.15)]"
          : "border-card-border bg-card hover:border-primary/30 hover:bg-primary/5"}
      `}
    >
      <span className={`font-mono text-[9px] sm:text-[10px] font-bold tracking-widest truncate w-full text-center transition-colors
        ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {symbol}
      </span>

      {!accessToken || (isLoading && !data) ? (
        <span className="font-mono text-sm font-bold text-muted-foreground/40">—</span>
      ) : (
        <>
          <span className={`font-mono text-sm sm:text-base font-black tabular-nums ${colorClass}`}>
            {data?.last != null
              ? (isIndex ? data.last.toFixed(2) : `$${data.last.toFixed(2)}`)
              : "—"}
          </span>
          <span className={`font-mono text-[9px] sm:text-[10px] flex items-center gap-0.5 tabular-nums ${colorClass}`}>
            {isPositive
              ? <TrendingUp  className="w-2.5 h-2.5 shrink-0" />
              : <TrendingDown className="w-2.5 h-2.5 shrink-0" />}
            {data?.changePct != null
              ? `${isPositive ? "+" : ""}${data.changePct.toFixed(2)}%`
              : "—"}
          </span>
        </>
      )}
    </button>
  );
}

export function MacroBar() {
  const { macroSymbols } = useTerminalStore();
  return (
    <div className="flex items-stretch gap-1.5 sm:gap-2 px-3 py-2 border-b border-card-border bg-[#0D1117]/90 shrink-0">
      {macroSymbols.slice(0, 6).map(sym => (
        <MacroCard key={sym} symbol={sym} />
      ))}
    </div>
  );
}
