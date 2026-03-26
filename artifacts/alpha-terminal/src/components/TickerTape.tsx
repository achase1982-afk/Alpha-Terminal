import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";

const UP_COLOR   = "#00E676";
const DOWN_COLOR = "#FF1744";
const FLAT_COLOR = "#6B7280";

function TapeItem({ symbol }: { symbol: string }) {
  const { setSymbol } = useTerminalStore();
  const { data }      = useQuote(symbol);

  // Strict null-aware direction
  const rawChange = data?.change ?? null;
  const isUp      = rawChange !== null && rawChange > 0;
  const isDown    = rawChange !== null && rawChange < 0;
  const color     = isDown ? DOWN_COLOR : isUp ? UP_COLOR : FLAT_COLOR;
  const arrow     = isDown ? "▼" : isUp ? "▲" : "—";
  const pct       = data?.changePct != null ? Math.abs(data.changePct).toFixed(2) + "%" : null;

  return (
    <button
      onClick={() => setSymbol(symbol)}
      className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap cursor-pointer
        hover:brightness-125 transition-all duration-150 group"
      style={{ fontSize: "13px" }}
    >
      {/* Symbol — lighter gray for clear readability */}
      <span className="font-mono font-semibold tracking-wider text-gray-300 group-hover:text-white transition-colors">
        {symbol}
      </span>

      {data?.last != null ? (
        <>
          <span className="font-mono font-bold tabular-nums" style={{ color }}>
            {data.last.toFixed(2)}
          </span>
          <span className="font-mono font-bold tabular-nums" style={{ color }}>
            {arrow} {pct ?? "—"}
          </span>
        </>
      ) : (
        <span className="font-mono text-gray-700">—</span>
      )}

      <span className="text-gray-800 mx-0.5 select-none">•</span>
    </button>
  );
}

export function TickerTape() {
  const { tickerTapeSymbols } = useTerminalStore();
  if (!tickerTapeSymbols.length) return null;

  // Triple for seamless infinite CSS loop
  const items = [...tickerTapeSymbols, ...tickerTapeSymbols, ...tickerTapeSymbols];

  return (
    <div
      className="border-b border-card-border overflow-hidden relative shrink-0 flex items-center"
      style={{ height: "32px", background: "#060A10" }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to right, #060A10, transparent)" }} />
      <div className="absolute right-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to left, #060A10, transparent)" }} />

      <div
        className="flex items-center"
        style={{ width: "max-content", animation: "ticker-scroll 55s linear infinite" }}
      >
        {items.map((sym, i) => (
          <TapeItem key={`${sym}-${i}`} symbol={sym} />
        ))}
      </div>
    </div>
  );
}
