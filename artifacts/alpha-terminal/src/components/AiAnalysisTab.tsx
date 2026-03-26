import { useState } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote, useGetPriceHistory, useGetOptionChain, useRunTechnicalAnalysis, useRunOptionsAnalysis } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Cpu, Zap, Activity, BarChart2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

export function AiAnalysisTab() {
  const { symbol, accessToken, aiModel, aiTemp } = useTerminalStore();
  const [customPrompt, setCustomPrompt] = useState("");
  const [response, setResponse] = useState<string | null>(null);

  // Data fetching
  const { data: quote } = useGetQuote({ symbol, accessToken: accessToken || '' }, { query: { enabled: !!accessToken } });
  const { data: history } = useGetPriceHistory({ symbol, accessToken: accessToken || '', periodType: "month", period: 3, frequencyType: "daily", frequency: 1 }, { query: { enabled: !!accessToken } });
  // We don't auto-fetch options here to save API calls, relying on what's cached or requiring options tab to be loaded first
  // For a robust app, we might trigger a fetch. Here we just try to get from cache
  const { data: chain } = useGetOptionChain({ symbol, accessToken: accessToken || '', contractType: "ALL", daysToExpiration: 30 }, { query: { enabled: false } });

  const taMutation = useRunTechnicalAnalysis();
  const oaMutation = useRunOptionsAnalysis();

  const handleRunTA = () => {
    if (!quote || !history?.candles) {
      alert("Missing market data. Please ensure you are connected and data is loaded.");
      return;
    }
    setResponse(null);
    taMutation.mutate(
      { data: { quote, candles: history.candles, model: aiModel, temperature: aiTemp, customPrompt } },
      { onSuccess: (data) => setResponse(data.response) }
    );
  };

  const handleRunOptions = () => {
    if (!quote || !chain) {
      alert("Missing options data. Please load the Option Chain in the Options tab first.");
      return;
    }
    setResponse(null);
    oaMutation.mutate(
      { data: { quote, chain, model: aiModel, temperature: aiTemp, customPrompt } },
      { onSuccess: (data) => setResponse(data.response) }
    );
  };

  const isPending = taMutation.isPending || oaMutation.isPending;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-6">
      
      <div className="flex flex-wrap gap-4 items-start bg-card p-6 rounded-xl border border-card-border relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
          <Cpu className="w-32 h-32" />
        </div>
        
        <div className="w-full space-y-4 relative z-10">
          <div>
            <h3 className="text-lg font-bold font-sans text-foreground glow-text flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" /> AI COGNITION ENGINE
            </h3>
            <p className="text-sm font-mono text-muted-foreground mt-1">
              MODEL: <span className="text-primary">{aiModel}</span> | TEMP: <span className="text-primary">{aiTemp}</span> | TARGET: <span className="text-primary">{symbol}</span>
            </p>
          </div>

          <Textarea 
            placeholder="Add specific instructions for the AI (optional)... e.g. 'Focus on the recent MACD divergence'"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="font-mono text-sm bg-background border-card-border focus-visible:ring-primary/50 min-h-[80px]"
          />

          <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              onClick={handleRunTA} 
              disabled={isPending || !accessToken}
              className="flex-1 font-mono text-xs sm:text-sm bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_rgba(0,212,170,0.2)]"
            >
              <Activity className="w-4 h-4 mr-2 shrink-0" />
              RUN TECHNICAL ANALYSIS
            </Button>
            <Button 
              onClick={handleRunOptions} 
              disabled={isPending || !accessToken || !chain}
              variant="outline"
              className="flex-1 font-mono text-xs sm:text-sm border-primary/50 text-primary hover:bg-primary/10"
            >
              <BarChart2 className="w-4 h-4 mr-2 shrink-0" />
              RUN OPTIONS ANALYSIS
            </Button>
          </div>
        </div>
      </div>

      <div className="terminal-panel p-6 bg-[#0D1117] min-h-[300px]">
        {isPending && (
          <div className="flex flex-col items-center justify-center py-20 space-y-6 opacity-70">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="font-mono text-primary animate-pulse tracking-widest text-sm">PROCESSING NEURAL ANALYSIS...</p>
          </div>
        )}

        {!isPending && !response && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-mono opacity-50">
            <Cpu className="w-16 h-16 mb-4" />
            <p>AWAITING INSTRUCTIONS</p>
          </div>
        )}

        {!isPending && response && (
          <div className="prose prose-invert prose-primary max-w-none font-sans text-gray-300
            prose-headings:text-white prose-headings:font-bold prose-headings:tracking-wide
            prose-a:text-primary hover:prose-a:text-primary/80
            prose-strong:text-white prose-strong:font-bold
            prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
            prose-pre:bg-card prose-pre:border prose-pre:border-card-border"
          >
            <ReactMarkdown>{response}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
