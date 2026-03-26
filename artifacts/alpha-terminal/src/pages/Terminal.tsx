import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MetricsBar } from "@/components/MetricsBar";
import { TradingChart } from "@/components/TradingChart";
import { OptionsTab } from "@/components/OptionsTab";
import { AiAnalysisTab } from "@/components/AiAnalysisTab";
import { AiChatTab } from "@/components/AiChatTab";
import { TickerTape } from "@/components/TickerTape";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTerminalStore } from "@/lib/store";
import { useGetPriceHistory } from "@workspace/api-client-react";
import { LineChart, BarChart2, SquareTerminal, BrainCircuit, Menu } from "lucide-react";

export default function TerminalPage() {
  const { symbol, accessToken, timeframe } = useTerminalStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: historyData } = useGetPriceHistory(
    { symbol, accessToken: accessToken || '', timeframe },
    { query: { enabled: !!accessToken && !!symbol } }
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30 selection:text-white">

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — drawer on mobile, static on desktop */}
      <div className={`
        fixed lg:static top-0 left-0 h-full z-40
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-background relative min-w-0">
        {/* Ambient glow */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />

        {/* Mobile top bar */}
        <div className="flex items-center lg:hidden h-14 px-4 border-b border-card-border bg-card z-10 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors mr-3"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col leading-none">
            <span className="font-sans font-black text-lg tracking-wider text-foreground">
              ALPHA
            </span>
            <span className="font-sans font-semibold text-[11px] tracking-[0.25em] text-primary">
              TERMINAL
            </span>
          </div>
          <span className="ml-auto font-mono text-xs text-muted-foreground uppercase">{symbol}</span>
        </div>

        <TickerTape />
        <MetricsBar />

        <div className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6 z-10">
          <Tabs defaultValue="chart" className="flex flex-col h-full">
            {/* Tabs list — scrollable on very small screens */}
            <div className="overflow-x-auto shrink-0 mb-4">
              <TabsList className="bg-card border border-card-border p-1 inline-flex min-w-max">
                <TabsTrigger
                  value="chart"
                  className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1 sm:gap-2 px-2 sm:px-3"
                >
                  <LineChart className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden xs:inline">CHART</span>
                  <span className="xs:hidden">CHART</span>
                </TabsTrigger>
                <TabsTrigger
                  value="options"
                  className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1 sm:gap-2 px-2 sm:px-3"
                >
                  <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                  <span>OPTIONS</span>
                </TabsTrigger>
                <TabsTrigger
                  value="analysis"
                  className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1 sm:gap-2 px-2 sm:px-3"
                >
                  <BrainCircuit className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">AI ANALYSIS</span>
                  <span className="sm:hidden">AI</span>
                </TabsTrigger>
                <TabsTrigger
                  value="chat"
                  className="font-mono text-[10px] sm:text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1 sm:gap-2 px-2 sm:px-3"
                >
                  <SquareTerminal className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">AI CHAT</span>
                  <span className="sm:hidden">CHAT</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0">
              <TabsContent value="chart" className="h-full m-0 focus-visible:outline-none data-[state=active]:flex flex-col">
                <TradingChart data={historyData?.candles || []} />
              </TabsContent>
              <TabsContent value="options" className="h-full m-0 overflow-auto focus-visible:outline-none">
                <OptionsTab />
              </TabsContent>
              <TabsContent value="analysis" className="h-full m-0 overflow-auto focus-visible:outline-none">
                <AiAnalysisTab />
              </TabsContent>
              <TabsContent value="chat" className="h-full m-0 overflow-hidden focus-visible:outline-none">
                <AiChatTab />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
