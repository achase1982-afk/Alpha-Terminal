import { useState, useRef, useCallback } from "react";
import { CompanyResearchHub } from "@/components/CompanyResearchHub";
import { InstitutionalDashboard } from "@/components/InstitutionalDashboard";
import { TechnicalAnalysisPage } from "@/components/TechnicalAnalysisPage";

interface Candle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  candles?: Candle[];
  stickyOffset?: number;
}

const PAGE_LABELS = ["Research", "Institutional", "Technical"];

export function CompanySwipablePages({ candles, stickyOffset = 0 }: Props) {
  const [page, setPage] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);
  const locked = useRef<"h" | "v" | null>(null);
  const dragDelta = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swiping.current = true;
    locked.current = null;
    dragDelta.current = 0;
    setDragOffset(0);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    if (!locked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
    }

    if (locked.current === "h") {
      e.preventDefault();
      let clamped = dx;
      if ((page === 0 && dx > 0) || (page === PAGE_LABELS.length - 1 && dx < 0)) {
        clamped = dx * 0.3;
      }
      dragDelta.current = clamped;
      setDragOffset(clamped);
    }
  }, [page]);

  const finishSwipe = useCallback(() => {
    if (!swiping.current) return;
    swiping.current = false;
    const threshold = 60;
    const delta = dragDelta.current;
    if (locked.current === "h") {
      if (delta < -threshold && page < PAGE_LABELS.length - 1) {
        setPage(p => p + 1);
      } else if (delta > threshold && page > 0) {
        setPage(p => p - 1);
      }
    }
    locked.current = null;
    dragDelta.current = 0;
    setDragOffset(0);
  }, [page]);

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center justify-center gap-3 py-2 border-b border-[#2a2a2c] z-30 bg-background"
        style={{ position: "sticky", top: stickyOffset }}
      >
        {PAGE_LABELS.map((label, i) => (
          <button
            key={label}
            onClick={() => setPage(i)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[10px] tracking-wider transition-all"
            style={{
              background: page === i ? "#FFB80015" : "transparent",
              border: `1px solid ${page === i ? "#FFB80040" : "#2a2a2c"}`,
              color: page === i ? "#FFB800" : "#71717a",
            }}
          >
            {label}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-2">
          {PAGE_LABELS.map((_, i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{ background: page === i ? "#FFB800" : "#3a3a3c" }}
            />
          ))}
        </div>
      </div>

      <div
        className="overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={finishSwipe}
        onTouchCancel={finishSwipe}
      >
        <div
          className="flex"
          style={{
            transform: `translateX(calc(${-page * 100}% + ${dragOffset}px))`,
            transition: swiping.current ? "none" : "transform 0.3s ease-out",
            willChange: "transform",
          }}
        >
          <div className="w-full shrink-0">
            <CompanyResearchHub candles={candles} />
          </div>
          <div className="w-full shrink-0">
            <InstitutionalDashboard candles={candles} />
          </div>
          <div className="w-full shrink-0">
            <TechnicalAnalysisPage candles={candles} />
          </div>
        </div>
      </div>
    </div>
  );
}
