import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { useTickColor }     from "@/hooks/useTickColor";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const FEAR_SYMBOLS = new Set(["VIX", "$VIX", "VXN", "$VXN"]);
const INDEX_SYMS   = new Set(["VIX", "$VIX", "SPX", "$SPX", "NDX", "$NDX", "RUT", "$RUT", "DJI", "$DJI", "COMP", "$COMP", "DXY", "$DXY", "TNX", "$TNX"]);

const UP_COLOR   = "#00E676";
const DOWN_COLOR = "#FF1744";
const FLAT_COLOR = "#6B7280";
const ACTIVE_GLOW = "rgba(0, 166, 255, 0.15)";

function formatPct(pct: number | null | undefined, isUp: boolean): string {
  if (pct == null) return "—%";
  return `${isUp ? "+" : ""}${pct.toFixed(2)}%`;
}

function MacroCard({ symbol }: { symbol: string }) {
  const { accessToken, symbol: activeSymbol, setSymbol } = useTerminalStore();
  const { data, isLoading } = useQuote(symbol);
  const tickColor = useTickColor(symbol, data?.last ?? null);

  const isActive = activeSymbol === symbol;
  const change   = data?.change ?? null;

  const isUp   = change !== null && change > 0;
  const isDown = change !== null && change < 0;
  const isFlat = !isUp && !isDown;

  const upper   = symbol.toUpperCase();
  const isFear  = FEAR_SYMBOLS.has(upper);
  const isIndex = INDEX_SYMS.has(upper) || upper.startsWith("/") || upper.startsWith("$");

  let changeColor: string;
  if (isFlat || change === null) {
    changeColor = FLAT_COLOR;
  } else if (isFear) {
    changeColor = isUp ? DOWN_COLOR : UP_COLOR;
  } else {
    changeColor = isUp ? UP_COLOR : DOWN_COLOR;
  }

  const ChgIcon = isUp
    ? <TrendingUp  className="w-3 h-3 shrink-0" />
    : isDown
      ? <TrendingDown className="w-3 h-3 shrink-0" />
      : <Minus className="w-3 h-3 shrink-0" />;

  return (
    <button
      onClick={() => setSymbol(symbol)}
      className={`
        flex-1 flex flex-col items-center justify-center gap-1 py-2.5 px-2 rounded-lg border min-w-0
        transition-all duration-200 group cursor-pointer
        ${isActive
          ? "border-primary/60 bg-primary/10"
          : "border-card-border bg-card hover:border-primary/30 hover:bg-primary/5"}
      `}
      style={isActive ? { boxShadow: `0 0 12px ${ACTIVE_GLOW}` } : undefined}
    >
      <span
        style={{
          fontSize: '1.1rem',
          fontWeight: 700,
          color: isActive ? 'var(--color-primary, #00A6FF)' : '#FFFFFF',
          letterSpacing: '0.04em',
          lineHeight: 1,
        }}
        className="macro-symbol-label truncate w-full text-center transition-colors"
      >
        {symbol}
      </span>

      {!accessToken || (isLoading && !data) ? (
        <span style={{ color: '#374151', fontSize: '0.85rem', fontWeight: 400 }}>—</span>
      ) : (
        <>
          <span
            className="tabular-nums"
            style={{ color: tickColor, fontSize: '0.9rem', fontWeight: 300 }}
          >
            {data?.last != null
              ? (isIndex ? data.last.toFixed(2) : `$${data.last.toFixed(2)}`)
              : "—"}
          </span>

          <span
            className="tabular-nums flex items-center gap-0.5"
            style={{ color: changeColor, fontSize: '0.72rem', fontWeight: 300 }}
          >
            {ChgIcon}
            {data?.changePct != null ? formatPct(data.changePct, isUp) : "—%"}
          </span>
        </>
      )}
    </button>
  );
}

export function MacroBar() {
  const { macroSymbols } = useTerminalStore();
  return (
    <div className="grid grid-cols-4 gap-1.5 px-2 py-2 border-b border-card-border bg-[#0D1117]/90 shrink-0">
      {macroSymbols.slice(0, 4).map(sym => (
        <MacroCard key={sym} symbol={sym} />
      ))}
    </div>
  );
}
