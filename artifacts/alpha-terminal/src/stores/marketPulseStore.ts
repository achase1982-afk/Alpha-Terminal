import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  MarketPulseData,
  MarketPulseSettings,
} from "../types/marketPulse";

interface MarketPulseState {
  pulseData: MarketPulseData | null;
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;

  settings: MarketPulseSettings;

  setPulseData: (data: MarketPulseData) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  clearPulse: () => void;

  setAutoRefresh: (v: boolean) => void;
  setAutoRefreshInterval: (mins: number) => void;
  setRiskTolerance: (v: MarketPulseSettings["riskTolerance"]) => void;
  setPreferredInstruments: (v: string[]) => void;
  setShowBiasStrip: (v: boolean) => void;
}

export const useMarketPulseStore = create<MarketPulseState>()(
  persist(
    (set) => ({
      pulseData: null,
      isLoading: false,
      error: null,
      lastFetchedAt: null,

      settings: {
        autoRefresh: false,
        autoRefreshInterval: 5,
        riskTolerance: "moderate",
        preferredInstruments: [],
        showBiasStrip: true,
      },

      setPulseData: (data) =>
        set({ pulseData: data, error: null, isLoading: false, lastFetchedAt: Date.now() }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error, isLoading: false }),
      clearPulse: () => set({ pulseData: null, error: null, lastFetchedAt: null }),

      setAutoRefresh: (v) =>
        set((s) => ({ settings: { ...s.settings, autoRefresh: v } })),
      setAutoRefreshInterval: (mins) =>
        set((s) => ({ settings: { ...s.settings, autoRefreshInterval: mins } })),
      setRiskTolerance: (v) =>
        set((s) => ({ settings: { ...s.settings, riskTolerance: v } })),
      setPreferredInstruments: (v) =>
        set((s) => ({ settings: { ...s.settings, preferredInstruments: v } })),
      setShowBiasStrip: (v) =>
        set((s) => ({ settings: { ...s.settings, showBiasStrip: v } })),
    }),
    {
      name: "alpha-market-pulse",
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);
