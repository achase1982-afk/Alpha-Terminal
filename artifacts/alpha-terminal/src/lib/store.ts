import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LiveQuote {
  symbol:     string;
  last:       number | null;
  bid:        number | null;
  ask:        number | null;
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
  // Auth
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string) => void;
  clearTokens: () => void;

  // Market Configuration
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

  // AI Configuration
  aiModel: string;
  setAiModel: (m: string) => void;
  aiTemp: number;
  setAiTemp: (t: number) => void;
  
  // Ticker Tape (scrolling marquee)
  tickerTapeSymbols: string[];
  setTickerTapeSymbols: (symbols: string[]) => void;
  tapeSpeed: number;
  setTapeSpeed: (speed: number) => void;

  // Macro Cards (user-configurable)
  macroSymbols: string[];
  setMacroSymbols: (symbols: string[]) => void;

  // AI Results (shared across tabs)
  analysisResult: string | null;
  setAnalysisResult: (r: string | null) => void;
  strategistResult: string | null;
  setStrategistResult: (r: string | null) => void;
  briefingResult: string | null;
  setBriefingResult: (r: string | null) => void;

  // AI Chat
  chatHistory: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: () => void;

  // ── Streaming (NOT persisted) ─────────────────────────────────────────────
  streamPrices: Record<string, LiveQuote>;
  streamConnected: boolean;
  setStreamQuote: (q: LiveQuote) => void;
  setStreamConnected: (v: boolean) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      // Auth
      accessToken: null,
      refreshToken: null,
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      clearTokens: () => set({ accessToken: null, refreshToken: null }),

      // Market
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

      // AI
      aiModel: 'gemini-2.5-pro',
      setAiModel: (aiModel) => set({ aiModel }),
      aiTemp: 0.7,
      setAiTemp: (aiTemp) => set({ aiTemp }),

      // Ticker Tape
      tickerTapeSymbols: ['SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'TSLA', 'NVDA', 'AAPL', 'META', 'MSFT', 'AMZN', 'GOOGL'],
      setTickerTapeSymbols: (tickerTapeSymbols) => set({ tickerTapeSymbols }),
      tapeSpeed: 25,
      setTapeSpeed: (tapeSpeed) => set({ tapeSpeed }),

      // Macro Cards
      macroSymbols: ['SPY', 'QQQ', 'IWM', 'VIX'],
      setMacroSymbols: (macroSymbols) => set({ macroSymbols }),

      // AI Results
      analysisResult: null,
      setAnalysisResult: (analysisResult) => set({ analysisResult }),
      strategistResult: null,
      setStrategistResult: (strategistResult) => set({ strategistResult }),
      briefingResult: null,
      setBriefingResult: (briefingResult) => set({ briefingResult }),

      // Chat
      chatHistory: [],
      addChatMessage: (msg) => set((state) => ({ chatHistory: [...state.chatHistory, msg] })),
      clearChat: () => set({ chatHistory: [] }),

      // Streaming prices — volatile, never persisted
      streamPrices: {},
      streamConnected: false,
      setStreamQuote: (q) => set((state) => ({
        streamPrices: { ...state.streamPrices, [q.symbol]: q },
      })),
      setStreamConnected: (v) => set({ streamConnected: v }),
    }),
    {
      name: 'alpha-terminal-storage',
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const s = persistedState as Record<string, unknown>;
        if (version < 2) {
          const sym = (s['symbol'] as string | undefined) ?? 'AAPL';
          const existing = (s['recentSymbols'] as string[] | undefined) ?? [];
          s['recentSymbols'] = [sym, ...existing.filter(r => r !== sym)].slice(0, 14);
        }
        return s;
      },
      partialize: (state) => {
        const { streamPrices, streamConnected, ...persisted } = state;
        return persisted;
      },
    }
  )
);
