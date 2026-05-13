import { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar, type SidebarHandle } from "@/components/Sidebar";
import { MetricsBar, VolumeBar } from "@/components/MetricsBar";
import { TradingChart } from "@/components/TradingChart";
import { OptionsTab } from "@/components/OptionsTab";
import { AiIntelligenceTab } from "@/components/AiIntelligenceTab";
import { MacroBar } from "@/components/MacroBar";
import { TickerTape } from "@/components/TickerTape";
import { SearchOverlay } from "@/components/SearchOverlay";
import { MarketDataTabs, type MarketDataTab } from "@/components/MarketDataTabs";
import { useTerminalStore, loadWatchlistsFromServer } from "@/lib/store";
import { useUICustomizationStore } from "@/lib/ui-customization-store";
import { useUIThemeSync } from "@/hooks/useUIThemeSync";
import { useGetPriceHistory } from "@workspace/api-client-react";
import type { PriceHistoryResponse } from "@workspace/api-client-react";
import { ChartControls, chartParamsFromStore, isIntradayInterval } from "@/components/ChartControls";
import { useAutoRefreshToken } from "@/hooks/useAutoRefreshToken";
import { useMarketStream } from "@/hooks/useMarketStream";
import { useViewportShell } from "@/hooks/useViewportShell";

import { InAppBrowser } from "@/components/InAppBrowser";
import { OrderTicket, type OrderLeg } from "@/components/OrderTicket";
import type { StrategistValidationMeta } from "@/lib/store";
import type { StrategistSendToOrderPayload } from "@/components/StrategistV2Card";
import { StrategyBuilder, type StrategyLeg } from "@/components/StrategyBuilder";
import type { OptionsContract } from "@/components/OptionsTab";
import { MarketSessionClock } from "@/components/MarketSessionClock";
import { NewsTab } from "@/components/NewsTab";
import { MarketNewsChatPanel } from "@/components/MarketNewsChatPanel";
import { AiBiasStrip } from "@/components/market-pulse/AiBiasStrip";
import { BottomNav } from "@/components/BottomNav";
import { PortfolioView } from "@/components/PortfolioView";
import { CompanySwipablePages } from "@/components/CompanySwipablePages";
import { AiSubTabs, type AiSubTab } from "@/components/ai-tab/AiSubTabs";
import type { MarketPulseDashboardHandle } from "@/components/market-pulse/MarketPulseDashboard";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { WatchlistView } from "@/components/WatchlistView";
import { setPendingStrategistPushJobId } from "@/lib/strategistPushNav";
import { resumeAllRunningPollers } from "@/lib/strategistPoller";
import {
  Menu,
  RefreshCw,
  Clock,
} from "lucide-react";
import { useIsTablet, useIsDesktop } from "@/hooks/useMediaQuery";

type BottomTab = "scanner" | "markets" | "ai" | "search" | "portfolio" | "watchlist";
type ContextTab = MarketDataTab;

function optionTradeStreamKey(contract: OptionsContract): string {
  const stream = contract.streamKey;
  if (typeof stream === "string" && stream.length > 0) return stream;
  const schwab = contract.schwabSymbol;
  return typeof schwab === "string" ? schwab : "";
}

const DESKTOP_CONTEXT_TABS: { id: MarketDataTab; label: string }[] = [
  { id: "news", label: "News" },
  { id: "options", label: "Options" },
  { id: "company", label: "Company" },
  { id: "newsChat", label: "News chat" },
];

