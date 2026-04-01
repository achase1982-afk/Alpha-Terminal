import React, { useState, useRef, useCallback, useEffect } from "react";
import { Newspaper, BarChart2, Building2, LineChart } from "lucide-react";

export type MarketDataTab = "news" | "options" | "company" | "chart";

const TAB_DEFS: Record<MarketDataTab, { label: string; icon: React.ReactNode }> = {
  news:    { label: "NEWS",    icon: <Newspaper className="w-4 h-4" /> },
  options: { label: "OPTIONS", icon: <BarChart2 className="w-4 h-4" /> },
  company: { label: "COMPANY", icon: <Building2 className="w-4 h-4" /> },
  chart:   { label: "CHART",   icon: <LineChart className="w-4 h-4" /> },
};

const DEFAULT_ORDER: MarketDataTab[] = ["news", "options", "company", "chart"];
const STORAGE_KEY = "alphaTerminalTabOrder";
const LONG_PRESS_MS = 500;

function loadOrder(): MarketDataTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MarketDataTab[];
      if (
        Array.isArray(parsed) &&
        parsed.length === DEFAULT_ORDER.length &&
        DEFAULT_ORDER.every((t) => parsed.includes(t))
      ) {
        return parsed;
      }
    }
  } catch {}
  return [...DEFAULT_ORDER];
}

interface MarketDataTabsProps {
  activeTab: MarketDataTab;
  setActiveTab: (tab: MarketDataTab) => void;
}

export function MarketDataTabs({ activeTab, setActiveTab }: MarketDataTabsProps) {
  const [order, setOrder] = useState<MarketDataTab[]>(loadOrder);
  const [jiggling, setJiggling] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX = useRef(0);
  const touchStartIdx = useRef<number | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const saveOrder = useCallback((newOrder: MarketDataTab[]) => {
    setOrder(newOrder);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(
    (idx: number, e: React.TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartIdx.current = idx;
      longPressTimer.current = setTimeout(() => {
        setJiggling(true);
        setDragIdx(idx);
        if (navigator.vibrate) navigator.vibrate(30);
      }, LONG_PRESS_MS);
    },
    []
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!jiggling || dragIdx === null) {
        const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
        if (dx > 10) cancelLongPress();
        return;
      }

      const x = e.touches[0].clientX;
      const container = containerRef.current;
      if (!container) return;

      let closestIdx = dragIdx;
      let closestDist = Infinity;
      tabRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(x - center);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      });

      setDragOverIdx(closestIdx);
    },
    [jiggling, dragIdx, cancelLongPress]
  );

  const handleTouchEnd = useCallback(() => {
    cancelLongPress();

    if (jiggling && dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      const newOrder = [...order];
      const [moved] = newOrder.splice(dragIdx, 1);
      newOrder.splice(dragOverIdx, 0, moved);
      saveOrder(newOrder);
    }

    setDragIdx(null);
    setDragOverIdx(null);
  }, [jiggling, dragIdx, dragOverIdx, order, cancelLongPress, saveOrder]);

  useEffect(() => {
    if (!jiggling) return;

    const handler = (e: TouchEvent | MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const target = e.target as Node;
      if (!container.contains(target)) {
        setJiggling(false);
        setDragIdx(null);
        setDragOverIdx(null);
      }
    };

    document.addEventListener("touchstart", handler);
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("mousedown", handler);
    };
  }, [jiggling]);

  const displayOrder =
    jiggling && dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx
      ? (() => {
          const preview = [...order];
          const [moved] = preview.splice(dragIdx, 1);
          preview.splice(dragOverIdx, 0, moved);
          return preview;
        })()
      : order;

  return (
    <nav
      className="sticky z-30 w-full bg-[#1a1a1a] border-b border-card-border/50 p-0 m-0"
      style={{ top: "72px" }}
    >
      <style>{`
        @keyframes tab-jiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-1.5deg); }
          75% { transform: rotate(1.5deg); }
        }
        .tab-jiggle { animation: tab-jiggle 0.25s ease-in-out infinite; }
      `}</style>
      <div
        ref={containerRef}
        className="flex w-full items-stretch p-0 border-t border-card-border/20"
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {displayOrder.map((tabId, i) => {
          const tab = TAB_DEFS[tabId];
          const isActive = activeTab === tabId;
          const isDragging = jiggling && dragIdx !== null && order[dragIdx] === tabId;

          return (
            <React.Fragment key={tabId}>
              {i > 0 && (
                <div className="w-px self-stretch my-1.5 bg-zinc-700/30" />
              )}
              <button
                ref={(el) => { tabRefs.current[i] = el; }}
                onClick={() => {
                  if (!jiggling) setActiveTab(tabId);
                }}
                onTouchStart={(e) => handleTouchStart(i, e)}
                className={`flex flex-1 items-center justify-center gap-2 py-2.5 transition-all border-b-2 select-none ${
                  isActive
                    ? "border-primary text-white"
                    : "border-transparent text-zinc-500"
                } ${jiggling ? "tab-jiggle" : ""} ${isDragging ? "opacity-60 scale-95" : ""}`}
                style={jiggling ? { animationDelay: `${i * 60}ms` } : undefined}
              >
                {tab.icon}
                <span className="text-[10px] font-medium tracking-widest uppercase">
                  {tab.label}
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}
