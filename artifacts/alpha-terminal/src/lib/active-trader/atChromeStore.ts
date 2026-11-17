import { create } from "zustand";
import { useUICustomizationStore, type HeaderMode } from "@/lib/ui-customization-store";

/**
 * Active Trader applies Settings → Appearance → Header Behavior "Compact" on entry
 * and restores the user's prior mode on exit.
 */
interface AtChromeState {
  subViewIsAt: boolean;
  savedHeaderMode: HeaderMode | null;
  enterActiveTrader: () => void;
  leaveActiveTrader: () => void;
  /** Opt back to the user's saved Header Behavior while staying in AT. */
  restoreSavedHeaderMode: () => void;
  reapplyAtCompactHeader: () => void;
}

export const useAtChromeStore = create<AtChromeState>()((set, get) => ({
  subViewIsAt: false,
  savedHeaderMode: null,
  enterActiveTrader: () => {
    if (get().subViewIsAt) return;
    const ui = useUICustomizationStore.getState();
    const saved = ui.headerMode;
    ui.setHeaderMode("collapsed");
    set({ subViewIsAt: true, savedHeaderMode: saved });
  },
  leaveActiveTrader: () => {
    const { savedHeaderMode, subViewIsAt } = get();
    if (!subViewIsAt) return;
    if (savedHeaderMode != null) {
      useUICustomizationStore.getState().setHeaderMode(savedHeaderMode);
    }
    set({ subViewIsAt: false, savedHeaderMode: null });
  },
  restoreSavedHeaderMode: () => {
    const { savedHeaderMode } = get();
    if (savedHeaderMode != null) {
      useUICustomizationStore.getState().setHeaderMode(savedHeaderMode);
    }
  },
  reapplyAtCompactHeader: () => {
    useUICustomizationStore.getState().setHeaderMode("collapsed");
  },
}));