import { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar, type SidebarHandle } from "@/components/Sidebar";
import { MetricsBar, VolumeBar } from "@/components/MetricsBar";
import { TradingChart } from "@/components/TradingChart";
import { OptionsTab } from "@/components/OptionsTab";
import { AiIntelligenceTab } from "@/components/AiIntelligenceTab";
import { MarketScanner } from "@/components/MarketScanner";
import { MacroBar } from "@/components/MacroBar";
import { TickerTape } from "@/components/TickerTape";
import { SearchOverlay } from "@/components/SearchOverlay";
import { MarketDataTabs, type MarketDataTab } from "@/components/MarketDataTabs";
import { useTerminalStore } from "@/lib/store";
import { useUICustomizationStore } from "@/lib/ui-customization-store";
import { useUIThemeSync } from "@/hooks/useUIThemeSync";
import { useGetPriceHistory } from "@workspace/api-client-react";
import { ChartControls, chartParamsFromStore, isIntradayInterval } from "@/components/ChartControls";
import { useAutoRefreshToken } from "@/hooks/useAutoRefreshToken";
import { useMarketStream } from "@/hooks/useMarketStream";
import { useViewportShell } from "@/hooks/useViewportShell";
import { AiChatOverlay } from "@/components/AiChatOverlay";

import { InAppBrowser } from "@/components/InAppBrowser";
import { OrderTicket, type OrderLeg } from "@/components/OrderTicket";
import { StrategyBuilder, type StrategyLeg } from "@/components/StrategyBuilder";
import type { OptionsContract } from "@/components/OptionsTab";
import { MarketSessionClock } from "@/components/MarketSessionClock";
import { NewsTab } from "@/components/NewsTab";
import { AiBiasStrip } from "@/components/market-pulse/AiBiasStrip";
import { BottomNav } from "@/components/BottomNav";
import { PortfolioView } from "@/components/PortfolioView";
import { CompanySwipablePages } from "@/components/CompanySwipablePages";
import { AiSubTabs, type AiSubTab } from "@/components/ai-tab/AiSubTabs";
import type { MarketPulseDashboardHandle } from "@/components/market-pulse/MarketPulseDashboard";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { WatchlistView } from "@/components/WatchlistView";
import {
  Menu,
  RefreshCw,
  Clock,
} from "lucide-react";
import { useIsTablet, useIsDesktop } from "@/hooks/useMediaQuery";

type BottomTab = "scanner" | "markets" | "ai" | "search" | "portfolio" | "watchlist";
type ContextTab = MarketDataTab;

const DESKTOP_CONTEXT_TABS: { id: MarketDataTab; label: string }[] = [
  { id: "news", label: "News" },
  { id: "options", label: "Options" },
  { id: "company", label: "Company" },
];

