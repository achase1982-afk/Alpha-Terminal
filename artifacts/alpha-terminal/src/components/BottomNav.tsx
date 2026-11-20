import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  BrainCircuit,
  Activity,
  Briefcase,
  ChartCandlestick,
  LineChart,
  ListOrdered,
} from "lucide-react";

type BottomTab = "scanner" | "markets" | "ai" | "portfolio" | "watchlist" | "activeTrader" | "insights";

const TAB_DEFS: Record<BottomTab, { label: string; icon: (cls: string) => React.ReactNode }> = {
  scanner:      { label: "Scanner",   icon: (c) => <BrainCircuit className={c} /> },
  markets:      { label: "Markets",   icon: (c) => <Activity className={c} /> },
  ai:           { label: "AI",        icon: (c) => <BrainCircuit className={c} /> },
  portfolio:    { label: "Portfolio", icon: (c) => <Briefcase className={c} /> },
  watchlist:    { label: "Watchlist", icon: (c) => <ListOrdered className={c} /> },
  activeTrader: { label: "Trader",    icon: (c) => <ChartCandlestick className={c} /> },
  insights:     { label: "Insights",  icon: (c) => <LineChart className={c} /> },
};

const DEFAULT_ORDER: BottomTab[] = ["watchlist", "markets", "activeTrader", "ai", "insights"];
const STORAGE_KEY = "alphaTerminalBottomNavOrder:v3";
const LEGACY_STORAGE_KEY = "alphaTerminalBottomNavOrder:v2";
const LONG_PRESS_MS = 450;
const TAP_SLOP_PX = 18;

function loadOrder(): BottomTab[] {
  try {
    for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      const unique: BottomTab[] = [];
      for (const item of parsed) {
        if (typeof item !== "string" || !DEFAULT_ORDER.includes(item as BottomTab)) continue;
        const tab = item as BottomTab;
        if (!unique.includes(tab)) unique.push(tab);
      }
      // v2 stored a SEARCH tab. Drop it and keep a custom order of the remaining four.
      if (unique.length === DEFAULT_ORDER.length) return unique;
    }
  } catch {
    /* ignore broken storage */
  }
  return [...DEFAULT_ORDER];
}

function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

interface BottomNavProps {
  activeTab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  /**
   * When the user leaves the AI hub, show a persistent cue on the AI tab that
   * Strategist work is still running or a new result is waiting (server-side
   * jobs continue; polling survives tab changes — see `strategistPoller`).
   */
  strategistRunningCount?: number;
  strategistUnviewedCount?: number;
}

