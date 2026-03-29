import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LiveQuote {
  symbol:     string;
  last:       number | null;
  bid:        number | null;
  ask:        number | null;
  bidSize:    number | null;
  askSize:    number | null;
  change:     number | null;
  changePct:  number | null;
  volume:     number | null;
  high:       number | null;
  low:        number | null;
  close:      number | null;
  ts:         number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TerminalState {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string) => void;
  clearTokens: () => void;

  traderAccessToken: string | null;
  traderRefreshToken: string | null;
  setTraderTokens: (access: string, refresh: string) => void;
  clearTraderTokens: () => void;

  symbol: string;
  setSymbol: (s: string) => void;
  recentSymbols: string[];
  addRecentSymbol: (s: string) => void;
  
  chartPeriod: string;
  setChartPeriod: (p: string) => void;
  chartInterval: string;
  setChartInterval: (i: string) => void;
  
  overlays: {
    sma20: boolean;
    sma50: boolean;
    bb: boolean;
    rsi: boolean;
    volume: boolean;
  };
  toggleOverlay: (overlay: keyof TerminalState['overlays']) => void;

  aiModel: string;
  setAiModel: (m: string) => void;
  aiTemp: number;
  setAiTemp: (t: number) => void;
  
  tickerTapeSymbols: string[];
  setTickerTapeSymbols: (symbols: string[]) => void;
  tapeSpeed: number;
  setTapeSpeed: (speed: number) => void;

  macroSymbols: string[];
  setMacroSymbols: (symbols: string[]) => void;

  analysisResult: string | null;
  setAnalysisResult: (r: string | null) => void;
  strategistResult: string | null;
  setStrategistResult: (r: string | null) => void;
  briefingResult: string | null;
  setBriefingResult: (r: string | null) => void;

  stratAutopilot: boolean;
  setStratAutopilot: (v: boolean) => void;
  stratMaxRisk: number;
  setStratMaxRisk: (v: number) => void;
  stratMinPoP: number;
  setStratMinPoP: (v: number) => void;
  stratMinRR: string;
  setStratMinRR: (v: string) => void;
  stratBias: "auto" | "bullish" | "bearish" | "neutral";
  setStratBias: (v: "auto" | "bullish" | "bearish" | "neutral") => void;
  stratPremium: "any" | "credit" | "debit";
  setStratPremium: (v: "any" | "credit" | "debit") => void;
  stratAvoidEarnings: boolean;
  setStratAvoidEarnings: (v: boolean) => void;

  chatHistory: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: () => void;

  watchlist: string[];
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;

  browserUrl: string | null;
  browserTitle: string | null;
  browserSource: string | null;
  browserSourceUrl: string | null;
  openBrowser: (url: string, title?: string, source?: string, sourceUrl?: string) => void;
  closeBrowser: () => void;

  // ── Streaming (NOT persisted) ─────────────────────────────────────────────
  streamPrices: Record<string, LiveQuote>;
  streamConnected: boolean;
  streamStatus: "offline" | "connecting" | "live";
  setStreamQuote: (q: LiveQuote) => void;
  setStreamConnected: (v: boolean) => void;
  setStreamStatus: (s: "offline" | "connecting" | "live") => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      clearTokens: () => set({ accessToken: null, refreshToken: null }),

      traderAccessToken: null,
      traderRefreshToken: null,
      setTraderTokens: (access, refresh) => set({ traderAccessToken: access, traderRefreshToken: refresh }),
      clearTraderTokens: () => set({ traderAccessToken: null, traderRefreshToken: null }),

      symbol: 'AAPL',
      recentSymbols: ['AAPL'],
      setSymbol: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => ({
          symbol: upper,
          recentSymbols: [upper, ...state.recentSymbols.filter(s => s !== upper)].slice(0, 14),
        }));
      },
      addRecentSymbol: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => ({
          recentSymbols: [upper, ...state.recentSymbols.filter(s => s !== upper)].slice(0, 14),
        }));
      },
      
      chartPeriod: '3M',
      setChartPeriod: (chartPeriod) => {
        const intraday = chartPeriod === '1D' || chartPeriod === '5D';
        set((state) => {
          const currentIsIntraday = state.chartPeriod === '1D' || state.chartPeriod === '5D';
          const needsReset = intraday !== currentIsIntraday;
          return {
            chartPeriod,
            ...(needsReset ? { chartInterval: intraday ? '5m' : 'daily' } : {}),
          };
        });
      },
      chartInterval: 'daily',
      setChartInterval: (chartInterval) => set({ chartInterval }),
      
      overlays: {
        sma20: true,
        sma50: true,
        bb: false,
        rsi: false,
        volume: true,
      },
      toggleOverlay: (overlay) => set((state) => ({ 
        overlays: { ...state.overlays, [overlay]: !state.overlays[overlay] } 
      })),

      aiModel: 'gemini-2.5-pro',
      setAiModel: (aiModel) => set({ aiModel }),
      aiTemp: 0.7,
      setAiTemp: (aiTemp) => set({ aiTemp }),

      tickerTapeSymbols: ['SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'TSLA', 'NVDA', 'AAPL', 'META', 'MSFT', 'AMZN', 'GOOGL'],
      setTickerTapeSymbols: (tickerTapeSymbols) => set({ tickerTapeSymbols }),
      tapeSpeed: 25,
      setTapeSpeed: (tapeSpeed) => set({ tapeSpeed }),

      macroSymbols: ['SPY', 'QQQ', 'IWM', 'VIX'],
      setMacroSymbols: (macroSymbols) => set({ macroSymbols }),

      analysisResult: null,
      setAnalysisResult: (analysisResult) => set({ analysisResult }),
      strategistResult: null,
      setStrategistResult: (strategistResult) => set({ strategistResult }),
      briefingResult: null,
      setBriefingResult: (briefingResult) => set({ briefingResult }),

      stratAutopilot: true,
      setStratAutopilot: (stratAutopilot) => set({ stratAutopilot }),
      stratMaxRisk: 250,
      setStratMaxRisk: (stratMaxRisk) => set({ stratMaxRisk }),
      stratMinPoP: 70,
      setStratMinPoP: (stratMinPoP) => set({ stratMinPoP }),
      stratMinRR: "1:2",
      setStratMinRR: (stratMinRR) => set({ stratMinRR }),
      stratBias: "auto" as const,
      setStratBias: (stratBias) => set({ stratBias }),
      stratPremium: "any" as const,
      setStratPremium: (stratPremium) => set({ stratPremium }),
      stratAvoidEarnings: true,
      setStratAvoidEarnings: (stratAvoidEarnings) => set({ stratAvoidEarnings }),

      chatHistory: [],
      addChatMessage: (msg) => set((state) => ({ chatHistory: [...state.chatHistory, msg] })),
      clearChat: () => set({ chatHistory: [] }),

      watchlist: [],
      addToWatchlist: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => ({
          watchlist: state.watchlist.includes(upper) ? state.watchlist : [...state.watchlist, upper],
        }));
      },
      removeFromWatchlist: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => ({
          watchlist: state.watchlist.filter(s => s !== upper),
        }));
      },

      browserUrl: null,
      browserTitle: null,
      browserSource: null,
      browserSourceUrl: null,
      openBrowser: (url, title, source, sourceUrl) => set({ browserUrl: url, browserTitle: title ?? null, browserSource: source ?? null, browserSourceUrl: sourceUrl ?? null }),
      closeBrowser: () => set({ browserUrl: null, browserTitle: null, browserSource: null, browserSourceUrl: null }),

      streamPrices: {},
      streamConnected: false,
      streamStatus: "offline" as const,
      setStreamQuote: (q) => set((state) => ({
        streamPrices: { ...state.streamPrices, [q.symbol]: q },
      })),
      setStreamConnected: (v) => set({ streamConnected: v, streamStatus: v ? "live" : "offline" }),
      setStreamStatus: (s) => set({ streamStatus: s, streamConnected: s === "live" }),
    }),
    {
      name: 'alpha-terminal-storage',
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const s = persistedState as Record<string, unknown>;
        if (version < 2) {
          const sym = (s['symbol'] as string | undefined) ?? 'AAPL';
          const existing = (s['recentSymbols'] as string[] | undefined) ?? [];
          s['recentSymbols'] = [sym, ...existing.filter(r => r !== sym)].slice(0, 14);
        }
        if (version < 3) {
          s['traderAccessToken'] = null;
          s['traderRefreshToken'] = null;
        }
        return s;
      },
      partialize: (state) => {
        const { streamPrices, streamConnected, streamStatus, browserUrl, browserTitle, browserSource, browserSourceUrl, ...persisted } = state;
        return persisted;
      },
    }
  )
);
