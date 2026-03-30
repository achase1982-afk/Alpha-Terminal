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
import type { AiSubTab } from "@/components/ai-tab/AiSubTabs";
import { LineChart, BarChart2, BrainCircuit, Menu, Radar, Newspaper } from "lucide-react";

export default function TerminalPage() {
  const { symbol, accessToken, chartPeriod, chartInterval, streamStatus } = useTerminalStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [tearSheetOpen, setTearSheetOpen] = useState(false);
  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState("news");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab | undefined>(undefined);
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

  // ── 5-second safety timeout: forces "not found" state if no data arrives ──
  useEffect(() => {
    setHistoryTimedOut(false);
    if (!accessToken) return;
    const timer = setTimeout(() => setHistoryTimedOut(true), 5_000);
    return () => clearTimeout(timer);
  }, [symbol, accessToken]);

  return (
    <div className="app-shell bg-background selection:bg-primary/30 selection:text-white">
      <div className="flex flex-row flex-1 min-h-0 w-full">

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed lg:relative top-0 left-0 h-full z-40 shrink-0
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} onOpenChat={() => setChatOpen(true)} />
      </div>

      <main className="flex-1 flex flex-col min-h-0 bg-background relative min-w-0" style={{ overflow: "clip" }}>
        {/* Ambient glow — clipped inside its own overflow-hidden layer */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full" />
        </div>

        {/* ─── Sticky top: Mobile header + Ticker tape ─── */}
        <div id="terminal-header" className="sticky top-0 z-50 shrink-0 bg-background">
          {/* Mobile top bar */}
          <div className="flex items-center lg:hidden h-12 px-4 border-b border-card-border bg-card">
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors mr-3"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
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

          {/* ─── Ticker tape scrolling marquee ─── */}
          <TickerTape />
        </div>

        <div ref={scrollRef} onScroll={handleScroll} className="app-content z-10">
          {/* ─── Macro Cards ─── */}
          <MacroBar />

          {/* ─── AI Bias Strip (sticky: scrolls with content, pins below ticker tape) ─── */}
          <div className="sticky top-0 z-40">
            <AiBiasStrip onNavigateToPulse={() => { setActiveMainTab("ai"); setAiSubTab("pulse"); }} />
          </div>

          {/* ─── Metrics row (sticky + collapsible) ─── */}
          <MetricsBar compact={isScrolled} onOpenTearSheet={() => setTearSheetOpen(true)} />

          {/* ─── Prominent search bar ─── */}
          <TickerSearch />

          <div className="flex flex-col" style={{ minHeight: "calc(var(--vvh, 100%) - 80px)" }}>
            <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="flex flex-col flex-1">
              <div className="shrink-0 mb-4 sticky top-[42px] z-30 bg-background py-1 px-3 sm:px-4 lg:px-5">
                <div className="overflow-x-auto">
                  <TabsList className="bg-card border border-card-border p-1 inline-flex min-w-max">
                    <TabsTrigger
                      value="news"
                      className="font-mono text-[10px] sm:text-xs uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-1.5 px-3"
                    >
                      <Newspaper className="w-3.5 h-3.5 shrink-0" />
                      NEWS
                    </TabsTrigger>
                    <TabsTrigger
                      value="options"
                      className="font-mono text-[10px] sm:text-xs uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-1.5 px-3"
                    >
                      <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                      OPTIONS
                    </TabsTrigger>
                    <TabsTrigger
                      value="ai"
                      className="font-mono text-[10px] sm:text-xs uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-1.5 px-3"
                    >
                      <BrainCircuit className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline">AI INTELLIGENCE</span>
                      <span className="sm:hidden">AI</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="scanner"
                      className="font-mono text-[10px] sm:text-xs uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-1.5 px-3"
                    >
                      <Radar className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline">MARKET SCANNER</span>
                      <span className="sm:hidden">SCAN</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="chart"
                      className="font-mono text-[10px] sm:text-xs uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-1.5 px-3"
                    >
                      <LineChart className="w-3.5 h-3.5 shrink-0" />
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
      </div>

      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <InstitutionalTearSheet isOpen={tearSheetOpen} onClose={() => setTearSheetOpen(false)} />
      <InAppBrowser />
    </div>
  );
}