function DesktopContextTabs({ activeTab, setActiveTab }: { activeTab: MarketDataTab; setActiveTab: (t: MarketDataTab) => void }) {
  return (
    <div className="flex items-stretch border-b border-zinc-800/60" style={{ background: "#111" }}>
      {DESKTOP_CONTEXT_TABS.map((tab) => {
        const isActive = activeTab === tab.id || (activeTab === "chart" && tab.id === "news");
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 py-2 font-mono text-[11px] font-bold tracking-wider transition-colors border-b-2"
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
        <div>
          <h2 className="font-mono font-bold text-sm text-[#e4e4e7] tracking-wider">MARKET PULSE</h2>
          <p className="font-mono text-[9px] text-[#71717a] tracking-widest">Multi-Asset Macro Analysis</p>
        </div>
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolledRaw, setIsScrolledRaw] = useState(false);
  const headerMode = useUICustomizationStore((s) => s.headerMode);
  const showTickerTape = useUICustomizationStore((s) => s.showTickerTape);
  const showAiBiasStrip = useUICustomizationStore((s) => s.showAiBiasStrip);
  const showMiniCards = useUICustomizationStore((s) => s.showMiniCards);
  const isCompact = headerMode === "collapsed";
  const isScrolled = isCompact ? true : headerMode === "expanded" ? false : isScrolledRaw;
  const [activeBottom, setActiveBottom] = useState<BottomTab>("markets");
  const [contextTab, setContextTab] = useState<ContextTab>("news");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>("pulse");
  const [pulseAutoGen, setPulseAutoGen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderOptionSymbol, setOrderOptionSymbol] = useState<string | undefined>();
  const [orderOptionInstruction, setOrderOptionInstruction] = useState<string | undefined>();
  const [orderStrategyLegs, setOrderStrategyLegs] = useState<OrderLeg[] | undefined>();
  const [orderStrategyNetPrice, setOrderStrategyNetPrice] = useState<number | undefined>();
  const [orderStrategyIsCredit, setOrderStrategyIsCredit] = useState(false);

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

  const openOrderForSymbol = useCallback((sym: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => {
    useTerminalStore.getState().setSymbol(sym);
    setOrderSide(side);
    setOrderOptionSymbol(optionSymbol);
    setOrderOptionInstruction(optionInstruction);
    setOrderStrategyLegs(undefined);
    setOrderStrategyNetPrice(undefined);
    setOrderOpen(true);
  }, []);

  const closeOrderTicket = useCallback(() => {
    setOrderOpen(false);
    setOrderStrategyLegs(undefined);
    setOrderStrategyNetPrice(undefined);
    setOrderStrategyIsCredit(false);
    setOrderOptionSymbol(undefined);
    setOrderOptionInstruction(undefined);
  }, []);

  const handleOptionTradeSingle = useCallback((contract: OptionsContract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
    const c = contract as Record<string, unknown>;
    const schwabSym = (typeof c.streamKey === "string" ? c.streamKey : typeof c.schwabSymbol === "string" ? c.schwabSymbol : "") as string;
    const instruction = side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_OPEN";
    setOrderSide(side);
    setOrderOptionSymbol(schwabSym);
    setOrderOptionInstruction(instruction);
    setOrderStrategyLegs(undefined);
    setOrderStrategyNetPrice(undefined);
    setOrderOpen(true);
  }, []);

  const [strategyInitialLegs, setStrategyInitialLegs] = useState<StrategyLeg[]>([]);

  const handleOpenStrategyBuilder = useCallback((strikes: number[], expirations: { label: string; value: string }[], chainData: Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>, preSelectedLegs?: { contract: OptionsContract; type: "CALL" | "PUT" }[]) => {
    setStrategyStrikes(strikes);
    setStrategyExpirations(expirations);
    setStrategyChainData(chainData);
    if (preSelectedLegs && preSelectedLegs.length > 0) {
      const mapped: StrategyLeg[] = preSelectedLegs.map((leg, i) => ({
        id: `pre-${Date.now()}-${i}`,
        optionType: leg.type === "CALL" ? "CALL" as const : "PUT" as const,
        direction: "BUY_TO_OPEN" as const,
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

  const handleStrategyToOrderTicket = useCallback((legs: StrategyLeg[], netPrice: number, isCredit: boolean) => {
    setStrategyOpen(false);
    const orderLegs: OrderLeg[] = legs.map(l => ({
      schwabSymbol: l.schwabSymbol,
      instruction: l.direction,
      quantity: l.quantity,
      optionType: l.optionType,
      strike: l.strike,
      expiration: l.expiration,
      bid: l.bid,
      ask: l.ask,
      delta: l.delta,
    }));
    setOrderStrategyLegs(orderLegs);
    setOrderStrategyNetPrice(netPrice);
    setOrderStrategyIsCredit(isCredit);
    setOrderOptionSymbol(undefined);
    setOrderOptionInstruction(undefined);
    setOrderSide("BUY");
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

  useEffect(() => {
    if (isWide && activeBottom === "watchlist") {
      setActiveBottom("markets");
    }
  }, [isWide, activeBottom]);

  useEffect(() => {
    if (isThreePanel && contextTab === "chart") {
      setContextTab("news");
    }
  }, [isThreePanel, contextTab]);

  const COLLAPSE_PX = 80;
  const lastTouchY = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY.current = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      const pulling = y > lastTouchY.current;
      if (el.scrollTop <= 0 && pulling) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

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

  const { subscribeOptionSymbols, subscribeEquitySymbols } = useMarketStream();

  const chartParams = chartParamsFromStore(chartPeriod, chartInterval);
  const { data: historyData, isLoading: historyLoading } = useGetPriceHistory(
    {
      symbol,
      accessToken: accessToken || "",
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

      <header id="terminal-header" className="shrink-0 bg-background z-[105] border-b border-card-border">
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
        {showAiBiasStrip && !isCompact && <AiBiasStrip onNavigateToPulse={() => { setActiveBottom("ai"); setAiSubTab("pulse"); setPulseAutoGen(true); }} />}
      </header>

      {activeBottom === "ai" && (
        <div className="shrink-0 bg-background z-40">
          <div className="px-3 sm:px-4 lg:px-5 pt-1 pb-1">
            <div
              className="flex w-full rounded-full p-1"
              style={{ background: "rgba(39,39,42,0.5)" }}
            >
              {(["pulse", "strategist"] as AiSubTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAiSubTab(tab)}
                  className="flex-1 font-mono text-xs font-bold tracking-wider py-2 rounded-full transition-all duration-200"
                  style={{
                    background: aiSubTab === tab ? "#3f3f46" : "transparent",
                    color: aiSubTab === tab ? "#fafafa" : "#71717a",
                  }}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {aiSubTab === "pulse" && (
            <PulseHeader pulseData={pulseData} onRefresh={() => pulseDashRef.current?.fetchPulse()} />
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">

        <Sidebar
          ref={sidebarRef}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenChat={() => setChatOpen(true)}
          onNavigate={(dest) => { if (dest === "markets") setActiveBottom("markets"); else if (dest === "portfolio") setActiveBottom("portfolio"); }}
        />

        {isWide && (
          <aside className="hidden md:flex flex-col border-r border-card-border shrink-0" style={{ width: 280, background: "#000000" }}>
            <WatchlistView onNavigateToSymbol={() => setActiveBottom("markets")} />
          </aside>
        )}

        {!isWide ? (
          <main ref={scrollRef} onScroll={handleScroll} className={`flex-1 app-content pb-24 ${activeBottom === "ai" && aiSubTab === "pulse" && !pulseData && !pulseLoading && !pulseStreaming ? "overflow-hidden" : "overflow-y-auto"}`}>

            {activeBottom === "markets" && (
              <>
                {showMiniCards && !isCompact && <MacroBar />}
                <div ref={stickyWrapRef} className="sticky top-0 z-40 bg-background">
                  <MetricsBar compact={isScrolled} onTrade={openOrder} />
                  <VolumeBar />
                  <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} />
                </div>
                <div style={{ minHeight: "calc(100vh - 60px)" }}>
                  {contextTab === "news" && <NewsTab />}
                  {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} stickyOffset={stickyH} onTradeSingle={handleOptionTradeSingle} onOpenStrategyBuilder={handleOpenStrategyBuilder} />}
                  {contextTab === "company" && <CompanySwipablePages candles={historyData?.candles as any} stickyOffset={stickyH} />}
                  {contextTab === "chart" && (
                    <>
                      <ChartControls />
                      <div className="h-[420px] sm:h-[500px] md:h-[580px]">
                        <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={historyLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} />
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            <div style={{ display: activeBottom === "scanner" ? "block" : "none" }}>
              <MarketScanner subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToSymbol={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); }} />
            </div>

            {activeBottom === "ai" && (
              <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} pulseAutoGen={pulseAutoGen} onPulseAutoGenConsumed={() => setPulseAutoGen(false)} />
            )}

            {activeBottom === "portfolio" && (
              <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} />
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

                <div className="flex flex-col shrink-0 border-l border-zinc-800/60 overflow-hidden" style={{ width: 360, background: "#0c0c0c" }}>
                  <div className="shrink-0">
                    <DesktopContextTabs activeTab={contextTab} setActiveTab={setContextTab} />
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {contextTab === "news" && <NewsTab />}
                    {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} stickyOffset={0} onTradeSingle={handleOptionTradeSingle} onOpenStrategyBuilder={handleOpenStrategyBuilder} />}
                    {contextTab === "company" && <CompanySwipablePages candles={historyData?.candles as any} stickyOffset={0} />}
                  </div>
                </div>
              </>
            ) : (
              <main ref={scrollRef} onScroll={handleScroll} className="flex-1 app-content pb-4 overflow-y-auto">
                <div style={{ display: activeBottom === "scanner" ? "block" : "none" }}>
                  <MarketScanner subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToSymbol={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); }} />
                </div>
                {activeBottom === "ai" && (
                  <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} pulseAutoGen={pulseAutoGen} onPulseAutoGenConsumed={() => setPulseAutoGen(false)} />
                )}
                {activeBottom === "portfolio" && (
                  <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} />
                )}
              </main>
            )}
          </>
        ) : (
          <main ref={scrollRef} onScroll={handleScroll} className="flex-1 app-content pb-4 overflow-y-auto">
            {activeBottom === "markets" && (
              <>
                <div className="shrink-0 border-b border-zinc-800/60" style={{ background: "#0a0a0a" }}>
                  <MetricsBar compact={isScrolled} onTrade={openOrder} />
                  <VolumeBar />
                </div>
                <div ref={stickyWrapRef} className="sticky top-0 z-40 bg-background">
                  <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} />
                </div>
                <div style={{ minHeight: "calc(100vh - 60px)" }}>
                  {contextTab === "news" && <NewsTab />}
                  {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} stickyOffset={stickyH} onTradeSingle={handleOptionTradeSingle} onOpenStrategyBuilder={handleOpenStrategyBuilder} />}
                  {contextTab === "company" && <CompanySwipablePages candles={historyData?.candles as any} stickyOffset={stickyH} />}
                  {contextTab === "chart" && (
                    <>
                      <ChartControls />
                      <div className="h-[580px]">
                        <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={historyLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} />
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            <div style={{ display: activeBottom === "scanner" ? "block" : "none" }}>
              <MarketScanner subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToSymbol={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); }} />
            </div>

            {activeBottom === "ai" && (
              <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} pulseAutoGen={pulseAutoGen} onPulseAutoGenConsumed={() => setPulseAutoGen(false)} />
            )}

            {activeBottom === "portfolio" && (
              <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} />
            )}
          </main>
        )}
      </div>

      {!isWide && (
        <BottomNav activeTab={activeBottom} onTabChange={(tab) => {
          sidebarRef.current?.clearActivePage();
          setSidebarOpen(false);
          if (tab === "search") {
            setSearchOpen(true);
          } else {
            setActiveBottom(tab);
          }
        }} />
      )}

      {isWide && (
        <nav className="hidden md:flex shrink-0 h-9 bg-[#080808] border-t border-zinc-800/40 items-center justify-center gap-0 px-2 z-50">
          {(["scanner", "markets", "portfolio", "ai", "search"] as BottomTab[]).map((tab) => {
            const labels: Record<string, string> = { scanner: "Scanner", markets: "Markets", portfolio: "Portfolio", ai: "AI", search: "Search" };
            const isActive = activeBottom === tab || (tab === "search" && searchOpen);
            return (
              <button
                key={tab}
                onClick={() => {
                  sidebarRef.current?.clearActivePage();
                  setSidebarOpen(false);
                  if (tab === "search") { setSearchOpen(true); } else { setActiveBottom(tab); }
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
      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <InAppBrowser />
      <StrategyBuilder
        isOpen={strategyOpen}
        onClose={() => setStrategyOpen(false)}
        onSendToOrderTicket={handleStrategyToOrderTicket}
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
      />
    </div>
  );
}


