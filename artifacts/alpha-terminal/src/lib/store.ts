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

export type NotificationEventType =
  | 'OrderCreated' | 'OrderAccepted' | 'ExecutionCreated'
  | 'CancelAccepted' | 'OrderUROutCompleted' | 'OrderRejected'
  | 'CancelRejected' | 'OrderExpired' | 'OrderModified';

export interface TerminalState {
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

  notificationPrefs: {
    masterEnabled: boolean;
    inApp: {
      OrderCreated: boolean;
      OrderAccepted: boolean;
      ExecutionCreated: boolean;
      CancelAccepted: boolean;
      OrderUROutCompleted: boolean;
      OrderRejected: boolean;
      CancelRejected: boolean;
      OrderExpired: boolean;
      OrderModified: boolean;
    };
    push: {
      OrderCreated: boolean;
      OrderAccepted: boolean;
      ExecutionCreated: boolean;
      CancelAccepted: boolean;
      OrderUROutCompleted: boolean;
      OrderRejected: boolean;
      CancelRejected: boolean;
      OrderExpired: boolean;
      OrderModified: boolean;
    };
    sound: boolean;
  };
  setNotificationPref: (
    category: 'masterEnabled' | 'sound',
    value: boolean,
  ) => void;
  setNotificationChannelPref: (
    channel: 'inApp' | 'push',
    eventType: NotificationEventType,
    value: boolean,
  ) => void;
  setAllNotificationPrefs: (
    channel: 'inApp' | 'push',
    value: boolean,
  ) => void;

