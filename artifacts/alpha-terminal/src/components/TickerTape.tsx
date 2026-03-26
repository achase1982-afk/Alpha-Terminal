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
  const colorClass = isUp ? "text-primary" : "text-destructive";

  return (
    <button
      onClick={() => setSymbol(symbol)}
      className="inline-flex items-center gap-2 px-4 whitespace-nowrap group hover:opacity-80 transition-opacity cursor-pointer"
    >
      <span className="font-mono text-[10px] font-bold text-muted-foreground group-hover:text-foreground transition-colors">
        {symbol}
      </span>
      {data?.last != null && (
        <>
          <span className={`font-mono text-[10px] font-semibold ${colorClass}`}>
            {data.last.toFixed(2)}
          </span>
          <span className={`font-mono text-[9px] ${colorClass}`}>
            {isUp ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
          </span>
        </>
      )}
      <span className="text-card-border mx-1 select-none text-[10px]">|</span>
    </button>
  );
}

export function TickerTape() {
  const { tickerTapeSymbols } = useTerminalStore();

  if (!tickerTapeSymbols.length) return null;

  // Duplicate for seamless infinite loop
  const items = [...tickerTapeSymbols, ...tickerTapeSymbols];

  return (
    <div className="h-7 bg-[#0A0F16] border-b border-card-border overflow-hidden relative shrink-0 flex items-center">
      <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-[#0A0F16] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-[#0A0F16] to-transparent z-10 pointer-events-none" />
      <div
        className="flex"
        style={{
          width: "max-content",
          animation: "ticker-scroll 40s linear infinite",
        }}
      >
        {items.map((sym, i) => (
          <TapeItem key={`${sym}-${i}`} symbol={sym} />
        ))}
      </div>
    </div>
  );
}