export function BottomNav({
  activeTab,
  onTabChange,
  strategistRunningCount = 0,
  strategistUnviewedCount = 0,
}: BottomNavProps) {
  const [order, setOrder] = useState<BottomTab[]>(loadOrder);
  const [jiggling, setJiggling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragTabId, setDragTabId] = useState<BottomTab | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragOriginX, setDragOriginX] = useState(0);
  const [previewOrder, setPreviewOrder] = useState<BottomTab[]>([]);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchMoved = useRef(false);
  const tabRects = useRef<DOMRect[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const containerRef = useRef<HTMLElement | null>(null);
  const dragStartIdx = useRef(0);
  const jiggleStartedAt = useRef(0);
  const jigglingRef = useRef(false);
  const blockClicksUntil = useRef(0);
  const scrolling = useRef(false);

  const saveOrder = useCallback((newOrder: BottomTab[]) => {
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
        if (dx > TAP_SLOP_PX || dy > TAP_SLOP_PX) {
          if (dy > dx) scrolling.current = true;
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
        setPreviewOrder(reorder(order, fromIdx, targetIdx));
      } else {
        setPreviewOrder([...order]);
      }
    },
    [dragging, cancelLongPress, order, dragTabId]
  );

  const handleTouchEnd = useCallback(() => {
    cancelLongPress();
    if (!dragging) return;
    if (dragTabId !== null) {
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
        saveOrder(reorder(order, fromIdx, targetIdx));
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
      ref={containerRef}
      data-bottom-nav
      className="relative z-50 shrink-0 border-t border-zinc-800/60 bg-card px-1 pt-3"
      style={{
        paddingBottom: "max(14px, env(safe-area-inset-bottom, 0px))",
        touchAction: dragging ? "none" : "manipulation",
      }}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex w-full items-stretch gap-0.5 rounded-xl bg-card px-0.5 py-1 ring-1 ring-inset ring-zinc-800/60">
      <style>{`
        @keyframes bnav-jiggle {
          0%   { transform: rotate(0deg) translate(0, 0); }
          25%  { transform: rotate(-2deg) translate(-1px, 0); }
          50%  { transform: rotate(0deg) translate(0, 0); }
          75%  { transform: rotate(2deg) translate(1px, 0); }
          100% { transform: rotate(0deg) translate(0, 0); }
        }
        .bnav-jiggle {
          animation: bnav-jiggle 0.4s ease-in-out infinite;
          border: 1px solid rgba(255,255,255,0.7);
          border-radius: 10px;
          padding: 4px 2px;
        }
        .bnav-slot-shift {
          transition: transform 0.5s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.3s ease;
        }
        .bnav-dragging {
          z-index: 50;
          border: 1px solid rgba(255,255,255,0.7) !important;
          border-radius: 10px;
          background: rgba(30,30,30,0.95);
          box-shadow: 0 10px 30px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.2);
          animation: none !important;
        }
        .bnav-tab {
          color: #b5b5bb;
          -webkit-tap-highlight-color: transparent;
        }
        .bnav-face {
          position: relative;
          display: flex;
          width: fit-content;
          max-width: 100%;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          border-radius: 8px;
          padding: 4px 4px 3px;
        }
        .bnav-face-active {
          background: linear-gradient(180deg, #2a2a2e 0%, #222226 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.1),
            0 1px 0 rgba(0, 0, 0, 0.45);
        }
        .bnav-icon {
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          filter:
            drop-shadow(0 -1px 0 rgba(255, 255, 255, 0.18))
            drop-shadow(0 1px 0 rgba(0, 0, 0, 0.65));
        }
        .bnav-label {
          display: block;
          max-width: 100%;
          overflow: hidden;
          font-size: 14px;
          font-weight: 400;
          line-height: 1;
          letter-spacing: 0;
          color: #b5b5bb;
          text-align: center;
          white-space: nowrap;
        }
      `}</style>
      {displayOrder.map((tabId, i) => {
        const def = TAB_DEFS[tabId];
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

        const showStrategistBadge =
          tabId === "ai" &&
          activeTab !== "ai" &&
          (strategistRunningCount > 0 || strategistUnviewedCount > 0);
        const badgeIsRunning = strategistRunningCount > 0;
        const badgeNumber = badgeIsRunning ? strategistRunningCount : strategistUnviewedCount;
        const showBadgeNumber = badgeNumber > 1;

        return (
          <div
            key={tabId}
            className="relative z-0 flex min-w-0 flex-1 basis-0 items-stretch"
          >
          <button
            ref={(el) => { tabRefs.current[i] = el; }}
            data-bottom-tab={tabId}
            onClick={() => { if (jiggling) { if (Date.now() - jiggleStartedAt.current > 500) stopJiggle(); return; } if (!touchMoved.current) onTabChange(tabId); }}
            onTouchStart={(e) => handleTouchStart(i, e)}
            className={[
              "bnav-tab relative flex w-full min-w-0 items-center justify-center px-0 py-0.5 select-none",
              jiggling && !isBeingDragged ? "bnav-jiggle bnav-slot-shift" : "",
              isBeingDragged ? "bnav-dragging" : "",
            ].join(" ")}
            style={style}
            aria-label={
              showStrategistBadge
                ? badgeIsRunning
                  ? `AI — ${strategistRunningCount} Strategist ${strategistRunningCount === 1 ? "analysis" : "analyses"} in progress`
                  : `AI — ${strategistUnviewedCount} new Strategist ${strategistUnviewedCount === 1 ? "result" : "results"}`
                : `${def.label} tab`
            }
            aria-current={isActive ? "page" : undefined}
          >
            <span className={isActive ? "bnav-face bnav-face-active" : "bnav-face"}>
            {def.icon("bnav-icon")}
            {showStrategistBadge && (
              <span
                className={badgeIsRunning ? "animate-pulse" : ""}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 6,
                  minWidth: showBadgeNumber ? 14 : 7,
                  height: showBadgeNumber ? 14 : 7,
                  padding: showBadgeNumber ? "0 3px" : 0,
                  borderRadius: 9999,
                  background: badgeIsRunning ? "#FFB800" : "#00d166",
                  boxShadow: badgeIsRunning ? "0 0 6px #FFB800" : "0 0 4px #00d166",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 800,
                  fontFamily: "ui-monospace, monospace",
                  color: "#0c0c0c",
                  lineHeight: 1,
                }}
              >
                {showBadgeNumber ? badgeNumber : ""}
              </span>
            )}
            <span className="bnav-label">{def.label}</span>
            </span>
          </button>
          </div>
        );
      })}
      </div>
    </nav>
  );
}
