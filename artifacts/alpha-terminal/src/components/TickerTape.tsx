import { memo, useEffect, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";

const UP_COLOR   = "#00E676";
const DOWN_COLOR = "#FF1744";
const FLAT_COLOR = "#6B7280";

const TapeItem = memo(function TapeItem({ symbol }: { symbol: string }) {
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

// Drives scrolling via requestAnimationFrame — no CSS keyframe reset = no flash ever.
function TapeTrack({ symbols }: { symbols: string[] }) {
  const trackRef  = useRef<HTMLDivElement>(null);
  const posRef    = useRef(0);          // current scroll offset in px
  const rafRef    = useRef<number>(0);  // animation frame handle
  const pausedRef = useRef(false);      // hover pause

  // Read speed live from store via ref so the RAF loop sees changes instantly
  // without needing to restart.
  const tapeSpeed = useTerminalStore(s => s.tapeSpeed);
  const speedRef  = useRef(tapeSpeed);
  useEffect(() => { speedRef.current = tapeSpeed; }, [tapeSpeed]);

  // Three copies for seamless wrap — same symbol list repeated 3x.
  const items = [...symbols, ...symbols, ...symbols];

  useEffect(() => {
    // Reset position whenever the symbol list changes (track DOM rebuilt).
    posRef.current = 0;

    const track = trackRef.current;
    if (!track) return;

    const tick = () => {
      if (!pausedRef.current) {
        // singleWidth = width of one copy of the symbol list.
        const singleWidth = track.scrollWidth / 3;

        if (singleWidth > 0) {
          // Pixels per frame based on desired seconds-per-pass at ~60fps.
          const pxPerFrame = singleWidth / (speedRef.current * 60);
          posRef.current  += pxPerFrame;

          // When we've scrolled exactly one copy's width, silently wrap.
          // The visual looks identical at this point — no flash.
          if (posRef.current >= singleWidth) {
            posRef.current -= singleWidth;
          }

          track.style.transform = `translateX(-${posRef.current}px)`;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [symbols]);

  return (
    <div
      ref={trackRef}
      style={{ width: "max-content", willChange: "transform", transform: "translateZ(0)" }}
      className="flex items-center"
      onMouseEnter={() => { pausedRef.current = true;  }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      {items.map((sym, i) => (
        <TapeItem key={`${sym}-${i}`} symbol={sym} />
      ))}
    </div>
  );
}

export function TickerTape() {
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
