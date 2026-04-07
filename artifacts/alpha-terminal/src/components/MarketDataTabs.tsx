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
const LONG_PRESS_MS = 450;

function loadOrder(): MarketDataTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((t): t is MarketDataTab => t in TAB_DEFS);
        if (
          filtered.length === DEFAULT_ORDER.length &&
          DEFAULT_ORDER.every((t) => filtered.includes(t))
        ) return filtered;
      }
    }
  } catch {}
  localStorage.removeItem(STORAGE_KEY);
  return [...DEFAULT_ORDER];
}

function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

interface MarketDataTabsProps {
  activeTab: MarketDataTab;
  setActiveTab: (tab: MarketDataTab) => void;
}

export function MarketDataTabs({ activeTab, setActiveTab }: MarketDataTabsProps) {
  const [order, setOrder] = useState<MarketDataTab[]>(loadOrder);
  const [jiggling, setJiggling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragTabId, setDragTabId] = useState<MarketDataTab | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragOriginX, setDragOriginX] = useState(0);
  const [previewOrder, setPreviewOrder] = useState<MarketDataTab[]>([]);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchMoved = useRef(false);
  const tabRects = useRef<DOMRect[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartIdx = useRef(0);
  const jiggleStartedAt = useRef(0);
  const jigglingRef = useRef(false);
  const blockClicksUntil = useRef(0);
  const scrolling = useRef(false);

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

  const snapshotRects = useCallback(() => {
    tabRects.current = tabRefs.current.map(
      (el) => el?.getBoundingClientRect() ?? new DOMRect()
    );
  }, []);

  const startDrag = useCallback((idx: number, clientX: number) => {
    snapshotRects();
    const rect = tabRects.current[idx];
    if (!rect) return;

    jiggleStartedAt.current = Date.now();
    jigglingRef.current = true;
    setJiggling(true);
    setDragging(true);
    setDragTabId(order[idx]);
    setDragOriginX(rect.left + rect.width / 2);
    setDragX(clientX);
    setPreviewOrder([...order]);
    dragStartIdx.current = idx;
    if (navigator.vibrate) navigator.vibrate(40);
  }, [order, snapshotRects]);

  const handleTouchStart = useCallback(
    (idx: number, e: React.TouchEvent) => {
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      touchStartX.current = x;
      touchStartY.current = y;
      touchMoved.current = false;
      scrolling.current = false;

      if (jiggling) {
        startDrag(idx, x);
        return;
      }

      longPressTimer.current = setTimeout(() => {
        if (!scrolling.current) {
          startDrag(idx, x);
        }
      }, LONG_PRESS_MS);
    },
    [jiggling, startDrag]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;

      if (!dragging) {
        const dx = Math.abs(x - touchStartX.current);
        const dy = Math.abs(y - touchStartY.current);
        if (dy > 5) {
          scrolling.current = true;
          cancelLongPress();
          touchMoved.current = true;
        }
        if (dx > 8) {
          cancelLongPress();
          touchMoved.current = true;
        }
        return;
      }

      e.preventDefault();
      setDragX(x);

      let targetIdx = dragStartIdx.current;
      let closestDist = Infinity;
      tabRects.current.forEach((rect, i) => {
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(x - center);
        if (dist < closestDist) {
          closestDist = dist;
          targetIdx = i;
        }
      });

      const fromIdx = order.indexOf(dragTabId!);
      if (fromIdx !== -1 && targetIdx !== fromIdx) {
        const newPreview = reorder(order, fromIdx, targetIdx);
        setPreviewOrder(newPreview);
      } else {
        setPreviewOrder([...order]);
      }
    },
    [dragging, cancelLongPress, order, dragTabId]
  );

  const handleTouchEnd = useCallback(() => {
    cancelLongPress();

    if (dragging && dragTabId !== null) {
      const fromIdx = order.indexOf(dragTabId);
      let targetIdx = dragStartIdx.current;
      let closestDist = Infinity;
      tabRects.current.forEach((rect, i) => {
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(dragX - center);
        if (dist < closestDist) {
          closestDist = dist;
          targetIdx = i;
        }
      });

      if (fromIdx !== -1 && targetIdx !== fromIdx) {
        const newOrder = reorder(order, fromIdx, targetIdx);
        saveOrder(newOrder);
      }
    }

    jiggleStartedAt.current = Date.now();
    setDragging(false);
    setDragTabId(null);
    setPreviewOrder([]);
  }, [dragging, dragTabId, order, dragX, cancelLongPress, saveOrder]);

  const stopJiggle = useCallback(() => {
    jigglingRef.current = false;
    blockClicksUntil.current = Date.now() + 400;
    setJiggling(false);
    setDragging(false);
    setDragTabId(null);
    setPreviewOrder([]);
  }, []);

  useEffect(() => {
    const isGracePeriod = () => Date.now() - jiggleStartedAt.current < 500;

    const touchHandler = (e: TouchEvent | MouseEvent) => {
      if (!jigglingRef.current) return;
      if (isGracePeriod()) return;
      const container = containerRef.current;
      if (container && !container.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        stopJiggle();
      }
    };
    const clickBlocker = (e: Event) => {
      if (jigglingRef.current && !isGracePeriod()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (Date.now() < blockClicksUntil.current) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("touchstart", touchHandler, { capture: true });
    document.addEventListener("mousedown", touchHandler, { capture: true });
    document.addEventListener("click", clickBlocker, { capture: true });
    return () => {
      document.removeEventListener("touchstart", touchHandler, { capture: true });
      document.removeEventListener("mousedown", touchHandler, { capture: true });
      document.removeEventListener("click", clickBlocker, { capture: true });
    };
  }, [stopJiggle]);

  const displayOrder = dragging && previewOrder.length === order.length ? previewOrder : order;
  const dragOffset = dragging ? dragX - dragOriginX : 0;

  return (
    <nav
      className="sticky z-30 w-full bg-[#1a1a1a] border-b border-card-border/50 p-0 m-0"
      style={{ top: "72px" }}
    >
      <style>{`
        @keyframes tab-jiggle {
          0%   { transform: rotate(0deg) translate(0, 0); }
          25%  { transform: rotate(-2deg) translate(-1px, 0); }
          50%  { transform: rotate(0deg) translate(0, 0); }
          75%  { transform: rotate(2deg) translate(1px, 0); }
          100% { transform: rotate(0deg) translate(0, 0); }
        }
        .tab-jiggle {
          animation: tab-jiggle 0.4s ease-in-out infinite;
          border: 1px solid rgba(255,255,255,0.7);
          border-radius: 6px;
          margin: 2px 3px;
        }
        .tab-slot-shift {
          transition: transform 0.5s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.3s ease;
        }
        .tab-dragging {
          z-index: 50;
          border: 1px solid rgba(255,255,255,0.7) !important;
          border-radius: 8px;
          background: #2a2a2a;
          box-shadow: 0 10px 30px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.2);
          animation: none !important;
        }
      `}</style>
      <div
        ref={containerRef}
        className="relative flex w-full items-stretch p-0 border-t border-card-border/20 overflow-hidden"
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: dragging ? "none" : "auto" }}
      >
        {displayOrder.map((tabId, i) => {
          const tab = TAB_DEFS[tabId];
          const isActive = activeTab === tabId;
          const isBeingDragged = dragging && tabId === dragTabId;

          const style: React.CSSProperties = {};
          if (isBeingDragged) {
            style.transform = `translateX(${dragOffset}px) scale(1.08)`;
            style.transition = "scale 0.2s ease";
          }
          if (jiggling && !isBeingDragged) {
            style.animationDelay = `${i * 70}ms`;
          }

          return (
            <React.Fragment key={tabId}>
              {i > 0 && !dragging && (
                <div className="w-px self-stretch my-1.5 bg-zinc-700/30" />
              )}
              <button
                ref={(el) => { tabRefs.current[i] = el; }}
                onClick={() => {
                  if (jiggling) {
                    if (Date.now() - jiggleStartedAt.current > 500) stopJiggle();
                    return;
                  }
                  if (!touchMoved.current) setActiveTab(tabId);
                }}
                onTouchStart={(e) => handleTouchStart(i, e)}
                className={[
                  "flex flex-1 items-center justify-center gap-2 py-2.5 border-b-2 select-none",
                  isActive ? "border-primary text-white" : "border-transparent text-zinc-500",
                  jiggling && !isBeingDragged ? "tab-jiggle tab-slot-shift" : "",
                  isBeingDragged ? "tab-dragging" : "",
                ].join(" ")}
                style={style}
              >
                {tab.icon}
                <span className="text-[10px] font-medium tracking-widest">
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
