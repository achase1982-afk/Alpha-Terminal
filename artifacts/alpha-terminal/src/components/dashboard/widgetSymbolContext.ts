import { createContext, useContext } from "react";
import { useTerminalStore } from "@/lib/store";

/**
 * Pinned symbol for the enclosing dashboard widget; null = follow the app's
 * global symbol. Provided per widget instance by DashboardWorkspace.
 */
export const WidgetSymbolContext = createContext<string | null>(null);

/**
 * The symbol a symbol-aware surface should display: the enclosing widget's
 * pin wins, otherwise the global active symbol. Outside the dashboard the
 * context is null, so this behaves exactly like reading the store.
 */
export function useActiveSymbol(): string {
  const pinned = useContext(WidgetSymbolContext);
  const global = useTerminalStore((s) => s.symbol);
  return pinned ?? global;
}

export interface WidgetChartSettings {
  /** Widget-local timeframe; null until the user picks one in this widget. */
  period: string | null;
  interval: string | null;
  /** Persist a widget-local timeframe (decouples this chart from the app). */
  setTimeframe: (period: string, interval: string) => void;
}

/**
 * Per-widget chart timeframe. Provided by DashboardWorkspace so each chart
 * widget keeps its own period/interval; null outside the dashboard.
 */
export const WidgetChartSettingsContext = createContext<WidgetChartSettings | null>(null);

/**
 * Chart timeframe + setter for the enclosing surface. Inside a dashboard
 * widget: reads fall back to the app values until the user picks a timeframe
 * in that widget, and writes always go to the widget. Elsewhere: the global
 * store, byte-for-byte the previous behavior.
 */
export function useActiveChartSettings(): {
  chartPeriod: string;
  chartInterval: string;
  setTimeframe: (period: string, interval: string) => void;
} {
  const widget = useContext(WidgetChartSettingsContext);
  const chartPeriod = useTerminalStore((s) => s.chartPeriod);
  const chartInterval = useTerminalStore((s) => s.chartInterval);
  const setChartPeriod = useTerminalStore((s) => s.setChartPeriod);
  const setChartInterval = useTerminalStore((s) => s.setChartInterval);

  if (widget) {
    return {
      chartPeriod: widget.period ?? chartPeriod,
      chartInterval: widget.interval ?? chartInterval,
      setTimeframe: widget.setTimeframe,
    };
  }
  return {
    chartPeriod,
    chartInterval,
    setTimeframe: (period, interval) => {
      setChartPeriod(period);
      setChartInterval(interval);
    },
  };
}
