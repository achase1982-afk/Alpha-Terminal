import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Widgets available in the desktop dashboard catalog. */
export type DashboardWidgetId =
  | "chart"
  | "watchlist"
  | "news"
  | "positions"
  | "movers"
  | "catalysts"
  | "chat";

export interface DashboardItem {
  /** Unique instance key — allows the same widget twice (e.g. two charts later). */
  i: string;
  widgetId: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DashboardPresetId = "overview" | "trading" | "research";

export const DASHBOARD_COLS = 12;
export const DASHBOARD_ROW_HEIGHT = 56;

/** Default geometry for widgets added from the catalog. */
export const WIDGET_DEFAULT_SIZE: Record<DashboardWidgetId, { w: number; h: number; minW: number; minH: number }> = {
  chart: { w: 8, h: 8, minW: 4, minH: 5 },
  watchlist: { w: 3, h: 7, minW: 2, minH: 4 },
  news: { w: 4, h: 7, minW: 3, minH: 4 },
  positions: { w: 6, h: 7, minW: 4, minH: 4 },
  movers: { w: 4, h: 7, minW: 3, minH: 4 },
  catalysts: { w: 5, h: 7, minW: 3, minH: 4 },
  chat: { w: 4, h: 8, minW: 3, minH: 5 },
};

function preset(id: DashboardPresetId): DashboardItem[] {
  switch (id) {
    case "overview":
      // Account-first landing: positions and market breadth, no dominant chart.
      return [
        { i: "positions-1", widgetId: "positions", x: 0, y: 0, w: 5, h: 8 },
        { i: "movers-1", widgetId: "movers", x: 5, y: 0, w: 4, h: 8 },
        { i: "watchlist-1", widgetId: "watchlist", x: 9, y: 0, w: 3, h: 8 },
        { i: "news-1", widgetId: "news", x: 0, y: 8, w: 7, h: 6 },
        { i: "catalysts-1", widgetId: "catalysts", x: 7, y: 8, w: 5, h: 6 },
      ];
    case "trading":
      return [
        { i: "chart-1", widgetId: "chart", x: 0, y: 0, w: 8, h: 8 },
        { i: "watchlist-1", widgetId: "watchlist", x: 8, y: 0, w: 4, h: 4 },
        { i: "news-1", widgetId: "news", x: 8, y: 4, w: 4, h: 4 },
        { i: "positions-1", widgetId: "positions", x: 0, y: 8, w: 8, h: 5 },
        { i: "chat-1", widgetId: "chat", x: 8, y: 8, w: 4, h: 5 },
      ];
    case "research":
      return [
        { i: "catalysts-1", widgetId: "catalysts", x: 0, y: 0, w: 6, h: 7 },
        { i: "movers-1", widgetId: "movers", x: 6, y: 0, w: 6, h: 7 },
        { i: "news-1", widgetId: "news", x: 0, y: 7, w: 6, h: 7 },
        { i: "chat-1", widgetId: "chat", x: 6, y: 7, w: 6, h: 7 },
      ];
  }
}

interface DashboardState {
  items: DashboardItem[];
  /** Which preset the layout came from; null once the user customizes it. */
  activePreset: DashboardPresetId | null;
  applyPreset: (id: DashboardPresetId) => void;
  /** Geometry sync from react-grid-layout (drag/resize). */
  updateLayout: (layout: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  addWidget: (widgetId: DashboardWidgetId) => void;
  removeWidget: (i: string) => void;
  swapWidget: (i: string, widgetId: DashboardWidgetId) => void;
}

function nextInstanceKey(items: DashboardItem[], widgetId: DashboardWidgetId): string {
  let n = 1;
  while (items.some((it) => it.i === `${widgetId}-${n}`)) n++;
  return `${widgetId}-${n}`;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      items: preset("overview"),
      activePreset: "overview",
      applyPreset: (id) => set({ items: preset(id), activePreset: id }),
      updateLayout: (layout) =>
        set((state) => {
          const byKey = new Map(layout.map((l) => [l.i, l]));
          let changed = false;
          const items = state.items.map((it) => {
            const l = byKey.get(it.i);
            if (!l) return it;
            if (l.x === it.x && l.y === it.y && l.w === it.w && l.h === it.h) return it;
            changed = true;
            return { ...it, x: l.x, y: l.y, w: l.w, h: l.h };
          });
          // Ignore the no-op onLayoutChange fired on mount so a pristine
          // preset stays marked as that preset.
          if (!changed) return state;
          return { items, activePreset: null };
        }),
      addWidget: (widgetId) =>
        set((state) => {
          const size = WIDGET_DEFAULT_SIZE[widgetId];
          const bottom = state.items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
          return {
            items: [
              ...state.items,
              { i: nextInstanceKey(state.items, widgetId), widgetId, x: 0, y: bottom, w: size.w, h: size.h },
            ],
            activePreset: null,
          };
        }),
      removeWidget: (i) =>
        set((state) => ({ items: state.items.filter((it) => it.i !== i), activePreset: null })),
      swapWidget: (i, widgetId) =>
        set((state) => ({
          items: state.items.map((it) => (it.i === i ? { ...it, widgetId } : it)),
          activePreset: null,
        })),
    }),
    {
      name: "alpha-dashboard-layout",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
