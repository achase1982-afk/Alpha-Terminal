import { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
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
import { useGetPriceHistory } from "@workspace/api-client-react";
import { ChartControls, chartParamsFromStore, isIntradayInterval } from "@/components/ChartControls";
import { useAutoRefreshToken } from "@/hooks/useAutoRefreshToken";
import { useMarketStream } from "@/hooks/useMarketStream";
import { useViewportShell } from "@/hooks/useViewportShell";
import { AiChatOverlay } from "@/components/AiChatOverlay";

import { InAppBrowser } from "@/components/InAppBrowser";
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

type BottomTab = "scanner" | "markets" | "ai" | "search" | "portfolio" | "watchlist";
type ContextTab = MarketDataTab;

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
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeBottom, setActiveBottom] = useState<BottomTab>("markets");
  const [contextTab, setContextTab] = useState<ContextTab>("news");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>("pulse");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyWrapRef = useRef<HTMLDivElement>(null);
  const [stickyH, setStickyH] = useState(0);
  const pulseDashRef = useRef<MarketPulseDashboardHandle>(null);
  const { pulseData, isLoading: pulseLoading, isStreaming: pulseStreaming } = useMarketPulseStore();
  const { refresh } = useAutoRefreshToken();
  useViewportShell();

  const COLLAPSE_PX = 80;
  const headerTouch = useRef(false);
  const headerScrollAnchor = useRef(0);
  const contentWrapRef = useRef<HTMLDivElement>(null);

  const handleMainTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch || !stickyWrapRef.current || !scrollRef.current) return;
    const headerRect = stickyWrapRef.current.getBoundingClientRect();
    const mainRect = scrollRef.current.getBoundingClientRect();
    const touchY = touch.clientY - mainRect.top;
    const headerBottom = headerRect.bottom - mainRect.top;
    if (touchY <= headerBottom) {
      headerTouch.current = true;
      headerScrollAnchor.current = scrollRef.current.scrollTop;
    } else {
      headerTouch.current = false;
    }
  }, []);

  const handleMainTouchEnd = useCallback(() => {
    if (headerTouch.current && contentWrapRef.current) {
      contentWrapRef.current.style.transition = "transform 300ms ease-out";
      contentWrapRef.current.style.transform = "";
      setTimeout(() => {
        if (contentWrapRef.current) {
          contentWrapRef.current.style.transition = "";
          contentWrapRef.current.style.willChange = "";
        }
      }, 300);
    }
    headerTouch.current = false;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    setIsScrolled(y > COLLAPSE_PX);

    if (headerTouch.current && contentWrapRef.current) {
      const diff = y - headerScrollAnchor.current;
      contentWrapRef.current.style.willChange = "transform";
      contentWrapRef.current.style.transform = `translateY(${diff}px)`;
    }
  }, []);

  const prevStickyH = useRef(0);

  useEffect(() => {
    const el = stickyWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const newH = entry.contentRect.height;
      const delta = prevStickyH.current - newH;
      prevStickyH.current = newH;
      setStickyH(newH);

      if (scrollRef.current && delta !== 0 && scrollRef.current.scrollTop > 0) {
        scrollRef.current.scrollTop = Math.max(0, scrollRef.current.scrollTop - delta);
      }
    });
    ro.observe(el);
    const h = el.getBoundingClientRect().height;
    prevStickyH.current = h;
    setStickyH(h);
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

      <header id="terminal-header" className="shrink-0 bg-background z-50 border-b border-card-border">
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
        <TickerTape />
        <AiBiasStrip onNavigateToPulse={() => { setActiveBottom("ai"); setAiSubTab("pulse"); }} />
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
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenChat={() => setChatOpen(true)}
          onNavigate={(dest) => { if (dest === "markets") setActiveBottom("markets"); else if (dest === "portfolio") setActiveBottom("portfolio"); }}
        />

        <main ref={scrollRef} onScroll={handleScroll} onTouchStart={handleMainTouchStart} onTouchEnd={handleMainTouchEnd} onTouchCancel={handleMainTouchEnd} className={`flex-1 app-content pb-24 ${activeBottom === "ai" && aiSubTab === "pulse" && !pulseData && !pulseLoading && !pulseStreaming ? "overflow-hidden" : "overflow-y-auto"}`}>

          {activeBottom === "markets" && (
            <>
              <MacroBar />

              <div ref={stickyWrapRef} className="sticky top-0 z-40 bg-background">
                <MetricsBar compact={isScrolled} />
                <VolumeBar />
                <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} />
              </div>

              <div ref={contentWrapRef} style={{ minHeight: "calc(100vh - 60px)" }}>
                {contextTab === "news" && <NewsTab />}
                {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} stickyOffset={stickyH} />}
                {contextTab === "company" && <CompanySwipablePages candles={historyData?.candles as any} stickyOffset={stickyH} />}
                {contextTab === "chart" && (
                  <>
                    <ChartControls />
                    <div className="h-[420px] sm:h-[500px] md:h-[580px]">
                      <TradingChart
                        symbol={symbol}
                        data={historyData?.candles || []}
                        isLoading={historyLoading}
                        error={historyData?.error}
                        timedOut={historyTimedOut}
                        tokenExpired={historyData?.error === "unauthorized"}
                        intraday={isIntradayInterval(chartInterval)}
                      />
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
            <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} />
          )}

          {activeBottom === "portfolio" && (
            <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} />
          )}

          {activeBottom === "watchlist" && (
            <div className="flex flex-col" style={{ minHeight: "calc(100vh - 60px)", background: "#000000" }}>
              <WatchlistView onNavigateToSymbol={() => setActiveBottom("markets")} />
            </div>
          )}

        </main>
      </div>

      <BottomNav activeTab={activeBottom} onTabChange={(tab) => {
        if (tab === "search") {
          setSearchOpen(true);
        } else {
          setActiveBottom(tab);
        }
      }} />

      <SearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectSymbol={() => { setSearchOpen(false); setActiveBottom("markets"); }}
      />
      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <InAppBrowser />
    </div>
  );
}