function DesktopContextTabs({ activeTab, setActiveTab }: { activeTab: MarketDataTab; setActiveTab: (t: MarketDataTab) => void }) {
  return (
    <div className="flex items-stretch border-b border-zinc-800/60 overflow-x-auto" style={{ background: "#111" }}>
      {DESKTOP_CONTEXT_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 min-w-[76px] py-2 font-mono text-[10px] sm:text-[11px] font-bold tracking-wider transition-colors border-b-2"
            style={{
              color: isActive ? "#FFB800" : "#71717a",
              borderColor: isActive ? "#FFB800" : "transparent",
              background: isActive ? "rgba(255,184,0,0.04)" : "transparent",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function PulseHeader({ pulseData, onRefresh }: { pulseData: any; onRefresh: () => void }) {
  const pulseAge = pulseData?.generatedAt ? Math.floor((Date.now() - pulseData.generatedAt) / 60_000) : null;
  const ageLabel = pulseAge === null ? null : pulseAge < 1 ? "Just now" : pulseAge < 60 ? `${pulseAge}m ago` : `${Math.floor(pulseAge / 60)}h ${pulseAge % 60}m ago`;

  return (
    <div className="flex items-center justify-between px-3 sm:px-4 lg:px-5 py-2 border-b border-card-border/30">
      <div className="flex items-center gap-2.5">
      </div>
      {pulseData && (
        <div className="flex items-center gap-3 mr-3">
          {ageLabel && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-[#8a8a8e]" />
              <span className="font-mono text-[11px] text-[#8a8a8e] tracking-wider">{ageLabel}</span>
            </div>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-[1px]"
            style={{
              background: "linear-gradient(180deg, #2A2A2C 0%, #1E1E20 100%)",
              color: "#a1a1aa",
              border: "1px solid #3a3a3c",
              borderBottom: "2px solid #1a1a1c",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function TerminalPage() {
  const { symbol, accessToken, chartPeriod, chartInterval, streamStatus } = useTerminalStore();
  const strategistJobsForBadge = useTerminalStore((s) => s.strategistJobs);
  const strategistRunningCount = Object.values(strategistJobsForBadge).filter(j => j.status === 'running').length;
  const strategistUnviewedCount = Object.values(strategistJobsForBadge).filter(j => (j.status === 'done' || j.status === 'error') && !j.viewed).length;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolledRaw, setIsScrolledRaw] = useState(false);
  const headerMode = useUICustomizationStore((s) => s.headerMode);
  const showTickerTape = useUICustomizationStore((s) => s.showTickerTape);
  const showAiBiasStrip = useUICustomizationStore((s) => s.showAiBiasStrip);
  const showMiniCards = useUICustomizationStore((s) => s.showMiniCards);
  const isCompact = headerMode === "collapsed";
  const isScrolled = isCompact ? true : headerMode === "expanded" ? false : isScrolledRaw;
  const [activeBottom, setActiveBottom] = useState<BottomTab>(() => {
    try {
      const saved = sessionStorage.getItem("alpha_session_tab") as BottomTab | null;
      const valid: BottomTab[] = ["portfolio", "markets", "ai", "search", "watchlist"];
      return saved && valid.includes(saved) ? saved : "markets";
    } catch { return "markets"; }
  });
  const [contextTab, setContextTab] = useState<ContextTab>("news");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>(() => {
    try {
      const saved = sessionStorage.getItem("alpha_session_ai_tab") as AiSubTab | null;
      const valid: AiSubTab[] = ["pulse", "strategist", "scanner"];
      return saved && valid.includes(saved) ? saved : "pulse";
    } catch { return "pulse"; }
  });
  const [strategistDeepLinkJobId, setStrategistDeepLinkJobId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderOptionSymbol, setOrderOptionSymbol] = useState<string | undefined>();
  const [orderOptionInstruction, setOrderOptionInstruction] = useState<string | undefined>();
  const [orderStrategyLegs, setOrderStrategyLegs] = useState<OrderLeg[] | undefined>();
  const [orderStrategyNetPrice, setOrderStrategyNetPrice] = useState<number | undefined>();
  const [orderStrategyIsCredit, setOrderStrategyIsCredit] = useState(false);
  const [orderIsClose, setOrderIsClose] = useState(false);
  const savedOptionsCtxRef = useRef<{
    legs?: OrderLeg[];
    netPrice?: number;
    isCredit?: boolean;
    optionSymbol?: string;
    optionInstruction?: string;
  } | null>(null);

  const [strategyOpen, setStrategyOpen] = useState(false);
  const [strategyStrikes, setStrategyStrikes] = useState<number[]>([]);
  const [strategyExpirations, setStrategyExpirations] = useState<{ label: string; value: string }[]>([]);
  const [strategyChainData, setStrategyChainData] = useState<Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>>(new Map());

  const openOrder = useCallback((side: "BUY" | "SELL") => {
    setOrderOptionSymbol(undefined);
    setOrderOptionInstruction(undefined);
    setOrderStrategyLegs(undefined);
    setOrderStrategyNetPrice(undefined);
    setOrderSide(side);
    setOrderOpen(true);
  }, []);

  // Reopen the OrderTicket from a strategist validation card. We map the
  // ValidationMeta ticket back into the OrderTicket inputs so the user lands
  // on the same trade they sent for review.
  const reopenValidatedOrder = useCallback((meta: StrategistValidationMeta) => {
    const t = meta.ticket;
    useTerminalStore.getState().setSymbol(t.ticker);
    setOrderSide(t.side ?? "BUY");
    setOrderIsClose(meta.mode === "closing");
    if (t.isMultiLeg && t.legs && t.legs.length >= 2) {
      const legs: OrderLeg[] = t.legs.map(l => ({
        schwabSymbol: "",
        instruction: l.instruction,
        quantity: l.quantity ?? 1,
        optionType: l.optionType ?? "",
        strike: l.strike ?? 0,
        expiration: l.expiration ?? "",
        bid: l.bid ?? undefined,
        ask: l.ask ?? undefined,
        delta: l.delta ?? undefined,
      }));
      setOrderStrategyLegs(legs);
      setOrderStrategyNetPrice(t.netPrice ?? undefined);
      setOrderStrategyIsCredit(!!t.isCredit);
      setOrderOptionSymbol(undefined);
      setOrderOptionInstruction(undefined);
    } else if (t.isOption && t.optionSymbol) {
      // Single-leg option: use the symbol we echoed into validationMeta.
      setOrderStrategyLegs(undefined);
      setOrderStrategyNetPrice(undefined);
      setOrderStrategyIsCredit(false);
      setOrderOptionSymbol(t.optionSymbol);
      setOrderOptionInstruction(t.optionInstruction ?? (t.legs?.[0]?.instruction));
    } else {
      setOrderStrategyLegs(undefined);
      setOrderStrategyNetPrice(undefined);
      setOrderStrategyIsCredit(false);
      setOrderOptionSymbol(undefined);
      setOrderOptionInstruction(undefined);
    }
    setOrderOpen(true);
  }, []);

  const openOrderForSymbol = useCallback((
    sym: string,
    side: "BUY" | "SELL",
    optionSymbol?: string,
    optionInstruction?: string,
    strategyLegs?: OrderLeg[],
    strategyNetPrice?: number,
    strategyIsCredit?: boolean,
    isClose?: boolean,
  ) => {
    useTerminalStore.getState().setSymbol(sym);
    setOrderSide(side);
    setOrderOptionSymbol(optionSymbol);
    setOrderOptionInstruction(optionInstruction);
    setOrderStrategyLegs(strategyLegs);
    setOrderStrategyNetPrice(strategyNetPrice);
    setOrderStrategyIsCredit(strategyIsCredit ?? false);
    setOrderIsClose(isClose ?? false);
    setOrderOpen(true);
  }, []);

  const closeOrderTicket = useCallback(() => {
    setOrderOpen(false);
    setOrderStrategyLegs(undefined);
    setOrderStrategyNetPrice(undefined);
    setOrderStrategyIsCredit(false);
    setOrderOptionSymbol(undefined);
    setOrderOptionInstruction(undefined);
    setOrderIsClose(false);
  }, []);

  const handleSwitchToStock = useCallback(() => {
    savedOptionsCtxRef.current = {
      legs: orderStrategyLegs,
      netPrice: orderStrategyNetPrice,
      isCredit: orderStrategyIsCredit,
      optionSymbol: orderOptionSymbol,
      optionInstruction: orderOptionInstruction,
    };
    setOrderOptionSymbol(undefined);
    setOrderOptionInstruction(undefined);
    setOrderStrategyLegs(undefined);
    setOrderStrategyNetPrice(undefined);
    setOrderStrategyIsCredit(false);
    setOrderIsClose(false);
  }, [orderStrategyLegs, orderStrategyNetPrice, orderStrategyIsCredit, orderOptionSymbol, orderOptionInstruction]);

  const handleSwitchToOptions = useCallback(() => {
    const saved = savedOptionsCtxRef.current;
    if (saved) {
      if (saved.legs && saved.legs.length > 0) {
        setOrderStrategyLegs(saved.legs);
        setOrderStrategyNetPrice(saved.netPrice);
        setOrderStrategyIsCredit(saved.isCredit ?? false);
      } else if (saved.optionSymbol) {
        setOrderOptionSymbol(saved.optionSymbol);
        setOrderOptionInstruction(saved.optionInstruction);
      }
    }
  }, []);

  const handleOptionTradeSingle = useCallback((contract: OptionsContract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
    const schwabSym = optionTradeStreamKey(contract);
    const instruction = side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_OPEN";
    setOrderSide(side);
    setOrderOptionSymbol(schwabSym);
    setOrderOptionInstruction(instruction);
    setOrderStrategyLegs(undefined);
    setOrderStrategyNetPrice(undefined);
    setOrderOpen(true);
  }, []);

  const [strategyInitialLegs, setStrategyInitialLegs] = useState<StrategyLeg[]>([]);

  const handleOpenStrategyBuilder = useCallback((strikes: number[], expirations: { label: string; value: string }[], chainData: Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>, preSelectedLegs?: { contract: OptionsContract; type: "CALL" | "PUT"; side?: "bid" | "ask" }[]) => {
    setStrategyStrikes(strikes);
    setStrategyExpirations(expirations);
    setStrategyChainData(chainData);
    if (preSelectedLegs && preSelectedLegs.length > 0) {
      const mapped: StrategyLeg[] = preSelectedLegs.map((leg, i) => ({
        id: `pre-${Date.now()}-${i}`,
        optionType: leg.type === "CALL" ? "CALL" as const : "PUT" as const,
        direction: leg.side === "bid" ? "SELL_TO_OPEN" as const : "BUY_TO_OPEN" as const,
        strike: leg.contract.strike,
        expiration: leg.contract.expiration,
        quantity: 1,
        bid: leg.contract.bid,
        ask: leg.contract.ask,
        delta: leg.contract.delta,
        gamma: leg.contract.gamma,
        theta: leg.contract.theta,
        vega: leg.contract.vega,
        iv: leg.contract.iv,
        schwabSymbol: leg.contract.schwabSymbol || "",
      }));
      setStrategyInitialLegs(mapped);
    } else {
      setStrategyInitialLegs([]);
    }
    setStrategyOpen(true);
  }, []);

  const handleStrategyToOrderTicket = useCallback((_legs: unknown[], _netPrice: number, _isCredit: boolean) => {
    setStrategyOpen(false);
  }, []);

  const handleSendToOrder = useCallback((trade: {
    ticker: string;
    strategy: string;
    expiration: string;
    legs: Array<{ type: string; action: string; strike: number; bid: number; ask: number; delta: number; schwabSymbol?: string }>;
    pricing: { type: string; executable_amount: number };
    sizing: { recommended_contracts: number };
  }) => {
    useTerminalStore.getState().setSymbol(trade.ticker);

    const mapped: StrategyLeg[] = trade.legs.map((leg, i) => ({
      id: `resolved-${Date.now()}-${i}`,
      optionType: leg.type === "call" ? "CALL" as const : "PUT" as const,
      direction: leg.action === "buy" ? "BUY_TO_OPEN" as const : "SELL_TO_OPEN" as const,
      strike: leg.strike,
      expiration: trade.expiration,
      quantity: trade.sizing.recommended_contracts,
      bid: leg.bid,
      ask: leg.ask,
      delta: leg.delta,
      schwabSymbol: leg.schwabSymbol || "",
    }));

    const strikes = mapped.map(l => l.strike);
    const exp = trade.expiration;
    const chainMap = new Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>();
    for (const leg of trade.legs) {
      const key = `${leg.strike}_${exp}_${leg.type === "call" ? "CALL" : "PUT"}`;
      chainMap.set(key, { bid: leg.bid, ask: leg.ask, delta: leg.delta });
    }

    setStrategyStrikes(strikes);
    setStrategyExpirations([{ label: exp, value: exp }]);
    setStrategyChainData(chainMap);
    setStrategyInitialLegs(mapped);
    setStrategyOpen(true);
  }, []);

  const handleStrategistSendToOrder = useCallback((payload: StrategistSendToOrderPayload) => {
    useTerminalStore.getState().setSymbol(payload.ticker);
    const orderLegs: OrderLeg[] = payload.legs.map(leg => ({
      schwabSymbol: leg.schwabSymbol,
      instruction: leg.instruction,
      quantity: leg.quantity,
      optionType: leg.optionType,
      strike: leg.strike,
      expiration: leg.expiration,
      bid: leg.bid,
      ask: leg.ask,
      delta: leg.delta,
    }));
    setOrderSide("BUY");
    setOrderOptionSymbol(undefined);
    setOrderOptionInstruction(undefined);
    setOrderStrategyLegs(orderLegs);
    setOrderStrategyNetPrice(payload.netPrice);
    setOrderStrategyIsCredit(payload.isCredit);
    setOrderIsClose(false);
    setOrderOpen(true);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyWrapRef = useRef<HTMLDivElement>(null);
  const [stickyH, setStickyH] = useState(0);
  const pulseDashRef = useRef<MarketPulseDashboardHandle>(null);
  const sidebarRef = useRef<SidebarHandle>(null);
  const { pulseData, isLoading: pulseLoading, isStreaming: pulseStreaming } = useMarketPulseStore();
  const { refresh } = useAutoRefreshToken();
  useViewportShell();
  useUIThemeSync();
  const isWide = useIsTablet();
  const isThreePanel = useIsDesktop();

  // Load watchlists from server on mount so they're shared across devices.
  useEffect(() => { void loadWatchlistsFromServer(); }, []);

  useEffect(() => {
    if (isWide && activeBottom === "watchlist") {
      setActiveBottom("markets");
    }
  }, [isWide, activeBottom]);

  useEffect(() => {
    try { sessionStorage.setItem("alpha_session_tab", activeBottom); } catch {}
  }, [activeBottom]);

  useEffect(() => {
    try { sessionStorage.setItem("alpha_session_ai_tab", aiSubTab); } catch {}
  }, [aiSubTab]);

  // Polling lives in `strategistPoller` so it can survive AiIntelligenceTab
  // unmount, but mobile Safari can throttle timer chains while other chrome is
  // foregrounded and `visibilitychange` does not fire for in-app bottom-nav
  // switches. When the user returns to the Strategist screen, reconcile against
  // `/job/:id/final` and force-restart any stalled pollers (toast suppressed —
  // foreground recovery still uses visibility/focus in App).
  useEffect(() => {
    if (activeBottom !== "ai" || aiSubTab !== "strategist") return;
    resumeAllRunningPollers({ toastOnComplete: false });
  }, [activeBottom, aiSubTab]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sb = params.get("sb");
    const jid = params.get("strategistJob");
    if (sb === "strategist" && jid && jid.trim().length > 0) {
      const id = jid.trim();
      setStrategistDeepLinkJobId(id);
      setPendingStrategistPushJobId(id);
      setActiveBottom("ai");
      setAiSubTab("strategist");
      const u = new URL(window.location.href);
      u.searchParams.delete("sb");
      u.searchParams.delete("strategistJob");
      const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : "") + u.hash;
      window.history.replaceState({}, "", next);
    }
  }, []);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.type !== "STRATEGIST_PUSH_NAV") return;
      const jobId = typeof d.jobId === "string" ? d.jobId.trim() : "";
      if (!jobId) return;
      setStrategistDeepLinkJobId(jobId);
      setPendingStrategistPushJobId(jobId);
      setActiveBottom("ai");
      setAiSubTab("strategist");
    };
    const sw = navigator.serviceWorker;
    sw?.addEventListener?.("message", onMsg);
    return () => sw?.removeEventListener?.("message", onMsg);
  }, []);

  useEffect(() => {
    if (isThreePanel && contextTab === "chart") {
      setContextTab("news");
    }
  }, [isThreePanel, contextTab]);

  const COLLAPSE_PX = 80;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsScrolledRaw(el.scrollTop > COLLAPSE_PX);
  }, []);

  useEffect(() => {
    const el = stickyWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setStickyH(entry.contentRect.height);
    });
    ro.observe(el);
    setStickyH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [activeBottom]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [aiSubTab]);

  const { subscribeOptionSymbols, subscribeEquitySymbols } = useMarketStream();

  const chartParams = chartParamsFromStore(chartPeriod, chartInterval);
  const { data: historyData, isLoading: historyLoading } = useGetPriceHistory<PriceHistoryResponse>(
    {
      symbol,
      accessToken: "",
      periodType: chartParams.periodType,
      period: chartParams.period,
      frequencyType: chartParams.frequencyType,
      frequency: chartParams.frequency,
    },
    { query: { enabled: !!accessToken && !!symbol } }
  );

  useEffect(() => {
    if (historyData?.error === "unauthorized") {
      refresh();
    }
  }, [historyData?.error, refresh]);

  useEffect(() => {
    setHistoryTimedOut(false);
    if (!accessToken) return;
    const timer = setTimeout(() => setHistoryTimedOut(true), 5_000);
    return () => clearTimeout(timer);
  }, [symbol, accessToken]);

  return (
    <div className="app-shell bg-background h-[100dvh] flex flex-col overflow-hidden selection:bg-primary/30 selection:text-white">

      <header id="terminal-header" className="shrink-0 bg-card z-[105] border-b border-card-border safe-top">
        <div className="flex items-center h-12 px-4 bg-card">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors mr-2"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col leading-none mr-auto">
            <span className="font-sans font-black text-base tracking-wider text-foreground">ALPHA</span>
            <span className="font-sans font-semibold text-[10px] tracking-[0.25em] text-primary">TERMINAL</span>
          </div>
          <MarketSessionClock />
          <div
            className="ml-3 w-2.5 h-2.5 rounded-full shrink-0"
            title={streamStatus === "live" ? "Live data" : streamStatus === "connecting" ? "Connecting..." : "Offline"}
            style={{
              background: streamStatus === "live" ? "#00d166" : streamStatus === "connecting" ? "#FFB800" : "#f23645",
              boxShadow: streamStatus === "live" ? "0 0 6px #00d166" : undefined,
            }}
          />
        </div>
        {showTickerTape && !isCompact && <TickerTape />}
        {showAiBiasStrip && !isCompact && <AiBiasStrip onNavigateToPulse={() => { setActiveBottom("ai"); setAiSubTab("pulse"); }} />}
      </header>

      {activeBottom === "ai" && (
        <div className="shrink-0 bg-background z-40">
          <div className="px-3 sm:px-4 lg:px-5 pt-1 pb-1">
            <div className="flex w-full p-1">
              {(["pulse", "scanner", "strategist"] as AiSubTab[]).map((tab) => {
                const label = tab === "pulse" ? "MARKET PULSE" : tab === "scanner" ? "SCANNER" : "STRATEGIST";
                const showIndicator = tab === "strategist" && aiSubTab !== "strategist" && (strategistRunningCount > 0 || strategistUnviewedCount > 0);
                const indicatorIsRunning = strategistRunningCount > 0;
                return (
                  <button
                    key={tab}
                    onClick={() => setAiSubTab(tab)}
                    className="flex-1 font-mono text-xs font-bold tracking-wider py-2 rounded-lg transition-all duration-200 relative"
                    style={{
                      background: aiSubTab === tab ? "#1a1a1a" : "transparent",
                      color: aiSubTab === tab ? "#fafafa" : "#71717a",
                      border: "none",
                    }}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      {label}
                      {showIndicator && (
                        <span
                          aria-label={indicatorIsRunning ? "Strategist running" : "New strategist result"}
                          className={indicatorIsRunning ? "animate-pulse" : ""}
                          style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            borderRadius: 9999,
                            background: indicatorIsRunning ? "#FFB800" : "#00d166",
                            boxShadow: indicatorIsRunning ? "0 0 6px #FFB800" : "0 0 6px #00d166",
                          }}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">

        <Sidebar
          ref={sidebarRef}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenChat={() => {}}
          onNavigate={(dest) => {
            if (dest === "markets") setActiveBottom("markets");
            else if (dest === "portfolio") setActiveBottom("portfolio");
            else if (dest === "ai-pulse") { setActiveBottom("ai"); setAiSubTab("pulse"); }
            else if (dest === "ai-strategist") { setActiveBottom("ai"); setAiSubTab("strategist"); }
          }}
        />

        {isWide && (
          <aside className="hidden md:flex flex-col border-r border-card-border shrink-0 overflow-y-auto" style={{ width: 280, background: "#000000" }}>
            <WatchlistView onNavigateToSymbol={() => setActiveBottom("markets")} />
          </aside>
        )}

        {!isWide ? (
          <main
            ref={scrollRef}
            onScroll={handleScroll}
            className={`app-content flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden ${
              activeBottom === "markets" && contextTab === "newsChat"
                ? "overflow-hidden"
                : activeBottom === "ai" && aiSubTab === "pulse" && !pulseData && !pulseLoading && !pulseStreaming
                  ? "overflow-hidden"
                  : "overflow-y-auto"
            }`}
          >

            {activeBottom === "markets" && (
              <div className="flex flex-1 min-h-0 flex-col">
                {showMiniCards && !isCompact && <MacroBar />}
                <div ref={stickyWrapRef} className="sticky top-0 z-40 bg-background shrink-0">
                  <MetricsBar compact={isScrolled} onTrade={openOrder} />
                  <VolumeBar />
                  <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} />
                </div>
                <div
                  className={
                    contextTab === "newsChat"
                      ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                      : "flex min-h-0 flex-1 flex-col"
                  }
                >
                  {contextTab === "news" && <NewsTab />}
                  {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} stickyOffset={stickyH} onTradeSingle={handleOptionTradeSingle} onOpenStrategyBuilder={handleOpenStrategyBuilder} />}
                  {contextTab === "company" && <CompanySwipablePages candles={historyData?.candles} stickyOffset={stickyH} />}
                  {contextTab === "newsChat" && <MarketNewsChatPanel />}
                  {contextTab === "chart" && (
                    <>
                      <ChartControls />
                      <div className="h-[420px] sm:h-[500px] md:h-[580px]">
                        <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={historyLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeBottom === "ai" && (
              <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToMarkets={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); }} onSendToOrder={handleSendToOrder} onStrategistSendToOrder={handleStrategistSendToOrder} onReopenValidatedOrder={reopenValidatedOrder} strategistDeepLinkJobId={strategistDeepLinkJobId} onStrategistDeepLinkHandled={() => setStrategistDeepLinkJobId(null)} />
            )}

            {activeBottom === "portfolio" && (
              <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} onRoll={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} />
            )}

            {activeBottom === "watchlist" && (
              <div className="flex flex-col" style={{ minHeight: "calc(100vh - 60px)", background: "#000000" }}>
                <WatchlistView onNavigateToSymbol={() => setActiveBottom("markets")} />
              </div>
            )}
          </main>
        ) : isThreePanel ? (
          <>
            {activeBottom === "markets" ? (
              <>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="shrink-0 border-b border-zinc-800/60" style={{ background: "#0a0a0a" }}>
                    <MetricsBar compact={isScrolled} onTrade={openOrder} />
                  </div>
                  <div className="shrink-0 border-b border-zinc-800/40" style={{ background: "#111" }}>
                    <ChartControls />
                  </div>
                  <div className="flex-1 min-h-0 relative" style={{ background: "#0c0c0c" }}>
                    <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={historyLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} />
                  </div>
                </div>

                <div className="flex min-h-0 w-[360px] shrink-0 flex-col overflow-hidden border-l border-zinc-800/60" style={{ background: "#0c0c0c" }}>
                  <div className="shrink-0">
                    <DesktopContextTabs activeTab={contextTab} setActiveTab={setContextTab} />
                  </div>
                  <div
                    className={
                      contextTab === "newsChat"
                        ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                        : "flex min-h-0 flex-1 flex-col overflow-y-auto"
                    }
                  >
                    {contextTab === "news" && <NewsTab />}
                    {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} stickyOffset={0} onTradeSingle={handleOptionTradeSingle} onOpenStrategyBuilder={handleOpenStrategyBuilder} />}
                    {contextTab === "company" && <CompanySwipablePages candles={historyData?.candles} stickyOffset={0} />}
                    {contextTab === "newsChat" && <MarketNewsChatPanel />}
                  </div>
                </div>
              </>
            ) : (
              <main ref={scrollRef} onScroll={handleScroll} className="flex-1 min-w-0 app-content pb-4 overflow-y-auto" style={activeBottom === "portfolio" ? { overscrollBehaviorY: "none" } : undefined}>
                {activeBottom === "ai" && (
                  <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToMarkets={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); }} onSendToOrder={handleSendToOrder} onStrategistSendToOrder={handleStrategistSendToOrder} onReopenValidatedOrder={reopenValidatedOrder} strategistDeepLinkJobId={strategistDeepLinkJobId} onStrategistDeepLinkHandled={() => setStrategistDeepLinkJobId(null)} />
                )}
                {activeBottom === "portfolio" && (
                  <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} onRoll={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} />
                )}
              </main>
            )}
          </>
        ) : (
          <main
            ref={scrollRef}
            onScroll={handleScroll}
            className={`app-content flex min-h-0 flex-1 min-w-0 flex-col pb-4 ${
              activeBottom === "markets" && contextTab === "newsChat" ? "overflow-hidden" : "overflow-y-auto"
            }`}
            style={activeBottom === "portfolio" ? { overscrollBehaviorY: "none" } : undefined}
          >
            {activeBottom === "markets" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-zinc-800/60" style={{ background: "#0a0a0a" }}>
                  <MetricsBar compact={isScrolled} onTrade={openOrder} />
                  <VolumeBar />
                </div>
                <div ref={stickyWrapRef} className="sticky top-0 z-40 shrink-0 bg-background">
                  <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} />
                </div>
                <div
                  className={
                    contextTab === "newsChat"
                      ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                      : "flex min-h-0 flex-1 flex-col"
                  }
                >
                  {contextTab === "news" && <NewsTab />}
                  {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} stickyOffset={stickyH} onTradeSingle={handleOptionTradeSingle} onOpenStrategyBuilder={handleOpenStrategyBuilder} />}
                  {contextTab === "company" && <CompanySwipablePages candles={historyData?.candles} stickyOffset={stickyH} />}
                  {contextTab === "newsChat" && <MarketNewsChatPanel />}
                  {contextTab === "chart" && (
                    <>
                      <ChartControls />
                      <div className="h-[580px]">
                        <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={historyLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeBottom === "ai" && (
              <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToMarkets={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); }} onSendToOrder={handleSendToOrder} onStrategistSendToOrder={handleStrategistSendToOrder} onReopenValidatedOrder={reopenValidatedOrder} strategistDeepLinkJobId={strategistDeepLinkJobId} onStrategistDeepLinkHandled={() => setStrategistDeepLinkJobId(null)} />
            )}

            {activeBottom === "portfolio" && (
              <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} onRoll={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} />
            )}
          </main>
        )}
      </div>

      {!isWide && (
        <BottomNav
          activeTab={activeBottom}
          strategistRunningCount={strategistRunningCount}
          strategistUnviewedCount={strategistUnviewedCount}
          onTabChange={(tab) => {
          sidebarRef.current?.clearActivePage();
          setSidebarOpen(false);
          if (tab === "search") {
            setSearchOpen(true);
          } else {
            if (tab === "ai") setAiSubTab("pulse");
            setActiveBottom(tab);
          }
        }} />
      )}

      {isWide && (
        <nav className="hidden md:flex shrink-0 h-9 bg-[#080808] border-t border-zinc-800/40 items-center justify-center gap-0 px-2 z-50">
          {(["portfolio", "markets", "ai", "search"] as BottomTab[]).map((tab) => {
            const labels: Record<string, string> = { portfolio: "Portfolio", markets: "Markets", ai: "AI", search: "Search" };
            const isActive = activeBottom === tab || (tab === "search" && searchOpen);
            return (
              <button
                key={tab}
                onClick={() => {
                  sidebarRef.current?.clearActivePage();
                  setSidebarOpen(false);
                  if (tab === "search") { setSearchOpen(true); } else { if (tab === "ai") setAiSubTab("pulse"); setActiveBottom(tab); }
                }}
                className="font-mono text-[10px] font-semibold tracking-wider px-3 py-1.5 rounded transition-colors"
                style={{
                  color: isActive ? "#FFB800" : "#52525b",
                  background: isActive ? "rgba(255,184,0,0.06)" : "transparent",
                }}
              >
                {labels[tab]}
              </button>
            );
          })}
        </nav>
      )}

      <SearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectSymbol={() => { setSearchOpen(false); setActiveBottom("markets"); }}
      />
      <InAppBrowser />
      <StrategyBuilder
        isOpen={strategyOpen}
        onClose={() => setStrategyOpen(false)}
        onBack={() => setStrategyOpen(false)}
        onSwitchToStock={() => { setStrategyOpen(false); openOrder("BUY"); }}
        availableStrikes={strategyStrikes}
        availableExpirations={strategyExpirations}
        chainData={strategyChainData}
        initialLegs={strategyInitialLegs}
      />
      <OrderTicket
        isOpen={orderOpen}
        onClose={closeOrderTicket}
        initialSide={orderSide}
        optionSymbol={orderOptionSymbol}
        optionInstruction={orderOptionInstruction}
        strategyLegs={orderStrategyLegs}
        strategyNetPrice={orderStrategyNetPrice}
        strategyIsCredit={orderStrategyIsCredit}
        isCloseOrder={orderIsClose}
        onSwitchToStock={handleSwitchToStock}
        onSwitchToOptions={handleSwitchToOptions}
        onSendToStrategist={(ticker) => {
          // Strategist tab pulls results for the active symbol — switch to
          // the validated ticket's ticker so the live debate + verdict card
          // surface immediately.
          if (ticker) useTerminalStore.getState().setSymbol(ticker);
          setActiveBottom("ai");
          setAiSubTab("strategist");
          closeOrderTicket();
        }}
      />
    </div>
  );
}


