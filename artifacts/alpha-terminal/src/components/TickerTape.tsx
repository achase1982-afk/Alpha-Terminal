import { useTerminalStore } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";

// Task 2: Strict conditional formatting — change < 0 → Red, > 0 → Green, flat → gray
const UP_COLOR   = "#00E676";
const DOWN_COLOR = "#FF1744";
const FLAT_COLOR = "#6B7280";

function TapeItem({ symbol }: { symbol: string }) {
  const { accessToken, setSymbol } = useTerminalStore();
  const { data } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken, refetchInterval: 30000, staleTime: 20000 } }
  );

  // Strict: use the dollar change value, not the percentage
  const netChange  = data?.change ?? 0;
  const changePct  = data?.changePct ?? 0;
  const isUp   = netChange > 0;
  const isDown = netChange < 0;
  const color  = isDown ? DOWN_COLOR : isUp ? UP_COLOR : FLAT_COLOR;

  return (
    <button
      onClick={() => setSymbol(symbol)}
      className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap cursor-pointer
        hover:brightness-125 transition-all duration-150 group"
      style={{ fontSize: "13px" }}   /* 25% larger than the previous 10px base */
    >
      {/* Symbol — slightly dimmed, brightens on hover */}
      <span className="font-mono font-semibold tracking-wider text-gray-400 group-hover:text-white transition-colors">
        {symbol}
      </span>

      {data?.last != null ? (
        <>
          <span className="font-mono font-bold tabular-nums" style={{ color }}>
            {data.last.toFixed(2)}
          </span>
          <span className="font-mono font-bold tabular-nums" style={{ color }}>
            {isDown ? "▼" : isUp ? "▲" : "—"}
            {" "}{Math.abs(changePct).toFixed(2)}%
          </span>
        </>
      ) : (
        /* Not yet loaded — show a neutral placeholder */
        <span className="font-mono text-gray-700">—</span>
      )}

      <span className="text-gray-800 mx-0.5 select-none">•</span>
    </button>
  );
}

export function TickerTape() {
  const { tickerTapeSymbols } = useTerminalStore();
  if (!tickerTapeSymbols.length) return null;

  // Triplicate for a gap-free infinite loop
  const items = [...tickerTapeSymbols, ...tickerTapeSymbols, ...tickerTapeSymbols];

  return (
    <div
      className="border-b border-card-border overflow-hidden relative shrink-0 flex items-center"
      style={{ height: "32px", background: "#060A10" }}
    >
      {/* Edge fades */}
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
