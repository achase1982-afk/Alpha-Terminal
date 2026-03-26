import { useTerminalStore } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";

function TapeItem({ symbol }: { symbol: string }) {
  const { accessToken, setSymbol } = useTerminalStore();
  const { data } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken, refetchInterval: 30000, staleTime: 20000 } }
  );

  const changePct = data?.changePct ?? 0;
  const isUp = changePct >= 0;

  // Task 1: Bold red/green based on direction — 25% larger font (base was ~10px → now 13px)
  const textColor = isUp ? "#00E676" : "#FF1744";

  return (
    <button
      onClick={() => setSymbol(symbol)}
      className="inline-flex items-center gap-2 px-4 whitespace-nowrap cursor-pointer
        hover:brightness-125 transition-all duration-150 group"
      style={{ fontSize: "13px" }}
    >
      <span className="font-mono font-bold tracking-wider text-gray-300 group-hover:text-white transition-colors">
        {symbol}
      </span>

      {data?.last != null ? (
        <>
          <span className="font-mono font-bold tabular-nums" style={{ color: textColor }}>
            {data.last.toFixed(2)}
          </span>
          <span className="font-mono font-bold tabular-nums" style={{ color: textColor }}>
            {isUp ? "▲" : "▼"}&nbsp;{Math.abs(changePct).toFixed(2)}%
          </span>
        </>
      ) : (
        <span className="font-mono text-gray-600">—</span>
      )}

      <span className="text-gray-700 mx-1 select-none">•</span>
    </button>
  );
}

export function TickerTape() {
  const { tickerTapeSymbols } = useTerminalStore();
  if (!tickerTapeSymbols.length) return null;

  // Triplicate for a fully seamless loop at any viewport width
  const items = [...tickerTapeSymbols, ...tickerTapeSymbols, ...tickerTapeSymbols];

  return (
    <div
      className="border-b border-card-border overflow-hidden relative shrink-0 flex items-center"
      style={{ height: "30px", background: "#060A10" }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to right, #060A10, transparent)" }} />
      <div className="absolute right-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to left, #060A10, transparent)" }} />

      <div
        className="flex items-center"
        style={{
          width: "max-content",
          animation: "ticker-scroll 55s linear infinite",
        }}
      >
        {items.map((sym, i) => (
          <TapeItem key={`${sym}-${i}`} symbol={sym} />
        ))}
      </div>
    </div>
  );
}
