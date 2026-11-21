import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Briefcase,
  ChartCandlestick,
  ClipboardList,
  LineChart,
  ListOrdered,
} from "lucide-react";

type BottomTab = "scanner" | "markets" | "ai" | "portfolio" | "watchlist" | "activeTrader" | "insights";
type MobileBottomSlot = "watchlist" | "orders" | "activeTrader" | "portfolio" | "insights";

const TAB_DEFS: Record<MobileBottomSlot, { label: string; icon: (cls: string) => React.ReactNode }> = {
  portfolio:    { label: "PORTFOLIO", icon: (c) => <Briefcase className={c} /> },
  watchlist:    { label: "WATCHLIST", icon: (c) => <ListOrdered className={c} /> },
  orders:       { label: "ORDERS",    icon: (c) => <ClipboardList className={c} /> },
  activeTrader: { label: "TRADER",    icon: (c) => <ChartCandlestick className={c} /> },
  insights:     { label: "INSIGHTS",  icon: (c) => <LineChart className={c} /> },
};

/** Mobile bottom bar slots — AI hub lives in the hamburger menu instead. */
const MOBILE_BOTTOM_SLOTS: MobileBottomSlot[] = ["watchlist", "orders", "activeTrader", "portfolio", "insights"];
const DEFAULT_ORDER: MobileBottomSlot[] = MOBILE_BOTTOM_SLOTS;
const STORAGE_KEY = "alphaTerminalBottomNavOrder:v6";
const LEGACY_STORAGE_KEYS = [
  "alphaTerminalBottomNavOrder:v5",
  "alphaTerminalBottomNavOrder:v4",
  "alphaTerminalBottomNavOrder:v3",
  "alphaTerminalBottomNavOrder:v2",
] as const;
const LONG_PRESS_MS = 450;
const TAP_SLOP_PX = 18;

function migrateTabId(item: string): MobileBottomSlot | null {
  const mapped =
    item === "ai" ? "portfolio" : item === "markets" ? "orders" : item;
  if (typeof mapped !== "string" || !MOBILE_BOTTOM_SLOTS.includes(mapped as MobileBottomSlot)) return null;
  return mapped as MobileBottomSlot;
}

function loadOrder(): MobileBottomSlot[] {
  try {
    for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      const unique: MobileBottomSlot[] = [];
      for (const item of parsed) {
        const tab = migrateTabId(item);
        if (!tab || unique.includes(tab)) continue;
        unique.push(tab);
      }
      for (const slot of MOBILE_BOTTOM_SLOTS) {
        if (!unique.includes(slot)) unique.push(slot);
      }
      if (unique.length === MOBILE_BOTTOM_SLOTS.length) {
        const order = unique.slice(0, MOBILE_BOTTOM_SLOTS.length);
        if (key !== STORAGE_KEY) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
        }
        return order;
      }
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
  activeTab: BottomTab | MobileBottomSlot;
  onTabChange: (tab: MobileBottomSlot) => void;
}

export function BottomNav({
  activeTab,
  onTabChange,
}: BottomNavProps) {
  const [order, setOrder] = useState<MobileBottomSlot[]>(loadOrder);
  const [jiggling, setJiggling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragTabId, setDragTabId] = useState<MobileBottomSlot | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragOriginX, setDragOriginX] = useState(0);
  const [previewOrder, setPreviewOrder] = useState<MobileBottomSlot[]>([]);

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

  const saveOrder = useCallback((newOrder: MobileBottomSlot[]) => {
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
      className="relative z-50 shrink-0 border-t border-zinc-800/60 bg-card px-2 pt-3"
      style={{
        paddingBottom: "max(14px, env(safe-area-inset-bottom, 0px))",
        touchAction: dragging ? "none" : "manipulation",
      }}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex w-full items-stretch gap-1 rounded-xl bg-card p-1 ring-1 ring-inset ring-zinc-800/60">
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
              "relative flex min-h-[50px] w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 min-w-0 select-none transition-colors duration-150",
              isActive ? "bg-zinc-800/90 text-zinc-100" : "text-zinc-400 hover:text-zinc-300",
              jiggling && !isBeingDragged ? "bnav-jiggle bnav-slot-shift" : "",
              isBeingDragged ? "bnav-dragging" : "",
            ].join(" ")}
            style={style}
            aria-label={`${def.label} tab`}
            aria-current={isActive ? "page" : undefined}
          >
            {def.icon("h-6 w-6 shrink-0")}
            <span className="max-w-full truncate text-center text-[8.5px] font-mono font-bold uppercase tracking-wide leading-none">
              {def.label}
            </span>
          </button>
          </div>
        );
      })}
      </div>
    </nav>
  );
}
