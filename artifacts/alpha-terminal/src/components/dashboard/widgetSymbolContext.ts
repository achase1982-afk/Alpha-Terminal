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
