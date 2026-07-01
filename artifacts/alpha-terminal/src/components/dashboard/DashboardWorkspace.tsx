import { useEffect, useRef, useState } from "react";
import GridLayout, { type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "./dashboard.css";
import { Plus } from "lucide-react";
import {
  useDashboardStore,
  DASHBOARD_COLS,
  DASHBOARD_ROW_HEIGHT,
  WIDGET_DEFAULT_SIZE,
  type DashboardPresetId,
} from "@/lib/dashboardStore";
import { WIDGET_REGISTRY, WIDGET_CATALOG, type DashboardWidgetHandlers } from "./widgetRegistry";
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

/**
 * Desktop dashboard: a free-form 12-column grid of widgets. Drag by the
 * widget title bar, resize from the bottom-right corner, swap or remove from
 * the title bar, add from the catalog. Layout persists locally.
 */
export function DashboardWorkspace({ handlers }: { handlers: DashboardWidgetHandlers }) {
  const items = useDashboardStore((s) => s.items);
  const activePreset = useDashboardStore((s) => s.activePreset);
  const applyPreset = useDashboardStore((s) => s.applyPreset);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const addWidget = useDashboardStore((s) => s.addWidget);
  const removeWidget = useDashboardStore((s) => s.removeWidget);
  const swapWidget = useDashboardStore((s) => s.swapWidget);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const layout: LayoutItem[] = items.map((it) => {
    const size = WIDGET_DEFAULT_SIZE[it.widgetId];
    return { i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: size.minW, minH: size.minH };
  });

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
        <div className="ml-auto">
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
              cols: DASHBOARD_COLS,
              rowHeight: DASHBOARD_ROW_HEIGHT,
              margin: [8, 8],
              containerPadding: [0, 0],
            }}
            dragConfig={{ handle: ".widget-drag-handle", cancel: ".widget-no-drag" }}
            resizeConfig={{ handles: ["s", "e", "se"] }}
            onLayoutChange={(next) => updateLayout(next)}
          >
            {items.map((it) => {
              const def = WIDGET_REGISTRY[it.widgetId];
              return (
                <div key={it.i}>
                  <WidgetFrame
                    title={def.title}
                    swapOptions={WIDGET_CATALOG.filter((w) => w.id !== it.widgetId)}
                    onSwap={(widgetId) => swapWidget(it.i, widgetId as typeof it.widgetId)}
                    onRemove={() => removeWidget(it.i)}
                  >
                    {def.render(handlers)}
                  </WidgetFrame>
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>
    </div>
  );
}
