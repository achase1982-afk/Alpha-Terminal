import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LiveQuote {
  symbol:       string;
  last:         number | null;
  extendedLast: number | null;
  bid:          number | null;
  ask:          number | null;
  bidSize:      number | null;
  askSize:      number | null;
  change:       number | null;
  changePct:    number | null;
  volume:       number | null;
  high:         number | null;
  low:          number | null;
  close:        number | null;
  ts:           number;
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

  aiFeatureSettings: {
    marketPulse:   { model: string; temperature: number };
    technicals:    { model: string; temperature: number };
    strategist:    { model: string; temperature: number };
    chat:          { model: string; temperature: number };
    scanner:       { model: string; temperature: number };
  };
  setAiFeatureSetting: (
    feature: keyof TerminalState['aiFeatureSettings'],
    key: 'model' | 'temperature',
    value: string | number,
  ) => void;
  
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

  preTradeEnabled: boolean;
  setPreTradeEnabled: (v: boolean) => void;
  preTradeBlockOnRed: boolean;
  setPreTradeBlockOnRed: (v: boolean) => void;
  preTradeMinRR: number;
  setPreTradeMinRR: (v: number) => void;
  preTradeMaxPositionPct: number;
  setPreTradeMaxPositionPct: (v: number) => void;
  preTradeMinDTE: number;
  setPreTradeMinDTE: (v: number) => void;
  accountSize: number;
  setAccountSize: (v: number) => void;

  chatHistory: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: () => void;

  watchlists: Record<string, { name: string; symbols: string[] }>;
  activeWatchlistId: string;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  createWatchlist: (name: string) => string;
  deleteWatchlist: (id: string) => void;
  renameWatchlist: (id: string, name: string) => void;
  setActiveWatchlist: (id: string) => void;

  browserUrl: string | null;
  browserTitle: string | null;
  browserSource: string | null;
  openBrowser: (url: string, title?: string, source?: string) => void;
  closeBrowser: () => void;

  // ── Streaming (NOT persisted) ─────────────────────────────────────────────
  streamPrices: Record<string, LiveQuote>;
  streamConnected: boolean;
  streamStatus: "offline" | "connecting" | "live";
  setStreamQuote: (q: LiveQuote) => void;
  setStreamConnected: (v: boolean) => void;
  setStreamStatus: (s: "offline" | "connecting" | "live") => void;

  liveNews: LiveNewsItem[];
  addLiveNews: (item: LiveNewsItem) => void;
  clearLiveNews: () => void;
}

export interface LiveNewsItem {
  time: string;
  providerCode: string;
  articleId: string;
  headline: string;
  extraData?: string;
  source: "live" | "historical";
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

      aiModel: 'gemini-3.1-pro-preview',
      setAiModel: (aiModel) => set({ aiModel }),
      aiTemp: 0.7,
      setAiTemp: (aiTemp) => set({ aiTemp }),

      aiFeatureSettings: {
        marketPulse:   { model: 'gemini-3.1-pro-preview', temperature: 0 },
        technicals:    { model: 'gemini-3.1-pro-preview', temperature: 0 },
        strategist:    { model: 'gemini-3.1-pro-preview', temperature: 0 },
        chat:          { model: 'gemini-3.1-pro-preview', temperature: 0 },
        scanner:       { model: 'gemini-3.1-pro-preview', temperature: 0 },
      },
      setAiFeatureSetting: (feature, key, value) =>
        set((state) => ({
          aiFeatureSettings: {
            ...state.aiFeatureSettings,
            [feature]: { ...state.aiFeatureSettings[feature], [key]: value },
          },
        })),

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

      preTradeEnabled: true,
      setPreTradeEnabled: (preTradeEnabled) => set({ preTradeEnabled }),
      preTradeBlockOnRed: false,
      setPreTradeBlockOnRed: (preTradeBlockOnRed) => set({ preTradeBlockOnRed }),
      preTradeMinRR: 0.25,
      setPreTradeMinRR: (preTradeMinRR) => set({ preTradeMinRR }),
      preTradeMaxPositionPct: 3,
      setPreTradeMaxPositionPct: (preTradeMaxPositionPct) => set({ preTradeMaxPositionPct }),
      preTradeMinDTE: 5,
      setPreTradeMinDTE: (preTradeMinDTE) => set({ preTradeMinDTE }),
      accountSize: 25000,
      setAccountSize: (accountSize) => set({ accountSize }),

