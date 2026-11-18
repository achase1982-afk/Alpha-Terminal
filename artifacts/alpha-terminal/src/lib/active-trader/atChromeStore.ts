import { create } from "zustand";
import { useUICustomizationStore, type HeaderMode } from "@/lib/ui-customization-store";

/**
 * Active Trader applies Settings → Appearance → Header Behavior "Compact" on entry
 * and restores the user's prior mode on exit.
 */
export interface AtExpiryOption {
  expiration: string;
  pillLabel: string;
}

interface AtChromeState {
  keepawayUseMean: boolean;
  setKeepawayUseMean: (v: boolean) => void;
  subViewIsAt: boolean;
  savedHeaderMode: HeaderMode | null;
  atExpiryOptions: AtExpiryOption[];
  atSelectedExpiration: string | null;
  setAtExpiryChrome: (opts: {
    options: AtExpiryOption[];
    selectedExpiration: string;
    onSelect: (expiration: string) => void;
  }) => void;
  clearAtExpiryChrome: () => void;
  pickAtExpiration: (expiration: string) => void;
  enterActiveTrader: () => void;
  leaveActiveTrader: () => void;
  /** Opt back to the user's saved Header Behavior while staying in AT. */
  restoreSavedHeaderMode: () => void;
  reapplyAtCompactHeader: () => void;
}

let atExpirySelectHandler: ((expiration: string) => void) | null = null;

export const useAtChromeStore = create<AtChromeState>()((set, get) => ({
  keepawayUseMean: false,
  setKeepawayUseMean: (v) => set({ keepawayUseMean: v }),
  subViewIsAt: false,
  savedHeaderMode: null,
  atExpiryOptions: [],
  atSelectedExpiration: null,
  setAtExpiryChrome: ({ options, selectedExpiration, onSelect }) => {
    atExpirySelectHandler = onSelect;
    set({ atExpiryOptions: options, atSelectedExpiration: selectedExpiration });
  },
  clearAtExpiryChrome: () => {
    atExpirySelectHandler = null;
    set({ atExpiryOptions: [], atSelectedExpiration: null });
  },
  pickAtExpiration: (expiration) => {
    set({ atSelectedExpiration: expiration });
    atExpirySelectHandler?.(expiration);
  },
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
    atExpirySelectHandler = null;
    set({
      subViewIsAt: false,
      savedHeaderMode: null,
      atExpiryOptions: [],
      atSelectedExpiration: null,
    });
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