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
import {
  LineChart,
  BarChart2,
  BrainCircuit,
  Menu,
  Radar,
  Newspaper,
  Activity,
  Briefcase,
  ListOrdered,
  Star,
  X,
} from "lucide-react";

type BottomTab = "scanner" | "markets" | "ai" | "portfolio" | "watchlist";
type ContextTab = "news" | "options" | "chart" | "company";

export default function TerminalPage() {
  const { symbol, accessToken, chartPeriod, chartInterval, streamStatus } = useTerminalStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [tearSheetOpen, setTearSheetOpen] = useState(false);
  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeBottom, setActiveBottom] = useState<BottomTab>("markets");
  const [contextTab, setContextTab] = useState<ContextTab>("news");
  const [aiSubTab, setAiSubTab] = useState<AiSubTab | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
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
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              title={streamStatus === "live" ? "Live data" : streamStatus === "connecting" ? "Connecting..." : "Offline"}
              style={{
                background: streamStatus === "live" ? "#00d166" : streamStatus === "connecting" ? "#FFB800" : "#f23645",
                boxShadow: streamStatus === "live" ? "0 0 6px #00d166" : undefined,
              }}
            />
          </div>
        </div>
        <TickerTape />
      </header>

      <div className="flex flex-1 min-h-0 relative">

        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-30"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className={`
          fixed top-0 left-0 h-full z-40 shrink-0
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}>
          <Sidebar onClose={() => setSidebarOpen(false)} onOpenChat={() => setChatOpen(true)} />
        </div>

        <main ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto app-content pb-20">

          {activeBottom === "markets" && (
            <>
              <MacroBar />

              <div className="sticky top-0 z-40 bg-background">
                <AiBiasStrip onNavigateToPulse={() => { setActiveBottom("ai"); setAiSubTab("pulse"); }} />
                <MetricsBar compact={isScrolled} onOpenTearSheet={() => setTearSheetOpen(true)} />
              </div>

              <TickerSearch />

              <Tabs value={contextTab} onValueChange={(v) => setContextTab(v as ContextTab)} className="w-full">
                <div className="sticky top-[110px] z-30 bg-background/95 backdrop-blur-sm py-2 px-1 border-b border-card-border">
                  <TabsList className="grid grid-cols-4 w-full bg-card h-11 border border-card-border">
                    <TabsTrigger value="news" className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-b-primary rounded-none">
                      NEWS
                    </TabsTrigger>
                    <TabsTrigger value="options" className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-b-primary rounded-none">
                      OPTIONS
                    </TabsTrigger>
                    <TabsTrigger value="chart" className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-b-primary rounded-none">
                      CHART
                    </TabsTrigger>
                    <TabsTrigger value="company" className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-b-primary rounded-none">
                      COMPANY
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="news" className="m-0 focus-visible:outline-none">
                  <NewsTab />
                </TabsContent>
                <TabsContent value="options" className="m-0 focus-visible:outline-none">
                  <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} />
                </TabsContent>
                <TabsContent value="chart" className="m-0 focus-visible:outline-none">
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
                </TabsContent>
                <TabsContent value="company" className="m-0 focus-visible:outline-none">
                  <div className="p-4">
                    <button
                      onClick={() => setTearSheetOpen(true)}
                      className="w-full bg-card border border-card-border rounded-xl p-4 flex items-center justify-between hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <BarChart2 className="w-5 h-5 text-primary" />
                        <div className="text-left">
                          <span className="font-mono text-xs font-bold text-foreground block">COMPANY RESEARCH</span>
                          <span className="font-mono text-[10px] text-muted-foreground">Tear Sheet & Fundamentals</span>
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-primary">OPEN →</span>
                    </button>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}

          {activeBottom === "scanner" && (
            <MarketScanner subscribeEquitySymbols={subscribeEquitySymbols} />
          )}

          {activeBottom === "ai" && (
            <AiIntelligenceTab initialSubTab={aiSubTab} />
          )}

          {activeBottom === "portfolio" && (
            <PortfolioView />
          )}

          {activeBottom === "watchlist" && (
            <WatchlistView />
          )}

        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-[#0c0c0c] border-t border-primary/30 flex items-center justify-around px-2 z-50 safe-bottom">
        <NavBtn
          icon={<Radar className="w-5 h-5" />}
          label="SCANNER"
          active={activeBottom === "scanner"}
          onClick={() => setActiveBottom("scanner")}
        />
        <NavBtn
          icon={<Activity className="w-5 h-5" />}
          label="MARKETS"
          active={activeBottom === "markets"}
          onClick={() => setActiveBottom("markets")}
        />

        <button
          onClick={() => setActiveBottom("ai")}
          className={`relative -top-4 flex items-center justify-center w-14 h-14 rounded-full shadow-[0_0_15px_rgba(255,184,0,0.4)] transition-transform active:scale-95 ${
            activeBottom === "ai" ? "bg-primary text-background" : "bg-primary/80 text-background/80"
          }`}
        >
          <BrainCircuit className="w-7 h-7" />
        </button>

        <NavBtn
          icon={<Briefcase className="w-5 h-5" />}
          label="PORTFOLIO"
          active={activeBottom === "portfolio"}
          onClick={() => setActiveBottom("portfolio")}
        />
        <NavBtn
          icon={<ListOrdered className="w-5 h-5" />}
          label="WATCHLIST"
          active={activeBottom === "watchlist"}
          onClick={() => setActiveBottom("watchlist")}
        />
      </nav>

      <AiChatOverlay isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <InstitutionalTearSheet isOpen={tearSheetOpen} onClose={() => setTearSheetOpen(false)} />
      <InAppBrowser />
    </div>
  );
}

function NavBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 min-w-0 px-1 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
    >
      {icon}
      <span className="text-[9px] font-mono font-bold tracking-tighter">{label}</span>
    </button>
  );
}

function PortfolioView() {
  const { accessToken } = useTerminalStore();

  if (!accessToken) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 min-h-[60vh]">
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
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">Open Positions</span>
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
