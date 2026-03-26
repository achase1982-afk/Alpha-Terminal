import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const FEAR_SYMBOLS = new Set(["VIX", "VXN"]);
const INDEX_SYMS   = new Set(["VIX", "SPX", "NDX", "RUT", "DJI", "COMP", "DXY", "TNX"]);

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

  const isActive = activeSymbol === symbol;
  const change   = data?.change ?? null;

  const isUp   = change !== null && change > 0;
  const isDown = change !== null && change < 0;
  const isFlat = !isUp && !isDown;

  const isFear  = FEAR_SYMBOLS.has(symbol.toUpperCase());
  const isIndex = INDEX_SYMS.has(symbol.toUpperCase());

  let priceColor: string;
  if (isFlat || change === null) {
    priceColor = FLAT_COLOR;
  } else if (isFear) {
    priceColor = isUp ? DOWN_COLOR : UP_COLOR;
  } else {
    priceColor = isUp ? UP_COLOR : DOWN_COLOR;
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
      {/* Symbol — 1.1rem, 700, white; blue when active */}
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
          {/* Price — mono, weight 400, thin and crisp */}
          <span
            className="font-mono tabular-nums"
            style={{ color: priceColor, fontSize: '0.9rem', fontWeight: 400 }}
          >
            {data?.last != null
              ? (isIndex ? data.last.toFixed(2) : `$${data.last.toFixed(2)}`)
              : "—"}
          </span>

          {/* Change % — mono, normal weight (400) for clean contrast */}
          <span
            className="font-mono tabular-nums flex items-center gap-0.5"
            style={{ color: priceColor, fontSize: '0.72rem', fontWeight: 400 }}
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
    <div className="flex items-stretch gap-2 px-3 py-2 border-b border-card-border bg-[#0D1117]/90 shrink-0">
      {macroSymbols.slice(0, 6).map(sym => (
        <MacroCard key={sym} symbol={sym} />
      ))}
    </div>
  );
}
