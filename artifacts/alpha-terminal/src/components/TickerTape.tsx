import { memo, useEffect, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote }         from "@/hooks/useQuote";

const UP_COLOR   = "#00E676";
const DOWN_COLOR = "#FF1744";
const FLAT_COLOR = "#6B7280";

// Memoized so it only re-renders when its own quote data changes,
// not when other symbols update or store-wide state changes.
const TapeItem = memo(function TapeItem({ symbol }: { symbol: string }) {
  // Use a pinpoint selector so this item doesn't re-render on unrelated store changes
  const setSymbol = useTerminalStore(s => s.setSymbol);
  const { data }  = useQuote(symbol);

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
      <span className="font-semibold tracking-wider text-gray-300 group-hover:text-white transition-colors">
        {symbol}
      </span>

      {data?.last != null ? (
        <>
          <span className="font-bold tabular-nums" style={{ color }}>
            {data.last.toFixed(2)}
          </span>
          <span className="font-bold tabular-nums" style={{ color }}>
            {arrow} {pct ?? "—"}
          </span>
        </>
      ) : (
        <span className="text-gray-700">—</span>
      )}

      <span className="text-gray-800 mx-0.5 select-none">•</span>
    </button>
  );
});

// Separate inner component so the animated div never re-renders due to speed changes —
// we write the duration directly to the DOM via a ref instead.
const TapeTrack = memo(function TapeTrack({ symbols }: { symbols: string[] }) {
  const trackRef  = useRef<HTMLDivElement>(null);
  const tapeSpeed = useTerminalStore(s => s.tapeSpeed);

  // Write duration directly to the DOM element — no React re-render needed.
  // This keeps the GPU animation running without interruption.
  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.style.animationDuration = `${tapeSpeed}s`;
    }
  }, [tapeSpeed]);

  const items = [...symbols, ...symbols, ...symbols];

  return (
    <div ref={trackRef} className="flex items-center ticker-scroll">
      {items.map((sym, i) => (
        <TapeItem key={`${sym}-${i}`} symbol={sym} />
      ))}
    </div>
  );
});

export function TickerTape() {
  // Pinpoint selectors — this component only re-renders if the symbol list changes,
  // not on every streaming price tick.
  const tickerTapeSymbols = useTerminalStore(s => s.tickerTapeSymbols);
  if (!tickerTapeSymbols.length) return null;

  return (
    <div
      className="border-b border-card-border overflow-hidden relative shrink-0 flex items-center"
      style={{ height: "32px", background: "#060A10" }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to right, #060A10, transparent)" }} />
      <div className="absolute right-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to left, #060A10, transparent)" }} />

      <TapeTrack symbols={tickerTapeSymbols} />
    </div>
  );
}
