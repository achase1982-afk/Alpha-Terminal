import { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MetricsBar } from "@/components/MetricsBar";
import { TradingChart } from "@/components/TradingChart";
import { OptionsTab } from "@/components/OptionsTab";
import { AiIntelligenceTab } from "@/components/AiIntelligenceTab";
import { MarketScanner } from "@/components/MarketScanner";
import { MacroBar } from "@/components/MacroBar";
import { TickerTape } from "@/components/TickerTape";
import { TickerSearch } from "@/components/TickerSearch";
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
import { CompanyResearchHub } from "@/components/CompanyResearchHub";
import { AiSubTabs, type AiSubTab } from "@/components/ai-tab/AiSubTabs";
import type { MarketPulseDashboardHandle } from "@/components/market-pulse/MarketPulseDashboard";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import {
  Menu,
  Zap,
  Newspaper,
  ListOrdered,
  Star,
  X,
} from "lucide-react";

type BottomTab = "scanner" | "markets" | "ai" | "portfolio" | "watchlist";
type ContextTab = MarketDataTab;

export default function TerminalPage() {
  const { symbol, accessToken, chartPeriod, chartInterval, streamStatus } = useTerminalStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeBottom, setActiveBottom] = useState<BottomTab>("markets");
  const [contextTab, setContextTab] = useState<ContextTab>("news");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>("pulse");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pulseDashRef = useRef<MarketPulseDashboardHandle>(null);
  const { pulseData, isLoading: pulseLoading, isStreaming: pulseStreaming } = useMarketPulseStore();
  const { refresh } = useAutoRefreshToken();
  useViewportShell();

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    setIsScrolled(y > 80);
  }, []);

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

      <header className="shrink-0 bg-background z-50 border-b border-card-border">
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
            <div className="flex items-center justify-between px-3 sm:px-4 lg:px-5 py-2 border-b border-card-border/30">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#FFB800]/15 border border-[#FFB800]/30 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-[#FFB800]" />
                </div>
                <div>
                  <h2 className="font-mono font-bold text-sm text-[#e4e4e7] tracking-wider">MARKET PULSE</h2>
                  <p className="font-mono text-[9px] text-[#71717a] tracking-widest uppercase">Multi-Asset Macro Analysis</p>
                </div>
              </div>

            </div>
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

        <main ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto app-content pb-24">

          {activeBottom === "markets" && (
            <>
              <MacroBar />

              <div className="sticky top-0 z-40 bg-background">
                <MetricsBar compact={isScrolled} />
                <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} />
              </div>

              <TickerSearch />

              {contextTab === "news" && <NewsTab />}
              {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} />}
              {contextTab === "company" && <CompanyResearchHub candles={historyData?.candles as any} />}
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
            </>
          )}

          {activeBottom === "scanner" && (
            <MarketScanner subscribeEquitySymbols={subscribeEquitySymbols} />
          )}

          {activeBottom === "ai" && (
            <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} />
          )}

          {activeBottom === "portfolio" && (
            <PortfolioView onNavigateToSymbol={() => setActiveBottom("markets")} />
          )}

          {activeBottom === "watchlist" && (
            <WatchlistView />
          )}

        </main>
      </div>

      <BottomNav activeTab={activeBottom} onTabChange={setActiveBottom} />

      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <InAppBrowser />
    </div>
  );
}


function WatchlistView() {
  const { watchlist, removeFromWatchlist, setSymbol } = useTerminalStore();

  return (
    <div className="flex-1 flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Star className="w-5 h-5 text-primary" />
        <h2 className="font-mono text-sm font-bold text-foreground tracking-wider">WATCHLIST</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{watchlist.length} symbols</span>
      </div>

      {watchlist.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
          <ListOrdered className="w-10 h-10 text-primary/20" />
          <p className="font-mono text-xs text-muted-foreground text-center">No symbols watched.<br />Search for a ticker and tap '+' to add.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {watchlist.map((sym) => (
            <div
              key={sym}
              onClick={() => setSymbol(sym)}
              role="button"
              tabIndex={0}
              className="bg-card border border-card-border rounded-xl p-3 flex items-center gap-3 hover:border-primary/30 transition-colors group cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <span className="font-mono text-[10px] font-bold text-primary">{sym.slice(0, 3)}</span>
              </div>
              <div className="flex-1 text-left min-w-0">
                <span className="font-mono text-xs font-bold text-foreground">{sym}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFromWatchlist(sym); }}
                className="p-1.5 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
