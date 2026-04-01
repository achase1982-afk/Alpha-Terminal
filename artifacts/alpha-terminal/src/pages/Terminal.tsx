import { useState, useEffect, useRef, useCallback } from "react";
import { MetricsBar } from "@/components/MetricsBar";
import { TradingChart } from "@/components/TradingChart";
import { OptionsTab } from "@/components/OptionsTab";
import { AiIntelligenceTab } from "@/components/AiIntelligenceTab";
import { MarketScanner } from "@/components/MarketScanner";
import { MacroBar } from "@/components/MacroBar";
import { TickerTape } from "@/components/TickerTape";
import { TickerSearch } from "@/components/TickerSearch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTerminalStore } from "@/lib/store";
import { useGetPriceHistory } from "@workspace/api-client-react";
import { ChartControls, chartParamsFromStore, isIntradayInterval } from "@/components/ChartControls";
import { useAutoRefreshToken } from "@/hooks/useAutoRefreshToken";
import { useMarketStream } from "@/hooks/useMarketStream";
import { useViewportShell } from "@/hooks/useViewportShell";
import { AiChatOverlay } from "@/components/AiChatOverlay";
import { InstitutionalTearSheet } from "@/views/InstitutionalTearSheet";
import { InAppBrowser } from "@/components/InAppBrowser";
import { NewsTab } from "@/components/NewsTab";
import { AiBiasStrip } from "@/components/market-pulse/AiBiasStrip";
import { BottomNav } from "@/components/BottomNav";
import { WatchlistPage } from "@/pages/WatchlistPage";
import { MarketsPage } from "@/pages/MarketsPage";
import { PortfolioPage } from "@/pages/PortfolioPage";
import { SettingsPage } from "@/pages/SettingsPage";
import type { BottomNavRoute } from "@/components/BottomNav";
import type { AiSubTab } from "@/components/ai-tab/AiSubTabs";
import { LineChart, BarChart2, BrainCircuit, Radar, Newspaper, Settings } from "lucide-react";