      chatHistory: [],
      addChatMessage: (msg) => set((state) => ({ chatHistory: [...state.chatHistory, msg] })),
      clearChat: () => set({ chatHistory: [] }),

      watchlists: { default: { name: "My Watchlist", symbols: [] } },
      activeWatchlistId: "default",
      addToWatchlist: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => {
          const id = state.watchlists[state.activeWatchlistId] ? state.activeWatchlistId : "default";
          const wl = state.watchlists[id];
          if (!wl || wl.symbols.includes(upper)) return {};
          return { watchlists: { ...state.watchlists, [id]: { ...wl, symbols: [...wl.symbols, upper] } }, activeWatchlistId: id };
        });
      },
      removeFromWatchlist: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => {
          const id = state.watchlists[state.activeWatchlistId] ? state.activeWatchlistId : "default";
          const wl = state.watchlists[id];
          if (!wl) return {};
          return { watchlists: { ...state.watchlists, [id]: { ...wl, symbols: wl.symbols.filter(s => s !== upper) } }, activeWatchlistId: id };
        });
      },
      createWatchlist: (name) => {
        const id = `wl_${Date.now()}`;
        set((state) => ({
          watchlists: { ...state.watchlists, [id]: { name, symbols: [] } },
          activeWatchlistId: id,
        }));
        return id;
      },
      deleteWatchlist: (id) => {
        set((state) => {
          if (id === "default") return {};
          const next = { ...state.watchlists };
          delete next[id];
          return {
            watchlists: next,
            activeWatchlistId: state.activeWatchlistId === id ? "default" : state.activeWatchlistId,
          };
        });
      },
      renameWatchlist: (id, name) => {
        set((state) => {
          const wl = state.watchlists[id];
          if (!wl) return {};
          return { watchlists: { ...state.watchlists, [id]: { ...wl, name } } };
        });
      },
      setActiveWatchlist: (id) => set({ activeWatchlistId: id }),

      browserUrl: null,
      browserTitle: null,
      browserSource: null,
      openBrowser: (url, title, source) => set({ browserUrl: url, browserTitle: title ?? null, browserSource: source ?? null }),
      closeBrowser: () => set({ browserUrl: null, browserTitle: null, browserSource: null }),

      liveNews: [] as LiveNewsItem[],
      addLiveNews: (item) => set((state) => {
        const updated = [item, ...state.liveNews];
        if (updated.length > 200) updated.length = 200;
        return { liveNews: updated };
      }),
      clearLiveNews: () => set({ liveNews: [] }),

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
      version: 6,
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
        if (version < 4) {
          s['aiModel'] = 'gemini-3.1-pro-preview';
        }
        if (version < 5) {
          s['aiModel'] = 'gemini-3.1-pro-preview';
          s['aiFeatureSettings'] = {
            marketPulse:   { model: 'gemini-3.1-pro-preview', temperature: 0 },
            technicals:    { model: 'gemini-3.1-pro-preview', temperature: 0 },
            strategist:    { model: 'gemini-3.1-pro-preview', temperature: 0 },
            chat:          { model: 'gemini-3.1-pro-preview', temperature: 0 },
            scanner:       { model: 'gemini-3.1-pro-preview', temperature: 0 },
          };
        }
        if (version < 6) {
          const oldWl = Array.isArray(s['watchlist']) ? s['watchlist'] as string[] : [];
          s['watchlists'] = { default: { name: 'My Watchlist', symbols: oldWl } };
          s['activeWatchlistId'] = 'default';
          delete s['watchlist'];
        }
        return s;
      },
      partialize: (state) => {
        const { streamPrices, streamConnected, streamStatus, browserUrl, browserTitle, browserSource, liveNews, ...persisted } = state;
        return persisted;
      },
    }
  )
);

export function useActiveWatchlist() {
  return useTerminalStore((s) => {
    const wl = s.watchlists[s.activeWatchlistId];
    return wl?.symbols ?? [];
  });
}
