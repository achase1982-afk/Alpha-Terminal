import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const FEAR_SYMBOLS = new Set(["VIX", "VXN"]);
const INDEX_SYMS   = new Set(["VIX", "SPX", "NDX", "RUT", "DJI", "COMP", "DXY", "TNX"]);

const UP_COLOR   = "#00E676";
const DOWN_COLOR = "#FF1744";
const FLAT_COLOR = "#6B7280";

function formatPct(pct: number | null | undefined, isUp: boolean): string {
  if (pct == null) return "—%";
  const sign = isUp ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function MacroCard({ symbol }: { symbol: string }) {
  const { accessToken, symbol: activeSymbol, setSymbol } = useTerminalStore();
  const { data, isLoading } = useQuote(symbol);

  const isActive = activeSymbol === symbol;
  const change   = data?.change ?? null;

  // Strict three-way: up / down / flat
  const isUp   = change !== null && change > 0;
  const isDown = change !== null && change < 0;
  const isFlat = !isUp && !isDown;

  const isFear  = FEAR_SYMBOLS.has(symbol.toUpperCase());
  const isIndex = INDEX_SYMS.has(symbol.toUpperCase());

  // Fear symbols invert color semantics (VIX up = danger = red)
  let priceColor: string;
  if (isFlat || change === null) {
    priceColor = FLAT_COLOR;
  } else if (isFear) {
    priceColor = isUp ? DOWN_COLOR : UP_COLOR;
  } else {
    priceColor = isUp ? UP_COLOR : DOWN_COLOR;
  }

  const ChgIcon = isUp
    ? <TrendingUp  className="w-2.5 h-2.5 shrink-0" />
    : isDown
      ? <TrendingDown className="w-2.5 h-2.5 shrink-0" />
      : <Minus className="w-2.5 h-2.5 shrink-0" />;

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
          {/* Last price */}
          <span
            className="font-mono text-sm sm:text-base font-black tabular-nums"
            style={{ color: priceColor }}
          >
            {data?.last != null
              ? (isIndex ? data.last.toFixed(2) : `$${data.last.toFixed(2)}`)
              : "—"}
          </span>

          {/* Change % row */}
          <span
            className="font-mono text-[9px] sm:text-[10px] flex items-center gap-0.5 tabular-nums"
            style={{ color: priceColor }}
          >
            {ChgIcon}
            {data?.changePct != null
              ? formatPct(data.changePct, isUp)
              : "—%"}
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
