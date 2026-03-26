import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MetricsBar } from "@/components/MetricsBar";
import { TradingChart } from "@/components/TradingChart";
import { OptionsTab } from "@/components/OptionsTab";
import { AiAnalysisTab } from "@/components/AiAnalysisTab";
import { AiChatTab } from "@/components/AiChatTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTerminalStore } from "@/lib/store";
import { useGetPriceHistory } from "@workspace/api-client-react";
import { LineChart, BarChart2, SquareTerminal, BrainCircuit } from "lucide-react";

export default function TerminalPage() {
  const { symbol, accessToken, timeframe } = useTerminalStore();
  
  // Fetch main chart data here so we can pass it down if needed, or component can fetch itself.
  // We'll pass it down to ChartTab to keep logic clean.
  const { data: historyData } = useGetPriceHistory(
    { symbol, accessToken: accessToken || '', timeframe },
    { query: { enabled: !!accessToken && !!symbol } }
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30 selection:text-white">
      <Sidebar />
      
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-background relative">
        {/* Glow effect behind main content */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
        
        <MetricsBar />

        <div className="flex-1 overflow-hidden p-4 lg:p-6 z-10">
          <Tabs defaultValue="chart" className="h-full flex flex-col">
            <TabsList className="bg-card border border-card-border p-1 justify-start mb-6 inline-flex self-start">
              <TabsTrigger value="chart" className="font-mono text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:glow-border gap-2">
                <LineChart className="w-4 h-4" /> CHART
              </TabsTrigger>
              <TabsTrigger value="options" className="font-mono text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:glow-border gap-2">
                <BarChart2 className="w-4 h-4" /> OPTIONS
              </TabsTrigger>
              <TabsTrigger value="analysis" className="font-mono text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:glow-border gap-2">
                <BrainCircuit className="w-4 h-4" /> AI ANALYSIS
              </TabsTrigger>
              <TabsTrigger value="chat" className="font-mono text-xs uppercase data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:glow-border gap-2">
                <SquareTerminal className="w-4 h-4" /> AI CHAT
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="chart" className="h-full m-0 focus-visible:outline-none data-[state=active]:flex flex-col">
                <TradingChart data={historyData?.candles || []} />
              </TabsContent>
              
              <TabsContent value="options" className="h-full m-0 focus-visible:outline-none">
                <OptionsTab />
              </TabsContent>
              
              <TabsContent value="analysis" className="h-full m-0 focus-visible:outline-none">
                <AiAnalysisTab />
              </TabsContent>
              
              <TabsContent value="chat" className="h-full m-0 focus-visible:outline-none">
                <AiChatTab />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