export default function TerminalPage() {
  const { symbol, accessToken, chartPeriod, chartInterval, streamStatus, setSymbol } = useTerminalStore();
  const [chatOpen, setChatOpen] = useState(false);
  const [tearSheetOpen, setTearSheetOpen] = useState(false);
  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState("news");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab | undefined>(undefined);
  const [bottomNavRoute, setBottomNavRoute] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { refresh } = useAutoRefreshToken();
  useViewportShell();

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    setIsScrolled(prev => (prev ? y > 30 : y > 60));
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

  const handleBottomNav = (route: BottomNavRoute) => {
    if (route === "scanner") {
      setBottomNavRoute(null);
      setActiveMainTab("scanner");
    } else if (route === "ai") {
      setChatOpen(true);
    } else {
      setBottomNavRoute(route);
    }
  };

  return (
    <div className="app-shell bg-background selection:bg-primary/30 selection:text-white">
      <main className="flex-1 flex flex-col min-h-0 bg-background relative min-w-0" style={{ overflow: "clip" }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full" />
        </div>

        <div id="terminal-header" className="sticky top-0 z-50 shrink-0 bg-background">
          <div className="flex items-center h-12 px-4 border-b border-card-border bg-card">
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors mr-3"
              aria-label="Open settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <div className="flex flex-col leading-none">
              <span className="font-sans font-black text-base tracking-wider text-foreground">ALPHA</span>
              <span className="font-sans font-semibold text-[10px] tracking-[0.25em] text-primary">TERMINAL</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="font-mono text-xs text-primary font-bold">{symbol}</span>
              {accessToken && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  title={streamStatus === "live" ? "Live data" : streamStatus === "connecting" ? "Connecting..." : "Offline"}
                  style={{
                    background: streamStatus === "live" ? "#00d166" : streamStatus === "connecting" ? "#FFB800" : "#f23645",
                    boxShadow: streamStatus === "live" ? "0 0 6px #00d166" : undefined,
                  }}
                />
              )}
            </div>
          </div>

          <TickerTape />
        </div>

        <div ref={scrollRef} onScroll={handleScroll} className="app-content z-10">
          <MacroBar />

          <div style={{ position: "sticky", top: 0, zIndex: 45 }}>
            <AiBiasStrip onNavigateToPulse={() => { setActiveMainTab("ai"); setAiSubTab("pulse"); }} />
          </div>

          <MetricsBar compact={isScrolled} onOpenTearSheet={() => setTearSheetOpen(true)} />

          <TickerSearch />

          <div className="flex flex-col" style={{ minHeight: "calc(var(--vvh, 100%) - 80px)" }}>
            <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="flex flex-col flex-1">
              <div className="shrink-0 mb-4 sticky top-0 z-30 bg-background px-1 w-full" style={{ position: "sticky", top: 71, zIndex: 40 }}>
                <div className="overflow-x-auto flex justify-center">
                  <TabsList className="bg-card border border-card-border p-1 inline-flex min-w-max">
                    <TabsTrigger
                      value="news"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <Newspaper className="w-4 h-4 shrink-0" />
                      NEWS
                    </TabsTrigger>
                    <TabsTrigger
                      value="options"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <BarChart2 className="w-4 h-4 shrink-0" />
                      OPTIONS
                    </TabsTrigger>
                    <TabsTrigger
                      value="ai"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <BrainCircuit className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:inline">AI INTELLIGENCE</span>
                      <span className="sm:hidden">AI</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="scanner"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <Radar className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:inline">MARKET SCANNER</span>
                      <span className="sm:hidden">SCAN</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="chart"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <LineChart className="w-4 h-4 shrink-0" />
                      CHART
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>

              <TabsContent value="news" className="m-0 focus-visible:outline-none flex-1 flex flex-col">
                <NewsTab />
              </TabsContent>
              <TabsContent value="options" className="m-0 focus-visible:outline-none">
                <div style={{ height: "calc(var(--vvh,100vh) - 140px)" }}>
                  <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} />
                </div>
              </TabsContent>
              <TabsContent value="ai" className="m-0 focus-visible:outline-none flex-1 flex flex-col -mt-2">
                <AiIntelligenceTab initialSubTab={aiSubTab} />
              </TabsContent>
              <TabsContent value="scanner" className="m-0 focus-visible:outline-none">
                <MarketScanner subscribeEquitySymbols={subscribeEquitySymbols} />
              </TabsContent>
              <TabsContent value="chart" className="h-[420px] sm:h-[500px] md:h-[580px] lg:h-[calc(var(--vvh,100vh)-300px)] m-0 focus-visible:outline-none data-[state=active]:flex flex-col">
                <ChartControls />
                <TradingChart
                  symbol={symbol}
                  data={historyData?.candles || []}
                  isLoading={historyLoading}
                  error={historyData?.error}
                  timedOut={historyTimedOut}
                  tokenExpired={historyData?.error === "unauthorized"}
                  intraday={isIntradayInterval(chartInterval)}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      <BottomNav
        activeRoute={bottomNavRoute}
        activeMainTab={activeMainTab}
        onNavigate={handleBottomNav}
      />

      {bottomNavRoute === "watchlist" && (
        <WatchlistPage
          onClose={() => setBottomNavRoute(null)}
          onSelectSymbol={(sym) => { setSymbol(sym); setBottomNavRoute(null); }}
        />
      )}
      {bottomNavRoute === "markets" && (
        <MarketsPage onClose={() => setBottomNavRoute(null)} />
      )}
      {bottomNavRoute === "portfolio" && (
        <PortfolioPage onClose={() => setBottomNavRoute(null)} />
      )}
      {settingsOpen && (
        <SettingsPage onClose={() => setSettingsOpen(false)} />
      )}

      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <InstitutionalTearSheet isOpen={tearSheetOpen} onClose={() => setTearSheetOpen(false)} />
      <InAppBrowser />
    </div>
  );
}
