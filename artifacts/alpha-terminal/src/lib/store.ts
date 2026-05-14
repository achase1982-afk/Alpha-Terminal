import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { fetchWithAuth } from './fetchWithAuth';

const PERSIST_KEY = "alpha-terminal-storage";
const MAX_PERSISTED_STRATEGIST_HISTORY = 30;

function isQuotaExceeded(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
}

/**
 * Zustand JSON storage that handles localStorage quota: cap history, drop
 * completed strategist jobs from the blob, then retry (mobile Safari fills ~5MB fast).
 */
const quotaSafeLocalStorage: Storage = {
  get length() {
    return localStorage.length;
  },
  clear() {
    localStorage.clear();
  },
  getItem(key) {
    return localStorage.getItem(key);
  },
  key(index) {
    return localStorage.key(index);
  },
  removeItem(key) {
    localStorage.removeItem(key);
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch (e) {
      if (!isQuotaExceeded(e) || key !== PERSIST_KEY) throw e;
    }
    try {
      const parsed = JSON.parse(value) as { state?: Record<string, unknown> };
      const st = parsed.state;
      if (st) {
        if (Array.isArray(st["strategistHistory"])) {
          const h = st["strategistHistory"] as unknown[];
          st["strategistHistory"] = h.slice(-12);
        }
        const jobs = st["strategistJobs"] as Record<string, { status?: string }> | undefined;
        if (jobs && typeof jobs === "object") {
          const next: Record<string, unknown> = {};
          for (const [jid, j] of Object.entries(jobs)) {
            if (j?.status === "running" || j?.status === "interrupted") next[jid] = j;
          }
          st["strategistJobs"] = next;
        }
      }
      const trimmed = JSON.stringify(parsed);
      localStorage.setItem(key, trimmed);
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  },
};

// ---------- Watchlist cloud-sync helpers ----------
// Debounced pusher: any watchlist mutation schedules a push 1.5 s later.
// Multiple rapid edits (e.g. adding several symbols) coalesce into one request.
let _wlSyncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWatchlistSync() {
  if (_wlSyncTimer) clearTimeout(_wlSyncTimer);
  _wlSyncTimer = setTimeout(() => {
    const { watchlists } = useTerminalStore.getState();
    void pushWatchlistsToServer(watchlists);
  }, 1500);
}

async function pushWatchlistsToServer(
  watchlists: Record<string, { name: string; symbols: string[] }>,
): Promise<void> {
  try {
    await fetchWithAuth('/api/watchlists/terminal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchlists }),
    });
  } catch {
    // Non-fatal: local state is source of truth when offline.
  }
}

export async function loadWatchlistsFromServer(): Promise<void> {
  try {
    const res = await fetchWithAuth('/api/watchlists/terminal');
    if (!res.ok) return;
    const { watchlists } = (await res.json()) as {
      watchlists: Record<string, { name: string; symbols: string[] }>;
    };
    if (!watchlists || Object.keys(watchlists).length === 0) {
      // Server is empty on first login — upload the local state so it persists.
      scheduleWatchlistSync();
      return;
    }
    // Server wins: replace local watchlists with the server copy.
    const current = useTerminalStore.getState();
    const serverIds = Object.keys(watchlists);
    const nextActiveId = serverIds.includes(current.activeWatchlistId)
      ? current.activeWatchlistId
      : serverIds.includes('default')
        ? 'default'
        : serverIds[0];
    useTerminalStore.setState({ watchlists, activeWatchlistId: nextActiveId });
  } catch {
    // Offline or API error — keep local state.
  }
}

export interface LiveQuote {
  symbol:       string;
  last:         number | null;
  regularLast:  number | null;
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

/** Per-message id for streaming updates in Markets Chat tab. */
export interface MarketNewsChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface MarketNewsChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: MarketNewsChatMessage[];
}

export interface MarketNewsChatBundle {
  threadOrder: string[];
  threads: Record<string, MarketNewsChatThread>;
  activeThreadId: string;
}

const MAX_MARKET_NEWS_MESSAGES = 100;
const MAX_MARKET_NEWS_THREADS = 12;

