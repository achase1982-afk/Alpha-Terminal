import { useGetQuote } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";
import { TrendingUp, TrendingDown } from "lucide-react";

const MACRO_SYMBOLS = ["SPY", "QQQ", "IWM", "VIX"] as const;

function MacroCard({ symbol }: { symbol: string }) {
  const { accessToken, symbol: activeSymbol, setSymbol } = useTerminalStore();
  const { data, isLoading } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken, refetchInterval: 15000, staleTime: 10000 } }
  );

  const isActive = activeSymbol === symbol;
  const change = data?.change ?? 0;
  const isPositive = change >= 0;
  const priceColor = isPositive ? "text-primary" : "text-destructive";
  const isVix = symbol === "VIX";

  return (
    <button
      onClick={() => setSymbol(symbol)}
      className={`
        flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg border
        transition-all duration-200 group cursor-pointer
        ${isActive
          ? "border-primary/60 bg-primary/10 shadow-[0_0_12px_rgba(0,212,170,0.15)]"
          : "border-card-border bg-card hover:border-primary/30 hover:bg-primary/5"}
      `}
    >
      <span className={`font-mono text-[10px] font-bold tracking-widest transition-colors
        ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {symbol}
      </span>

      {!accessToken || (isLoading && !data) ? (
        <span className="font-mono text-sm font-bold text-muted-foreground/40">—</span>
      ) : (
        <>
          <span className={`font-mono text-sm sm:text-base font-black tabular-nums ${isVix ? "text-foreground" : priceColor}`}>
            {data?.last != null ? (isVix ? data.last.toFixed(2) : `$${data.last.toFixed(2)}`) : "—"}
          </span>
          <span className={`font-mono text-[9px] sm:text-[10px] flex items-center gap-0.5 tabular-nums
            ${isVix ? (isPositive ? "text-destructive" : "text-primary") : priceColor}`}>
            {isPositive
              ? <TrendingUp className="w-2.5 h-2.5" />
              : <TrendingDown className="w-2.5 h-2.5" />}
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
  return (
    <div className="flex items-stretch gap-2 px-3 py-2 border-b border-card-border bg-[#0D1117]/90 shrink-0">
      {MACRO_SYMBOLS.map(sym => (
        <MacroCard key={sym} symbol={sym} />
      ))}
    </div>
  );
}
