import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  MarketPulseData,
  MarketPulseSettings,
  AllowedStrategy,
} from "../types/marketPulse";
import { ALL_STRATEGIES, ALL_PULSE_INDICATORS } from "../types/marketPulse";

interface MarketPulseState {
  pulseData: MarketPulseData | null;
  isLoading: boolean;
  isStreaming: boolean;
  thinkingTokens: string[];
  statusMessages: string[];
  error: string | null;
  lastFetchedAt: number | null;

  settings: MarketPulseSettings;

  setPulseData: (data: MarketPulseData) => void;
  setLoading: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  appendThinking: (text: string) => void;
  replaceThinking: (fullText: string) => void;
  appendStatus: (text: string) => void;
  clearThinking: () => void;
  setError: (e: string | null) => void;
  clearPulse: () => void;

  updateSetting: <K extends keyof MarketPulseSettings>(key: K, value: MarketPulseSettings[K]) => void;
  toggleStrategy: (s: AllowedStrategy) => void;
  toggleIndicator: (symbol: string) => void;
  resetIndicators: () => void;
}

export const useMarketPulseStore = create<MarketPulseState>()(
  persist(
    (set) => ({
      pulseData: null,
      isLoading: false,
      isStreaming: false,
      thinkingTokens: [],
      statusMessages: [],
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
        pulseIndicators: ALL_PULSE_INDICATORS.map(i => i.symbol),
      },

      setPulseData: (data) =>
        set({ pulseData: data, error: null, lastFetchedAt: Date.now() }),
      setLoading: (isLoading) => set({ isLoading }),
      setStreaming: (isStreaming) => set({ isStreaming }),
      appendThinking: (text) =>
        set((s) => ({ thinkingTokens: [...s.thinkingTokens, text] })),
      replaceThinking: (fullText) =>
        set({ thinkingTokens: [fullText] }),
      appendStatus: (text) =>
        set((s) => ({ statusMessages: [...s.statusMessages, text] })),
      clearThinking: () => set({ thinkingTokens: [], statusMessages: [] }),
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
      toggleIndicator: (symbol) =>
        set((s) => {
          const current = s.settings.pulseIndicators ?? ALL_PULSE_INDICATORS.map(i => i.symbol);
          const next = current.includes(symbol)
            ? current.filter((sym) => sym !== symbol)
            : [...current, symbol];
          return { settings: { ...s.settings, pulseIndicators: next } };
        }),
      resetIndicators: () =>
        set((s) => ({
          settings: { ...s.settings, pulseIndicators: ALL_PULSE_INDICATORS.map(i => i.symbol) },
        })),
    }),
    {
      name: "alpha-market-pulse",
      version: 2,
      partialize: (state) => ({
        settings: state.settings,
        pulseData: state.pulseData,
        lastFetchedAt: state.lastFetchedAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoading = false;
          state.isStreaming = false;
          state.error = null;
        }
      },
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version < 1 || !state.settings) {
          const s = (state.settings ?? {}) as Record<string, unknown>;
          if (!s.pulseIndicators || !Array.isArray(s.pulseIndicators)) {
            s.pulseIndicators = ALL_PULSE_INDICATORS.map(i => i.symbol);
          }
          state.settings = s;
        }
        if (version < 2) {
          if (!state.pulseData) state.pulseData = null;
          if (!state.lastFetchedAt) state.lastFetchedAt = null;
        }
        return state;
      },
    }
  )
);