function makeMarketNewsBundle(): MarketNewsChatBundle {
  const id = `mnt-${Date.now()}`;
  const now = Date.now();
  const thread: MarketNewsChatThread = { id, title: "Main", createdAt: now, updatedAt: now, messages: [] };
  return { threadOrder: [id], threads: { [id]: thread }, activeThreadId: id };
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
    analystModelProvider: 'anthropic' | 'google' | 'openai' | 'xai';
    analystModelName: string;
    analystTemperature: number;
    skepticModelProvider: 'anthropic' | 'google' | 'openai' | 'xai';
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

  /** Markets Chat tab: persisted per ticker, multi-thread (localStorage). */
  marketNewsChatBySymbol: Record<string, MarketNewsChatBundle>;
  marketNewsChatEnsureSymbol: (symbol: string) => void;
  marketNewsChatAppendMessage: (symbol: string, threadId: string, msg: MarketNewsChatMessage) => void;
  marketNewsChatSetAssistantContent: (symbol: string, threadId: string, messageId: string, content: string) => void;
  marketNewsChatCreateThread: (symbol: string) => void;
  marketNewsChatSelectThread: (symbol: string, threadId: string) => void;
  marketNewsChatClearActiveThread: (symbol: string) => void;
  marketNewsChatDeleteThread: (symbol: string, threadId: string) => void;

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
  browserSummary: string | null;
  openBrowser: (url: string, title?: string, source?: string, summary?: string) => void;
  setBrowserFallback: (url: string, title?: string, source?: string, summary?: string) => void;
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
    tokens: string[];
    nextSince: number;
    liveStatus: string;
    transcript: StrategistTranscriptTurn[];
    // Discriminator + metadata for trade-validation jobs (kicked off from
    // OrderTicket "Send to Strategist"). Absent / "analyze" for ticker
    // analysis jobs kicked off from the Strategist tab.
    kind?: 'analyze' | 'validation';
    validationMeta?: StrategistValidationMeta | null;
  }>;
  strategistHistory: Array<{
    id: number;
    jobId: string;
    ticker: string;
    createdAt: string;
    cardJson: unknown;
  }>;
  startStrategistJob: (jobId: string, ticker: string, opts?: { kind?: 'analyze' | 'validation'; validationMeta?: StrategistValidationMeta }) => void;
  /** Remove a job without marking error (e.g. superseded duplicate request). */
  cancelStrategistJob: (jobId: string) => void;
  completeStrategistJob: (jobId: string, result: unknown) => void;
  errorStrategistJob: (jobId: string, reason: string) => void;
  appendStrategistTokens: (jobId: string, tokens: string[], nextSince: number) => void;
  setStrategistTranscript: (jobId: string, transcript: StrategistTranscriptTurn[]) => void;
  setStrategistLiveStatus: (jobId: string, status: string) => void;
  setStrategistJobMeta: (jobId: string, patch: { kind?: 'analyze' | 'validation'; validationMeta?: StrategistValidationMeta | null }) => void;
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

// Mirrors the api-server ValidationMeta shape. Stored on validation jobs so
// the StrategistValidationCard can render the trader's thesis, the rolling-
// short flag, and the original ticket (for the "Send Order" reopen button)
// even before the verdict comes back.
export interface StrategistValidationMeta {
  ticker: string;
  mode: 'opening' | 'closing';
  ticket: {
    ticker: string;
    isOption: boolean;
    isMultiLeg: boolean;
    mode: 'opening' | 'closing';
    side?: 'BUY' | 'SELL';
    orderType: string;
    duration?: string;
    quantity: number;
    limitPrice?: number | null;
    legs?: Array<{
      instruction: string;
      strike?: number;
      optionType?: 'CALL' | 'PUT';
      expiration?: string;
      quantity?: number;
      bid?: number | null;
      ask?: number | null;
      delta?: number | null;
    }>;
    netPrice?: number | null;
    isCredit?: boolean | null;
    currentEntryPrice?: number | null;
    currentPnl?: number | null;
    daysHeld?: number | null;
    underlyingPrice?: number | null;
    underlyingChangePct?: number | null;
    estMaxRisk?: number | null;
    estMaxProfit?: number | null;
    breakeven?: number | null;
    // Underlying-shares position the trader currently holds in the same
    // ticker. Critical context for validating covered calls, covered puts,
    // married/protective puts, and assignment-mitigation trades.
    underlyingShares?: {
      side: 'long' | 'short';
      quantity: number;
      averagePrice?: number | null;
      marketValue?: number | null;
    } | null;
    // Stock leg attached to THIS order ticket (e.g. when the trader builds a
    // married-put / covered-call ticket from the stock screen with option
    // legs added). Distinct from `underlyingShares` (which is a position
    // already in the account). Both can be present simultaneously.
    stockLeg?: {
      instruction: 'BUY' | 'SELL';
      quantity: number;
      limitPrice?: number | null;
    } | null;
    // Frontend-only echoes (not sent to LLM) used to faithfully reopen the
    // OrderTicket from a strategist verdict card.
    optionSymbol?: string;
    optionInstruction?: string;
  };
  thesis?: string;
  rollingShort?: boolean;
}

