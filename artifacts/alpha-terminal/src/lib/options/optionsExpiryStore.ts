import { create } from "zustand";

type SymbolExpiryState = {
  selected: string | null;
  /** Last date the user explicitly opened (chain row) or picked (AT). */
  explicit: string | null;
};

type OptionsExpiryState = {
  bySymbol: Record<string, SymbolExpiryState>;
  getSelected: (symbol: string) => string | null;
  getExplicit: (symbol: string) => string | null;
  setSelected: (symbol: string, expiration: string) => void;
  setExplicit: (symbol: string, expiration: string) => void;
  clearSymbol: (symbol: string) => void;
};

const norm = (symbol: string) => symbol.replace(/^\$/, "").toUpperCase();

export const useOptionsExpiryStore = create<OptionsExpiryState>((set, get) => ({
  bySymbol: {},
  getSelected: (symbol) => get().bySymbol[norm(symbol)]?.selected ?? null,
  getExplicit: (symbol) => get().bySymbol[norm(symbol)]?.explicit ?? null,
  setSelected: (symbol, expiration) => {
    const key = norm(symbol);
    set((s) => ({
      bySymbol: {
        ...s.bySymbol,
        [key]: {
          explicit: s.bySymbol[key]?.explicit ?? null,
          selected: expiration,
        },
      },
    }));
  },
  setExplicit: (symbol, expiration) => {
    const key = norm(symbol);
    set((s) => ({
      bySymbol: {
        ...s.bySymbol,
        [key]: { selected: expiration, explicit: expiration },
      },
    }));
  },
  clearSymbol: (symbol) => {
    const key = norm(symbol);
    set((s) => {
      const next = { ...s.bySymbol };
      delete next[key];
      return { bySymbol: next };
    });
  },
}));