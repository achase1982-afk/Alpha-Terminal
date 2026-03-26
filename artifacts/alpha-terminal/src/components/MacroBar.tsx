import { useGetQuote } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";
import { TrendingUp, TrendingDown } from "lucide-react";

// Symbols that use inverted color logic (rising = fear = red)
const FEAR_SYMBOLS = new Set(["VIX", "VXN"]);

function MacroCard({ symbol }: { symbol: string }) {
  const { accessToken, symbol: activeSymbol, setSymbol } = useTerminalStore();
  const { data, isLoading } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken, refetchInterval: 15000, staleTime: 10000 } }
  );

  const isActive = activeSymbol === symbol;
  const change = data?.change ?? 0;
  const isPositive = change >= 0;
  const isFear = FEAR_SYMBOLS.has(symbol.toUpperCase());

  // For fear symbols: up = red, down = green
  const changeColor = isFear
    ? (isPositive ? "text-destructive" : "text-primary")
    : (isPositive ? "text-primary" : "text-destructive");

  const isIndex = symbol === "VIX" || symbol === "SPX" || symbol === "NDX" || symbol === "RUT" || symbol === "DJI";

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
          <span className={`font-mono text-sm sm:text-base font-black tabular-nums
            ${isFear ? "text-foreground" : (isPositive ? "text-primary" : "text-destructive")}`}>
            {data?.last != null
              ? (isIndex ? data.last.toFixed(2) : `$${data.last.toFixed(2)}`)
              : "—"}
          </span>
          <span className={`font-mono text-[9px] sm:text-[10px] flex items-center gap-0.5 tabular-nums ${changeColor}`}>
            {isPositive
              ? <TrendingUp className="w-2.5 h-2.5 shrink-0" />
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
