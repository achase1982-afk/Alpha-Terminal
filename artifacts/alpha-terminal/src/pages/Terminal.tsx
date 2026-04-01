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
import { LineChart, BarChart2, BrainCircuit, Menu, Radar, Newspaper, Activity, Briefcase, ListOrdered, Star, TrendingUp, TrendingDown, Minus, X } from "lucide-react";

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

          {/* ─── AI Bias Strip ─── */}
          <div style={{ position: "sticky", top: 0, zIndex: 45 }}>
            <AiBiasStrip onNavigateToPulse={() => { setActiveMainTab("ai"); setAiSubTab("pulse"); }} />
          </div>

          {/* ─── Metrics row (sticky + collapsible) ─── */}
          <MetricsBar compact={isScrolled} onOpenTearSheet={() => setTearSheetOpen(true)} />

          {/* ─── Prominent search bar ─── */}
          <TickerSearch />

          <div className="flex flex-col pb-20 lg:pb-0" style={{ minHeight: "calc(var(--vvh, 100%) - 80px)" }}>
            <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="flex flex-col flex-1">
              <div className="shrink-0 mb-4 sticky top-0 z-30 bg-background px-1 w-full hidden lg:block" style={{ position: "sticky", top: 71, zIndex: 40 }}>
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
                      AI INTELLIGENCE
                    </TabsTrigger>
                    <TabsTrigger
                      value="scanner"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <Radar className="w-4 h-4 shrink-0" />
                      MARKET SCANNER
                    </TabsTrigger>
                    <TabsTrigger
                      value="chart"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <LineChart className="w-4 h-4 shrink-0" />
                      CHART
                    </TabsTrigger>
                    <TabsTrigger
                      value="portfolio"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <Briefcase className="w-4 h-4 shrink-0" />
                      PORTFOLIO
                    </TabsTrigger>
                    <TabsTrigger
                      value="watchlist"
                      className="font-mono text-xs sm:text-sm uppercase rounded-none border-b-2 border-b-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-white data-[state=active]:border-b-[#FFB800] gap-2 px-4 py-2.5"
                    >
                      <ListOrdered className="w-4 h-4 shrink-0" />
                      WATCHLIST
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>

              <TabsContent value="news" className="m-0 focus-visible:outline-none flex-1 flex flex-col">
                <NewsTab />
              </TabsContent>
              <TabsContent value="markets" className="m-0 focus-visible:outline-none flex-1 flex flex-col">
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
              <TabsContent value="portfolio" className="m-0 focus-visible:outline-none flex-1 flex flex-col">
                <PortfolioView />
              </TabsContent>
              <TabsContent value="watchlist" className="m-0 focus-visible:outline-none flex-1 flex flex-col">
                <WatchlistView />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-[#0c0c0c] border-t border-primary/20 flex items-center justify-around px-2 z-50 lg:hidden safe-bottom">
        <button
          onClick={() => setActiveMainTab("scanner")}
          className={`flex flex-col items-center gap-0.5 min-w-0 px-1 transition-colors ${activeMainTab === "scanner" ? "text-primary" : "text-muted-foreground"}`}
        >
          <Radar className="w-5 h-5" />
          <span className="text-[8px] font-mono font-bold tracking-tighter">SCANNER</span>
        </button>

        <button
          onClick={() => setActiveMainTab("markets")}
          className={`flex flex-col items-center gap-0.5 min-w-0 px-1 transition-colors ${activeMainTab === "markets" || activeMainTab === "news" ? "text-primary" : "text-muted-foreground"}`}
        >
          <Activity className="w-5 h-5" />
          <span className="text-[8px] font-mono font-bold tracking-tighter">MARKETS</span>
        </button>

        <button
          onClick={() => { setActiveMainTab("ai"); setChatOpen(false); }}
          className="relative -top-4 flex items-center justify-center w-14 h-14 rounded-full bg-primary shadow-lg shadow-primary/30 text-background transition-transform active:scale-95"
        >
          <BrainCircuit className="w-7 h-7" />
        </button>

        <button
          onClick={() => setActiveMainTab("portfolio")}
          className={`flex flex-col items-center gap-0.5 min-w-0 px-1 transition-colors ${activeMainTab === "portfolio" ? "text-primary" : "text-muted-foreground"}`}
        >
          <Briefcase className="w-5 h-5" />
          <span className="text-[8px] font-mono font-bold tracking-tighter">PORTFOLIO</span>
        </button>

        <button
          onClick={() => setActiveMainTab("watchlist")}
          className={`flex flex-col items-center gap-0.5 min-w-0 px-1 transition-colors ${activeMainTab === "watchlist" ? "text-primary" : "text-muted-foreground"}`}
        >
          <ListOrdered className="w-5 h-5" />
          <span className="text-[8px] font-mono font-bold tracking-tighter">WATCHLIST</span>
        </button>
      </nav>

      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <InstitutionalTearSheet isOpen={tearSheetOpen} onClose={() => setTearSheetOpen(false)} />
      <InAppBrowser />
    </div>
  );
}

function PortfolioView() {
  const { accessToken } = useTerminalStore();

  if (!accessToken) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <Briefcase className="w-12 h-12 text-primary/30" />
        <p className="font-mono text-sm text-muted-foreground text-center">CONNECT SCHWAB TO VIEW PORTFOLIO</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Briefcase className="w-5 h-5 text-primary" />
        <h2 className="font-mono text-sm font-bold text-foreground tracking-wider">PORTFOLIO</h2>
      </div>
      <div className="grid gap-3">
        <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">Net Liquidation</span>
            <span className="font-mono text-lg font-bold text-foreground tabular-nums">--</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">Day P&L</span>
              <p className="font-mono text-sm font-bold text-foreground tabular-nums">--</p>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">Buying Power</span>
              <p className="font-mono text-sm font-bold text-foreground tabular-nums">--</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">Open Positions</span>
          </div>
          <p className="font-mono text-xs text-muted-foreground/60 text-center py-8">
            Position data will populate when Schwab streaming is active.
          </p>
        </div>
      </div>
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