  aiLabStrategistConfig: {
    analystModelProvider: 'anthropic' | 'google';
    analystModelName: string;
    analystTemperature: number;
    skepticModelProvider: 'anthropic' | 'google';
    skepticModelName: string;
    skepticTemperature: number;
    enabled: boolean;
  };
  setAiLabStrategistConfig: (
    key: string,
    value: string | number | boolean,
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

  // ── Strategist V2 jobs + history (jobs ephemeral, history cached) ─────────
  strategistJobs: Record<string, {
    jobId: string;
    ticker: string;
    status: 'running' | 'done' | 'error' | 'interrupted';
    result: unknown | null;
    startedAt: number;
    finishedAt: number | null;
    viewed: boolean;
    error?: string | null;
  }>;
  strategistHistory: Array<{
    id: number;
    jobId: string;
    ticker: string;
    createdAt: string;
    cardJson: unknown;
  }>;
  startStrategistJob: (jobId: string, ticker: string) => void;
  completeStrategistJob: (jobId: string, result: unknown) => void;
  errorStrategistJob: (jobId: string, reason: string) => void;
  markStrategistJobsViewed: () => void;
  setStrategistHistory: (list: Array<{ id: number; jobId: string; ticker: string; createdAt: string; cardJson: unknown }>) => void;
  removeHistoryCard: (id: number) => void;
  clearAllHistory: () => void;

  // ── Streaming (NOT persisted) ─────────────────────────────────────────────
  streamPrices: Record<string, LiveQuote>;
  streamConnected: boolean;
  streamStatus: "offline" | "connecting" | "live";
  setStreamQuote: (q: LiveQuote) => void;
  setStreamQuotes: (quotes: LiveQuote[]) => void;
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

      aiModel: 'claude-opus-4-6',
      setAiModel: (aiModel) => set({ aiModel }),
      aiTemp: 0.7,
      setAiTemp: (aiTemp) => set({ aiTemp }),

      aiFeatureSettings: {
        marketPulse:   { model: 'claude-opus-4-6', temperature: 0 },
        technicals:    { model: 'claude-opus-4-6', temperature: 0 },
        strategist:    { model: 'claude-opus-4-6', temperature: 0 },
        chat:          { model: 'claude-opus-4-6', temperature: 0 },
        scanner:       { model: 'claude-opus-4-6', temperature: 0 },
      },
      setAiFeatureSetting: (feature, key, value) =>
        set((state) => ({
          aiFeatureSettings: {
            ...state.aiFeatureSettings,
            [feature]: { ...state.aiFeatureSettings[feature], [key]: value },
          },
        })),

      notificationPrefs: {
        masterEnabled: true,
        inApp: {
          OrderCreated: true,
          OrderAccepted: false,
          ExecutionCreated: true,
          CancelAccepted: true,
          OrderUROutCompleted: false,
          OrderRejected: true,
          CancelRejected: true,
          OrderExpired: true,
          OrderModified: true,
        },
        push: {
          OrderCreated: false,
          OrderAccepted: false,
          ExecutionCreated: true,
          CancelAccepted: false,
          OrderUROutCompleted: false,
          OrderRejected: true,
          CancelRejected: true,
          OrderExpired: true,
          OrderModified: false,
        },
        sound: false,
      },
      setNotificationPref: (category, value) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, [category]: value },
        })),
      setNotificationChannelPref: (channel, eventType, value) =>
        set((state) => ({
          notificationPrefs: {
            ...state.notificationPrefs,
            [channel]: { ...state.notificationPrefs[channel], [eventType]: value },
          },
        })),
      setAllNotificationPrefs: (channel, value) =>
        set((state) => {
          const updated = { ...state.notificationPrefs[channel] };
          for (const k of Object.keys(updated)) {
            (updated as Record<string, boolean>)[k] = value;
          }
          return {
            notificationPrefs: { ...state.notificationPrefs, [channel]: updated },
          };
        }),

      aiLabStrategistConfig: {
        analystModelProvider: 'anthropic',
        analystModelName: 'claude-opus-4-6',
        analystTemperature: 0,
        skepticModelProvider: 'google',
        skepticModelName: 'gemini-3.1-pro-preview',
        skepticTemperature: 0,
        enabled: true,
      },
      setAiLabStrategistConfig: (key, value) =>
        set((state) => ({
          aiLabStrategistConfig: {
            ...state.aiLabStrategistConfig,
            [key]: value,
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

      strategistJobs: {},
      strategistHistory: [],
      startStrategistJob: (jobId, ticker) =>
        set((state) => ({
          strategistJobs: {
            ...state.strategistJobs,
            [jobId]: {
              jobId,
              ticker: ticker.toUpperCase(),
              status: 'running',
              result: null,
              startedAt: Date.now(),
              finishedAt: null,
              viewed: false,
              error: null,
            },
          },
        })),
      completeStrategistJob: (jobId, result) =>
        set((state) => {
          const job = state.strategistJobs[jobId];
          if (!job) return {};
          return {
            strategistJobs: {
              ...state.strategistJobs,
              // viewed stays false on transition from running -> done so the
              // indicator can show "new result"; the consumer decides when to
              // mark viewed (e.g. when strategist tab is currently active).
              [jobId]: { ...job, status: 'done', result, finishedAt: Date.now(), viewed: false },
            },
          };
        }),
      errorStrategistJob: (jobId, reason) =>
        set((state) => {
          const job = state.strategistJobs[jobId];
          if (!job) return {};
          return {
            strategistJobs: {
              ...state.strategistJobs,
              [jobId]: { ...job, status: 'error', error: reason, finishedAt: Date.now() },
            },
          };
        }),
      markStrategistJobsViewed: () =>
        set((state) => {
          // Only mark *finished* jobs as viewed; leave running jobs alone so
          // they can transition to a "new result" indicator when they complete.
          const next: TerminalState['strategistJobs'] = {};
          let changed = false;
          for (const [k, j] of Object.entries(state.strategistJobs)) {
            if (!j.viewed && (j.status === 'done' || j.status === 'error')) {
              next[k] = { ...j, viewed: true };
              changed = true;
            } else {
              next[k] = j;
            }
          }
          return changed ? { strategistJobs: next } : {};
        }),
      setStrategistHistory: (list) => set({ strategistHistory: list }),
      removeHistoryCard: (id) =>
        set((state) => ({
          strategistHistory: state.strategistHistory.filter((h) => h.id !== id),
        })),
      clearAllHistory: () => set({ strategistHistory: [] }),

      streamPrices: {},
      streamConnected: false,
      streamStatus: "offline" as const,
      setStreamQuote: (q) => set((state) => ({
        streamPrices: { ...state.streamPrices, [q.symbol]: q },
      })),
      setStreamQuotes: (quotes) => set((state) => {
        const next = { ...state.streamPrices };
        for (const q of quotes) next[q.symbol] = q;
        return { streamPrices: next };
      }),
      setStreamConnected: (v) => set({ streamConnected: v, streamStatus: v ? "live" : "offline" }),
      setStreamStatus: (s) => set({ streamStatus: s, streamConnected: s === "live" }),
    }),
    {
      name: 'alpha-terminal-storage',
      version: 19,
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
          s['aiModel'] = 'claude-3-5-sonnet-20241022';
        }
        if (version < 5) {
          s['aiModel'] = 'claude-3-5-sonnet-20241022';
          s['aiFeatureSettings'] = {
            marketPulse:   { model: 'claude-3-5-sonnet-20241022', temperature: 0 },
            technicals:    { model: 'claude-3-5-sonnet-20241022', temperature: 0 },
            strategist:    { model: 'claude-3-5-sonnet-20241022', temperature: 0 },
            chat:          { model: 'claude-3-5-sonnet-20241022', temperature: 0 },
            scanner:       { model: 'claude-3-5-sonnet-20241022', temperature: 0 },
          };
        }
        if (version < 6) {
          const oldWl = Array.isArray(s['watchlist']) ? s['watchlist'] as string[] : [];
          s['watchlists'] = { default: { name: 'My Watchlist', symbols: oldWl } };
          s['activeWatchlistId'] = 'default';
          delete s['watchlist'];
        }
        if (version < 7) {
          const model = s['aiModel'] as string | undefined;
          if (!model || model.startsWith('gemini')) {
            s['aiModel'] = 'claude-opus-4-20250514';
          }
          const features = s['aiFeatureSettings'] as Record<string, { model: string; temperature: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              if (features[key]?.model?.startsWith('gemini')) {
                features[key].model = 'claude-opus-4-20250514';
              }
            }
          }
        }
        if (version < 8) {
          s['aiModel'] = 'claude-sonnet-4-20250514';
          const features = s['aiFeatureSettings'] as Record<string, { model: string; temperature: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              features[key].model = 'claude-sonnet-4-20250514';
            }
          }
        }
        if (version < 9) {
          s['aiModel'] = 'claude-sonnet-4-20250514';
          const features = s['aiFeatureSettings'] as Record<string, { model: string; temperature: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              features[key].model = 'claude-sonnet-4-20250514';
            }
          }
        }
        if (version < 10) {
          const model = s['aiModel'] as string | undefined;
          if (model && model.includes('4-6')) {
            s['aiModel'] = 'claude-sonnet-4-20250514';
          }
          const features = s['aiFeatureSettings'] as Record<string, { model: string; temperature: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              if (features[key]?.model?.includes('4-6')) {
                features[key].model = 'claude-sonnet-4-20250514';
              }
            }
          }
        }
        if (version < 11) {
          if (!s['aiLabStrategistConfig']) {
            s['aiLabStrategistConfig'] = {
              analystModelProvider: 'anthropic',
              analystModelName: 'claude-sonnet-4-20250514',
              analystTemperature: 0,
              skepticModelProvider: 'google',
              skepticModelName: 'gemini-3.1-pro-preview',
              skepticTemperature: 0,
              enabled: false,
            };
          }
        }
        if (version < 12) {
          const cfg = s['aiLabStrategistConfig'] as Record<string, unknown> | undefined;
          if (cfg && typeof cfg === 'object' && 'mode' in cfg) {
            delete cfg['mode'];
          }
        }
        if (version < 13) {
          const cfg = s['aiLabStrategistConfig'] as Record<string, unknown> | undefined;
          if (cfg && typeof cfg === 'object') {
            cfg['enabled'] = true;
          }
        }
        if (version < 14) {
          const defaultInApp = {
            OrderCreated: true, OrderAccepted: false, ExecutionCreated: true,
            CancelAccepted: true, OrderUROutCompleted: false, OrderRejected: true,
            CancelRejected: true, OrderExpired: true, OrderModified: true,
          };
          const defaultPush = {
            OrderCreated: false, OrderAccepted: false, ExecutionCreated: true,
            CancelAccepted: false, OrderUROutCompleted: false, OrderRejected: true,
            CancelRejected: true, OrderExpired: true, OrderModified: false,
          };
          const existing = (s as Record<string, unknown>)['notificationPrefs'] as Record<string, unknown> | undefined;
          (s as Record<string, unknown>)['notificationPrefs'] = {
            masterEnabled: existing?.masterEnabled ?? true,
            inApp: { ...defaultInApp, ...(existing?.inApp as Record<string, boolean> | undefined) },
            push: { ...defaultPush, ...(existing?.push as Record<string, boolean> | undefined) },
            sound: existing?.sound ?? false,
          };
        }
        if (version < 15) {
          const cfg = s['aiLabStrategistConfig'] as Record<string, unknown> | undefined;
          if (cfg && typeof cfg === 'object') {
            cfg['enabled'] = true;
          }
        }
        if (version < 16) {
          s['aiModel'] = 'claude-opus-4-20250514';
          const features = s['aiFeatureSettings'] as Record<string, { model: string; temperature: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              if (features[key]?.model?.startsWith('claude-sonnet-4') || features[key]?.model?.startsWith('claude-3')) {
                features[key].model = 'claude-opus-4-20250514';
              }
            }
          }
          const cfg = s['aiLabStrategistConfig'] as Record<string, unknown> | undefined;
          if (cfg && typeof cfg === 'object') {
            if (typeof cfg['analystModelName'] === 'string' && (cfg['analystModelName'] as string).startsWith('claude-sonnet-4')) {
              cfg['analystModelName'] = 'claude-opus-4-20250514';
            }
          }
        }
        if (version < 17) {
          const old46Map: Record<string, string> = {
            'claude-opus-4-20250514': 'claude-opus-4-6',
            'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
          };
          const upgrade46 = (m: string) => old46Map[m] ?? m;
          s['aiModel'] = upgrade46(s['aiModel'] as string ?? 'claude-opus-4-6');
          const features = s['aiFeatureSettings'] as Record<string, { model: string; temperature: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              if (features[key]?.model) {
                features[key].model = upgrade46(features[key].model);
              }
            }
          }
          const cfg = s['aiLabStrategistConfig'] as Record<string, unknown> | undefined;
          if (cfg && typeof cfg === 'object' && typeof cfg['analystModelName'] === 'string') {
            cfg['analystModelName'] = upgrade46(cfg['analystModelName'] as string);
          }
        }
        if (version < 18) {
          const cfg = s['aiLabStrategistConfig'] as Record<string, unknown> | undefined;
          if (cfg && typeof cfg === 'object') {
            cfg['skepticModelName'] = 'gemini-3.1-pro-preview';
          }
        }
        if (version < 19) {
          if (!s['strategistJobs'] || typeof s['strategistJobs'] !== 'object') s['strategistJobs'] = {};
          if (!Array.isArray(s['strategistHistory'])) s['strategistHistory'] = [];
        }
        return s;
      },
      partialize: (state) => {
        const { streamPrices, streamConnected, streamStatus, browserUrl, browserTitle, browserSource, liveNews, strategistJobs, ...persisted } = state;
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
