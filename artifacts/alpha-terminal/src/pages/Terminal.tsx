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
import { useStreamingQuotes } from "@/hooks/useStreamingQuotes";
import { AiChatOverlay } from "@/components/AiChatOverlay";
import { CompanyTearSheet } from "@/components/CompanyTearSheet";
import { LineChart, BarChart2, BrainCircuit, Menu, Radar, Wifi, WifiOff } from "lucide-react";

export default function TerminalPage() {
  const { symbol, accessToken, chartPeriod, chartInterval, streamConnected } = useTerminalStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [tearSheetOpen, setTearSheetOpen] = useState(false);
  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { refresh } = useAutoRefreshToken();

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    setIsScrolled(prev => (prev ? y > 30 : y > 60));
  }, []);

  // ── Start and maintain the Schwab WebSocket stream ──────────────────────
  useStreamingQuotes();

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
    <div className="flex h-full w-full bg-background overflow-hidden selection:bg-primary/30 selection:text-white">

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:static top-0 left-0 h-full z-40
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} onOpenChat={() => setChatOpen(true)} />
      </div>

      {/* Main content — four corners lock */}
      <main className="flex-1 flex flex-col h-full bg-background relative min-w-0 overflow-hidden">
        {/* Ambient glow — clipped inside its own overflow-hidden layer */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full" />
        </div>

        {/* ─── Header: in-flow, shrink-0, never scrolls ─── */}
        <div className="shrink-0 z-50 bg-background relative">
          {/* Mobile top bar */}
          <div className="flex items-center lg:hidden h-12 px-4 border-b border-card-border bg-card">
            <button
              onClick={() => setSidebarOpen(true)}
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
                streamConnected
                  ? <span className="flex items-center gap-0.5 font-mono text-[9px] text-emerald-500"><Wifi className="w-3 h-3" />LIVE</span>
                  : <span className="flex items-center gap-0.5 font-mono text-[9px] text-gray-600"><WifiOff className="w-3 h-3" />POLL</span>
              )}
            </div>
          </div>

          {/* ─── Ticker tape scrolling marquee ─── */}
          <TickerTape />
        </div>

        {/* ─── Scrollable content: only this area scrolls ─── */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto z-10">
          <div className="max-w-7xl mx-auto w-full">
          {/* ─── Macro Cards ─── */}
          <MacroBar />

          {/* ─── Metrics row (sticky + collapsible) ─── */}
          <MetricsBar compact={isScrolled} onOpenTearSheet={() => setTearSheetOpen(true)} />

          {/* ─── Prominent search bar ─── */}
          <TickerSearch />

          <div className="p-3 sm:p-4 lg:p-5" style={{ minHeight: "calc(100dvh - 80px)" }}>
            <Tabs defaultValue="chart" className="flex flex-col">
              <div className="overflow-x-auto shrink-0 mb-4 sticky top-[36px] z-30 bg-background py-1 -mx-3 px-3 sm:-mx-4 sm:px-4 lg:-mx-5 lg:px-5">
                <TabsList className="bg-card border border-card-border p-1 inline-flex min-w-max">
                  <TabsTrigger
                    value="chart"
                    className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5 px-3"
                  >
                    <LineChart className="w-3.5 h-3.5 shrink-0" />
                    CHART
                  </TabsTrigger>
                  <TabsTrigger
                    value="options"
                    className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5 px-3"
                  >
                    <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                    OPTIONS
                  </TabsTrigger>
                  <TabsTrigger
                    value="ai"
                    className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5 px-3"
                  >
                    <BrainCircuit className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">AI INTELLIGENCE</span>
                    <span className="sm:hidden">AI</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="scanner"
                    className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5 px-3"
                  >
                    <Radar className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">MARKET SCANNER</span>
                    <span className="sm:hidden">SCAN</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="chart" className="h-[420px] sm:h-[500px] md:h-[580px] lg:h-[calc(100dvh-300px)] m-0 focus-visible:outline-none data-[state=active]:flex flex-col">
                <ChartControls />
                <TradingChart
                  data={historyData?.candles || []}
                  isLoading={historyLoading}
                  error={historyData?.error}
                  timedOut={historyTimedOut}
                  tokenExpired={historyData?.error === "unauthorized"}
                  intraday={isIntradayInterval(chartInterval)}
                />
              </TabsContent>
              <TabsContent value="options" className="m-0 focus-visible:outline-none">
                <OptionsTab />
              </TabsContent>
              <TabsContent value="ai" className="m-0 focus-visible:outline-none">
                <AiIntelligenceTab />
              </TabsContent>
              <TabsContent value="scanner" className="m-0 focus-visible:outline-none">
                <MarketScanner />
              </TabsContent>
            </Tabs>
          </div>
          </div>
        </div>
      </main>

      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <CompanyTearSheet isOpen={tearSheetOpen} onClose={() => setTearSheetOpen(false)} />
    </div>
  );
}
