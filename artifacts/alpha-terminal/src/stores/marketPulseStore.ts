import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  MarketPulseData,
  MarketPulseSettings,
  AllowedStrategy,
} from "../types/marketPulse";
import { ALL_STRATEGIES } from "../types/marketPulse";

interface MarketPulseState {
  pulseData: MarketPulseData | null;
  isLoading: boolean;
  isStreaming: boolean;
  thinkingTokens: string[];
  error: string | null;
  lastFetchedAt: number | null;

  settings: MarketPulseSettings;

  setPulseData: (data: MarketPulseData) => void;
  setLoading: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  appendThinking: (text: string) => void;
  clearThinking: () => void;
  setError: (e: string | null) => void;
  clearPulse: () => void;

  updateSetting: <K extends keyof MarketPulseSettings>(key: K, value: MarketPulseSettings[K]) => void;
  toggleStrategy: (s: AllowedStrategy) => void;
}

export const useMarketPulseStore = create<MarketPulseState>()(
  persist(
    (set) => ({
      pulseData: null,
      isLoading: false,
      isStreaming: false,
      thinkingTokens: [],
      error: null,
      lastFetchedAt: null,

      settings: {
        showBiasStrip: true,
        autoRefresh: false,
        autoRefreshInterval: 15,
        showActionPlan: true,
        showClusterDetails: true,
        compactMode: false,
        allowedStrategies: [...ALL_STRATEGIES],
        defaultSpreadWidth: "$5",
        maxContracts: "",
        accountSizeTier: "",
        preferredTickers: "",
        maxRiskPerTrade: "2%",
        allowNoEdgeSuppression: true,
      },

      setPulseData: (data) =>
        set({ pulseData: data, error: null, isLoading: false, isStreaming: false, lastFetchedAt: Date.now() }),
      setLoading: (isLoading) => set({ isLoading }),
      setStreaming: (isStreaming) => set({ isStreaming }),
      appendThinking: (text) =>
        set((s) => ({ thinkingTokens: [...s.thinkingTokens, text] })),
      clearThinking: () => set({ thinkingTokens: [] }),
      setError: (error) => set({ error, isLoading: false, isStreaming: false }),
      clearPulse: () => set({ pulseData: null, error: null, lastFetchedAt: null }),

      updateSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      toggleStrategy: (strategy) =>
        set((s) => {
          const current = s.settings.allowedStrategies;
          const next = current.includes(strategy)
            ? current.filter((st) => st !== strategy)
            : [...current, strategy];
          return { settings: { ...s.settings, allowedStrategies: next } };
        }),
    }),
    {
      name: "alpha-market-pulse",
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);