// Mirrors the api-server TranscriptTurn shape; structured one-per-AI-turn entries
// the UI uses to render the debate transcript live (the per-ticker Strategist's
// Solo mode keeps this empty; the Send-to-Strategist trade validator's Solo
// mode emits a single 'solo' role turn instead of a Bull/Bear pair).
export interface StrategistTranscriptTurn {
  id: string;
  round: 1 | 2 | 3 | "synthesis" | "solo" | "desk";
  role: "A" | "B" | "synthesis" | "system" | "solo" | "vol" | "flow" | "catalyst" | "pm";
  phase: "propose" | "critique" | "final" | "synthesis" | "info" | "solo" | "analyst" | "pm";
  model: string;
  label: string;
  text: string;
  ts: number;
  done: boolean;
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
      aiTemp: 0,
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

      marketNewsChatBySymbol: {},
      marketNewsChatEnsureSymbol: (symbol) => {
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        set((state) => {
          if (state.marketNewsChatBySymbol[sym]) return {};
          return {
            marketNewsChatBySymbol: {
              ...state.marketNewsChatBySymbol,
              [sym]: makeMarketNewsBundle(),
            },
          };
        });
      },
      marketNewsChatAppendMessage: (symbol, threadId, msg) => {
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        set((state) => {
          let bundle = state.marketNewsChatBySymbol[sym];
          if (!bundle) bundle = makeMarketNewsBundle();
          const tid = threadId && bundle.threads[threadId] ? threadId : bundle.activeThreadId;
          const th = bundle.threads[tid];
          if (!th) return {};
          let nextMsgs = [...th.messages, msg];
          if (nextMsgs.length > MAX_MARKET_NEWS_MESSAGES) {
            nextMsgs = nextMsgs.slice(-MAX_MARKET_NEWS_MESSAGES);
          }
          const now = Date.now();
          const updatedThread: MarketNewsChatThread = { ...th, messages: nextMsgs, updatedAt: now };
          const order = [tid, ...bundle.threadOrder.filter((id) => id !== tid)];
          const nextBundle: MarketNewsChatBundle = {
            ...bundle,
            threads: { ...bundle.threads, [tid]: updatedThread },
            threadOrder: order,
            activeThreadId: tid,
          };
          return { marketNewsChatBySymbol: { ...state.marketNewsChatBySymbol, [sym]: nextBundle } };
        });
      },
      marketNewsChatSetAssistantContent: (symbol, threadId, messageId, content) => {
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        set((state) => {
          const bundle = state.marketNewsChatBySymbol[sym];
          if (!bundle) return {};
          const th = bundle.threads[threadId];
          if (!th) return {};
          const messages = th.messages.map((m) => (m.id === messageId ? { ...m, content } : m));
          return {
            marketNewsChatBySymbol: {
              ...state.marketNewsChatBySymbol,
              [sym]: {
                ...bundle,
                threads: {
                  ...bundle.threads,
                  [threadId]: { ...th, messages, updatedAt: Date.now() },
                },
              },
            },
          };
        });
      },
      marketNewsChatCreateThread: (symbol) => {
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        set((state) => {
          let bundle = state.marketNewsChatBySymbol[sym] ?? makeMarketNewsBundle();
          if (bundle.threadOrder.length >= MAX_MARKET_NEWS_THREADS) {
            const dropId = bundle.threadOrder[bundle.threadOrder.length - 1]!;
            const restThreads = { ...bundle.threads };
            delete restThreads[dropId];
            const restOrder = bundle.threadOrder.filter((id) => id !== dropId);
            let activeThreadId = bundle.activeThreadId;
            if (activeThreadId === dropId) activeThreadId = restOrder[0]!;
            bundle = { ...bundle, threads: restThreads, threadOrder: restOrder, activeThreadId };
          }
          const newId = `mnt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const now = Date.now();
          const n = bundle.threadOrder.length + 1;
          const thread: MarketNewsChatThread = {
            id: newId,
            title: `Chat ${n}`,
            createdAt: now,
            updatedAt: now,
            messages: [],
          };
          const nextBundle: MarketNewsChatBundle = {
            threadOrder: [newId, ...bundle.threadOrder],
            threads: { ...bundle.threads, [newId]: thread },
            activeThreadId: newId,
          };
          return { marketNewsChatBySymbol: { ...state.marketNewsChatBySymbol, [sym]: nextBundle } };
        });
      },
      marketNewsChatSelectThread: (symbol, threadId) => {
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        set((state) => {
          const bundle = state.marketNewsChatBySymbol[sym];
          if (!bundle || !bundle.threads[threadId]) return {};
          return {
            marketNewsChatBySymbol: {
              ...state.marketNewsChatBySymbol,
              [sym]: { ...bundle, activeThreadId: threadId },
            },
          };
        });
      },
      marketNewsChatClearActiveThread: (symbol) => {
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        set((state) => {
          const bundle = state.marketNewsChatBySymbol[sym];
          if (!bundle) return {};
          const tid = bundle.activeThreadId;
          const th = bundle.threads[tid];
          if (!th) return {};
          return {
            marketNewsChatBySymbol: {
              ...state.marketNewsChatBySymbol,
              [sym]: {
                ...bundle,
                threads: { ...bundle.threads, [tid]: { ...th, messages: [], updatedAt: Date.now() } },
              },
            },
          };
        });
      },
      marketNewsChatDeleteThread: (symbol, threadId) => {
        const sym = symbol.toUpperCase().trim();
        if (!sym) return;
        set((state) => {
          const bundle = state.marketNewsChatBySymbol[sym];
          if (!bundle || !bundle.threads[threadId]) return {};
          if (bundle.threadOrder.length <= 1) {
            return {
              marketNewsChatBySymbol: {
                ...state.marketNewsChatBySymbol,
                [sym]: makeMarketNewsBundle(),
              },
            };
          }
          const threads = { ...bundle.threads };
          delete threads[threadId];
          const threadOrder = bundle.threadOrder.filter((id) => id !== threadId);
          const activeThreadId =
            bundle.activeThreadId === threadId ? threadOrder[0]! : bundle.activeThreadId;
          return {
            marketNewsChatBySymbol: {
              ...state.marketNewsChatBySymbol,
              [sym]: { ...bundle, threads, threadOrder, activeThreadId },
            },
          };
        });
      },

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
        scheduleWatchlistSync();
      },
      removeFromWatchlist: (symbol) => {
        const upper = symbol.toUpperCase();
        set((state) => {
          const id = state.watchlists[state.activeWatchlistId] ? state.activeWatchlistId : "default";
          const wl = state.watchlists[id];
          if (!wl) return {};
          return { watchlists: { ...state.watchlists, [id]: { ...wl, symbols: wl.symbols.filter(s => s !== upper) } }, activeWatchlistId: id };
        });
        scheduleWatchlistSync();
      },
      createWatchlist: (name) => {
        const id = `wl_${Date.now()}`;
        set((state) => ({
          watchlists: { ...state.watchlists, [id]: { name, symbols: [] } },
          activeWatchlistId: id,
        }));
        scheduleWatchlistSync();
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
        scheduleWatchlistSync();
      },
      renameWatchlist: (id, name) => {
        set((state) => {
          const wl = state.watchlists[id];
          if (!wl) return {};
          return { watchlists: { ...state.watchlists, [id]: { ...wl, name } } };
        });
        scheduleWatchlistSync();
      },
      setActiveWatchlist: (id) => set({ activeWatchlistId: id }),

      browserUrl: null,
      browserTitle: null,
      browserSource: null,
      browserSummary: null,
      openBrowser: (url, title, source, summary) => set({ browserUrl: url, browserTitle: title ?? null, browserSource: source ?? null, browserSummary: summary ?? null }),
      setBrowserFallback: (url, title, source, summary) => set({ browserUrl: url, browserTitle: title ?? null, browserSource: source ?? null, browserSummary: summary ?? null }),
      closeBrowser: () => set({ browserUrl: null, browserTitle: null, browserSource: null, browserSummary: null }),

      liveNews: [] as LiveNewsItem[],
      addLiveNews: (item) => set((state) => {
        const updated = [item, ...state.liveNews];
        if (updated.length > 200) updated.length = 200;
        return { liveNews: updated };
      }),
      clearLiveNews: () => set({ liveNews: [] }),

      strategistJobs: {},
      strategistHistory: [],
      startStrategistJob: (jobId, ticker, opts) =>
        set((state) => {
          const sym = ticker.toUpperCase();
          const kind = opts?.kind ?? "analyze";
          const next: typeof state.strategistJobs = { ...state.strategistJobs };
          if (kind === "analyze") {
            for (const [id, j] of Object.entries(next)) {
              if (j.ticker === sym && j.status === "running" && j.kind === "analyze" && id !== jobId) {
                delete next[id];
              }
            }
          }
          next[jobId] = {
            jobId,
            ticker: sym,
            status: "running",
            result: null,
            startedAt: Date.now(),
            finishedAt: null,
            viewed: false,
            error: null,
            tokens: [],
            nextSince: 0,
            liveStatus: opts?.kind === "validation" ? "Starting trade validation…" : "Starting analysis…",
            transcript: [],
            kind,
            validationMeta: opts?.validationMeta ?? null,
          };
          return { strategistJobs: next };
        }),
      cancelStrategistJob: (jobId) =>
        set((state) => {
          if (!state.strategistJobs[jobId]) return {};
          const { [jobId]: _removed, ...rest } = state.strategistJobs;
          return { strategistJobs: rest };
        }),
      setStrategistJobMeta: (jobId, patch) =>
        set((state) => {
          const job = state.strategistJobs[jobId];
          if (!job) return {};
          // Avoid useless re-renders: skip if nothing actually changes.
          const nextKind = patch.kind ?? job.kind;
          const nextMeta = patch.validationMeta !== undefined ? patch.validationMeta : job.validationMeta;
          if (nextKind === job.kind && nextMeta === job.validationMeta) return {};
          return {
            strategistJobs: {
              ...state.strategistJobs,
              [jobId]: { ...job, kind: nextKind, validationMeta: nextMeta },
            },
          };
        }),
      setStrategistTranscript: (jobId, transcript) =>
        set((state) => {
          const job = state.strategistJobs[jobId];
          if (!job) return {};
          const prev = job.transcript;
          // Fast-path: both empty (every Solo-mode poll hits this).
          if (prev.length === 0 && transcript.length === 0) return {};
          // Per-turn equality across the whole array — debate runs A/B in
          // parallel, so a turn ANYWHERE may have just gained tokens, not
          // only the last one.
          if (prev.length === transcript.length) {
            let identical = true;
            for (let i = 0; i < prev.length; i++) {
              const a = prev[i];
              const b = transcript[i];
              if (a.id !== b.id || a.done !== b.done || a.text.length !== b.text.length) {
                identical = false;
                break;
              }
            }
            if (identical) return {};
          }
          return {
            strategistJobs: {
              ...state.strategistJobs,
              [jobId]: { ...job, transcript },
            },
          };
        }),
      appendStrategistTokens: (jobId, tokens, nextSince) =>
        set((state) => {
          const job = state.strategistJobs[jobId];
          if (!job) return {};
          // Idempotency guard: if a takeover poller and the original poller
          // briefly overlap, both may push the same tokens. Only apply when
          // the incoming nextSince advances the cursor past what we already
          // have. (Equal nextSince with no tokens is a harmless heartbeat.)
          if (tokens.length > 0 && nextSince <= job.nextSince) return {};
          if (tokens.length === 0 && nextSince === job.nextSince) return {};
          const merged = tokens.length > 0 ? job.tokens.concat(tokens) : job.tokens;
          // Cap memory: keep last ~6000 tokens
          const capped = merged.length > 6000 ? merged.slice(merged.length - 6000) : merged;
          return {
            strategistJobs: {
              ...state.strategistJobs,
              [jobId]: { ...job, tokens: capped, nextSince },
            },
          };
        }),
      setStrategistLiveStatus: (jobId, status) =>
        set((state) => {
          const job = state.strategistJobs[jobId];
          if (!job || job.liveStatus === status) return {};
          return {
            strategistJobs: {
              ...state.strategistJobs,
              [jobId]: { ...job, liveStatus: status },
            },
          };
        }),
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
      version: 24,
      storage: createJSONStorage(() => quotaSafeLocalStorage),
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
        if (version < 20) {
          // claude-sonnet-4-7 was never released by Anthropic. Remap any user
          // who selected this phantom model onto the real Sonnet (4-6).
          const fix = (m: unknown) => (m === 'claude-sonnet-4-7' ? 'claude-sonnet-4-6' : m);
          if (typeof s['aiModel'] === 'string') s['aiModel'] = fix(s['aiModel']);
          const features = s['aiFeatureSettings'] as Record<string, { model: string; temperature: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              if (features[key]?.model === 'claude-sonnet-4-7') features[key].model = 'claude-sonnet-4-6';
            }
          }
          const cfg = s['aiLabStrategistConfig'] as Record<string, unknown> | undefined;
          if (cfg && typeof cfg === 'object') {
            cfg['analystModelName'] = fix(cfg['analystModelName']);
            cfg['skepticModelName'] = fix(cfg['skepticModelName']);
          }
        }
        if (version < 24) {
          if (!s["marketNewsChatBySymbol"] || typeof s["marketNewsChatBySymbol"] !== "object") {
            s["marketNewsChatBySymbol"] = {};
          }
        }
        if (version < 23) {
          const hist = s['strategistHistory'];
          if (Array.isArray(hist) && hist.length > MAX_PERSISTED_STRATEGIST_HISTORY) {
            s['strategistHistory'] = hist.slice(-MAX_PERSISTED_STRATEGIST_HISTORY);
          }
        }
        if (version < 22) {
          const t = s['aiTemp'];
          if (typeof t === 'number' && t !== 0) s['aiTemp'] = 0;
          const features = s['aiFeatureSettings'] as Record<string, { model?: string; temperature?: number }> | undefined;
          if (features) {
            for (const key of Object.keys(features)) {
              const row = features[key];
              if (row && typeof row.temperature === 'number' && row.temperature !== 0) {
                row.temperature = 0;
              }
            }
          }
        }
        // v21: strategistJobs is now persisted. Sweep any "running" jobs that
        // are stale (older than 10 minutes) on rehydrate — the server will
        // have GC'd them and continuing to poll just produces 404 noise. Their
        // real result (if any) lives in strategistHistory anyway.
        {
          const jobs = s['strategistJobs'] as Record<string, { status?: string; startedAt?: number }> | undefined;
          if (jobs && typeof jobs === 'object') {
            const STALE_MS = 10 * 60 * 1000;
            const now = Date.now();
            for (const id of Object.keys(jobs)) {
              const j = jobs[id];
              if (!j) continue;
              if (j.status === 'running' && typeof j.startedAt === 'number' && now - j.startedAt > STALE_MS) {
                j.status = 'interrupted';
              }
            }
          }
        }
        return s;
      },
      partialize: (state) => {
        // strategistJobs IS persisted now: when the user backgrounds/closes
        // the app mid-analysis (especially on iOS where the JS context gets
        // killed), the in-flight job state needs to survive so the reattach
        // effect can resume polling on cold load. Jobs older than 10 minutes
        // are swept to "interrupted" during migration below to avoid polling
        // server-side jobs that have already been GC'd.
        const { streamPrices, streamConnected, streamStatus, browserUrl, browserTitle, browserSource, browserSummary, liveNews, strategistHistory, ...rest } = state;
        const cappedHistory =
          strategistHistory.length > MAX_PERSISTED_STRATEGIST_HISTORY
            ? strategistHistory.slice(-MAX_PERSISTED_STRATEGIST_HISTORY)
            : strategistHistory;
        return { ...rest, strategistHistory: cappedHistory };
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
