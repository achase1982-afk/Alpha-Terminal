import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import GridLayout, { type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "./dashboard.css";
import { Lock, LockOpen, Plus } from "lucide-react";
import {
  useDashboardStore,
  DASHBOARD_COLS,
  DASHBOARD_ROW_HEIGHT,
  WIDGET_DEFAULT_SIZE,
  type DashboardItem,
  type DashboardPresetId,
} from "@/lib/dashboardStore";
import { WIDGET_REGISTRY, WIDGET_CATALOG, type DashboardWidgetHandlers } from "./widgetRegistry";
import { WidgetSymbolContext, WidgetChartSettingsContext } from "./widgetSymbolContext";
import { WidgetFrame } from "./WidgetFrame";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRESETS: { id: DashboardPresetId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trading", label: "Trading" },
  { id: "research", label: "Research" },
];

/** One widget with its per-instance contexts (symbol pin, chart timeframe). */
function WidgetBody({
  item,
  handlers,
}: {
  item: DashboardItem;
  handlers: DashboardWidgetHandlers;
}) {
  const setWidgetChartTimeframe = useDashboardStore((s) => s.setWidgetChartTimeframe);
  const chartSettings = useMemo(
    () => ({
      period: item.chartPeriod ?? null,
      interval: item.chartInterval ?? null,
      setTimeframe: (period: string, interval: string) =>
        setWidgetChartTimeframe(item.i, period, interval),
    }),
    [item.chartPeriod, item.chartInterval, item.i, setWidgetChartTimeframe],
  );
  const def = WIDGET_REGISTRY[item.widgetId];
  return (
    <WidgetSymbolContext.Provider value={item.pinnedSymbol ?? null}>
      <WidgetChartSettingsContext.Provider value={chartSettings}>
        {def.render(handlers)}
      </WidgetChartSettingsContext.Provider>
    </WidgetSymbolContext.Provider>
  );
}

/**
 * Width-adaptive grid: the stored layout model stays in 12-column space, but
 * the rendered grid gains columns on wide screens so widgets keep usable
 * proportions instead of stretching. Layouts are scaled 12 -> N on render
 * and normalized back to 12 on save.
 */
const BREAKPOINT_COLS: Array<{ minWidth: number; cols: number }> = [
  { minWidth: 2560, cols: 24 },
  { minWidth: 1920, cols: 16 },
  { minWidth: 0, cols: 12 },
];

function colsForWidth(width: number): number {
  for (const bp of BREAKPOINT_COLS) {
    if (width >= bp.minWidth) return bp.cols;
  }
  return DASHBOARD_COLS;
}

/**
 * Preserve the designed cell aspect ratio (tuned at 1200px / 12 cols:
 * ~93px columns, 56px rows) so widgets don't go wide-and-short on large
 * monitors. Clamped to sane bounds.
 */
function rowHeightForWidth(width: number, cols: number): number {
  const colWidth = (width - 8 * (cols - 1)) / cols;
  const scaled = (colWidth / 93) * DASHBOARD_ROW_HEIGHT;
  return Math.max(40, Math.min(220, Math.round(scaled)));
}

/**
 * Desktop dashboard: a free-form 12-column grid of widgets. Drag by the
 * widget title bar, resize from any edge or corner, swap/pin/remove from the
 * title bar, add from the catalog. Layout persists locally and to the server.
 */
export function DashboardWorkspace({ handlers }: { handlers: DashboardWidgetHandlers }) {
  const items = useDashboardStore((s) => s.items);
  const activePreset = useDashboardStore((s) => s.activePreset);
  const applyPreset = useDashboardStore((s) => s.applyPreset);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const addWidget = useDashboardStore((s) => s.addWidget);
  const removeWidget = useDashboardStore((s) => s.removeWidget);
  const swapWidget = useDashboardStore((s) => s.swapWidget);
  const pinWidget = useDashboardStore((s) => s.pinWidget);
  const locked = useDashboardStore((s) => s.locked);
  const setLocked = useDashboardStore((s) => s.setLocked);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);

  // useLayoutEffect: measure before paint so the first frame already uses the
  // real container width instead of the 1200px placeholder (avoids a visible snap).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const maximizedItem = maximizedId ? (items.find((it) => it.i === maximizedId) ?? null) : null;

  // Esc restores a maximized widget.
  useEffect(() => {
    if (!maximizedItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximizedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximizedItem]);

  const cols = colsForWidth(width);
  const rowHeight = rowHeightForWidth(width, cols);
  // Render scale: stored model is always 12-col; scale x/w (and minW) to the
  // active column count. y/h are row-based and unaffected.
  const renderScale = cols / DASHBOARD_COLS;
  const layout: LayoutItem[] = items.map((it) => {
    const size = WIDGET_DEFAULT_SIZE[it.widgetId];
    return {
      i: it.i,
      x: Math.round(it.x * renderScale),
      y: it.y,
      w: Math.max(1, Math.round(it.w * renderScale)),
      h: it.h,
      minW: Math.max(1, Math.round(size.minW * renderScale)),
      minH: size.minH,
    };
  });

  // Normalize back to 12-col storage space before persisting.
  const handleLayoutChange = (next: LayoutItem[]) => {
    updateLayout(
      next.map((l) => ({
        i: String(l.i),
        x: Math.max(0, Math.round(l.x / renderScale)),
        y: l.y,
        w: Math.max(1, Math.round(l.w / renderScale)),
        h: l.h,
      })),
    );
  };

  return (
    <div className="flex min-h-full flex-col" style={{ background: "#050505" }}>
      <div className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-zinc-800/50 bg-[#0a0a0a]/95 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className="rounded px-3 py-1 font-mono text-[11px] font-bold tracking-wider transition-colors"
              style={{
                color: activePreset === p.id ? "#FFB800" : "#71717a",
                background: activePreset === p.id ? "rgba(255,184,0,0.08)" : "transparent",
              }}
            >
              {p.label.toUpperCase()}
            </button>
          ))}
        </div>
        {activePreset === null && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">Custom</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLocked(!locked)}
            title={
              locked
                ? "Layout locked — click to allow moving and resizing"
                : "Lock layout — prevents accidental moves and resizes"
            }
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] font-bold tracking-wider transition-colors"
            style={{
              color: locked ? "#FFB800" : "#a1a1aa",
              borderColor: locked ? "rgba(255,184,0,0.4)" : "rgba(63,63,70,0.7)",
              background: locked ? "rgba(255,184,0,0.08)" : "rgba(24,24,27,0.8)",
            }}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            {locked ? "LOCKED" : "LOCK"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-zinc-700/70 bg-zinc-900/80 px-3 py-1.5 font-mono text-[11px] font-bold tracking-wider text-zinc-300 transition-colors hover:border-zinc-500"
              >
                <Plus className="h-3.5 w-3.5" />
                ADD WIDGET
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-zinc-800 bg-[#121214]">
              {WIDGET_CATALOG.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  onClick={() => addWidget(w.id)}
                  className="font-mono text-xs text-zinc-300"
                >
                  {w.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={containerRef} className="min-w-0 flex-1 p-2">
        {items.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <p className="font-mono text-sm text-zinc-500">Empty dashboard</p>
            <p className="font-mono text-xs text-zinc-600">
              Use “Add widget” above or pick a preset to get started.
            </p>
          </div>
        ) : (
          <GridLayout
            className="dashboard-grid"
            layout={layout}
            width={width}
            gridConfig={{
              cols,
              rowHeight,
              margin: [8, 8],
              containerPadding: [0, 0],
            }}
            dragConfig={{ enabled: !locked, handle: ".widget-drag-handle", cancel: ".widget-no-drag" }}
            resizeConfig={{ enabled: !locked, handles: ["n", "s", "e", "w", "ne", "nw", "se", "sw"] }}
            onLayoutChange={handleLayoutChange}
          >
            {items.map((it) => {
              const def = WIDGET_REGISTRY[it.widgetId];
              const isMaximized = maximizedId === it.i;
              return (
                <div key={it.i}>
                  <WidgetFrame
                    title={def.title}
                    swapOptions={WIDGET_CATALOG.filter((w) => w.id !== it.widgetId)}
                    onSwap={(widgetId) => swapWidget(it.i, widgetId as typeof it.widgetId)}
                    onRemove={() => removeWidget(it.i)}
                    pinnable={!!def.symbolAware}
                    pinnedSymbol={it.pinnedSymbol ?? null}
                    onPin={(symbol) => pinWidget(it.i, symbol)}
                    isMaximized={false}
                    onToggleMaximize={() => setMaximizedId(it.i)}
                  >
                    {/* While maximized the content lives in the overlay below —
                        don't run two live copies of the same widget. */}
                    {isMaximized ? (
                      <div className="flex h-full items-center justify-center">
                        <p className="font-mono text-xs tracking-wider text-zinc-600">MAXIMIZED</p>
                      </div>
                    ) : (
                      <WidgetBody item={it} handlers={handlers} />
                    )}
                  </WidgetFrame>
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>

      {maximizedItem && (
        <div
          className="fixed inset-0 z-[120] flex flex-col bg-black/70 p-3 backdrop-blur-sm md:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMaximizedId(null);
          }}
        >
          <WidgetFrame
            title={WIDGET_REGISTRY[maximizedItem.widgetId].title}
            swapOptions={WIDGET_CATALOG.filter((w) => w.id !== maximizedItem.widgetId)}
            onSwap={(widgetId) => swapWidget(maximizedItem.i, widgetId as typeof maximizedItem.widgetId)}
            onRemove={() => {
              setMaximizedId(null);
              removeWidget(maximizedItem.i);
            }}
            pinnable={!!WIDGET_REGISTRY[maximizedItem.widgetId].symbolAware}
            pinnedSymbol={maximizedItem.pinnedSymbol ?? null}
            onPin={(symbol) => pinWidget(maximizedItem.i, symbol)}
            isMaximized
            onToggleMaximize={() => setMaximizedId(null)}
          >
            <WidgetBody item={maximizedItem} handlers={handlers} />
          </WidgetFrame>
        </div>
      )}
    </div>
  );
}
