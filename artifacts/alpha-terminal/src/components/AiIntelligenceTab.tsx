import { useState } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
  useRunTechnicalAnalysis,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, BarChart2,
  Target,
} from "lucide-react";

import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

function MarkdownResult({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-primary max-w-none font-sans text-gray-300
      prose-headings:text-white prose-headings:font-bold prose-headings:tracking-wide prose-headings:mt-4 prose-headings:mb-2
      prose-h2:text-base prose-h3:text-sm
      prose-a:text-primary hover:prose-a:text-primary/80
      prose-strong:text-white prose-strong:font-bold
      prose-li:my-0.5
      prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
      prose-pre:bg-card prose-pre:border prose-pre:border-card-border prose-pre:text-xs"
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

export function AiIntelligenceTab() {
  const {
    symbol, accessToken,
    aiModel, aiTemp,
    analysisResult, setAnalysisResult,
    strategistResult, setStrategistResult,
  } = useTerminalStore();

  const [customPrompt, setCustomPrompt] = useState("");
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [activeResult, setActiveResult] = useState<"analysis" | "strategist" | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );
  const { data: history } = useGetPriceHistory(
    { symbol, accessToken: accessToken || "", periodType: "month", period: 3, frequencyType: "daily", frequency: 1 },
    { query: { enabled: !!accessToken } }
  );
  const { data: chain, isLoading: chainLoading } = useGetOptionChain(
    { symbol, accessToken: accessToken || "", contractType: "ALL", daysToExpiration: 30 },
    { query: { enabled: !!accessToken && chainEnabled } }
  );


  const taMutation = useRunTechnicalAnalysis();


  const handleRunTA = () => {
    if (!quote || !history?.candles) return;
    setAnalysisResult(null);
    setActiveResult("analysis");
    taMutation.mutate(
      { data: { quote, candles: history.candles, model: aiModel, temperature: aiTemp, customPrompt } },
      { onSuccess: (data) => setAnalysisResult(data.response) }
    );
  };

  const handleRunStrategist = async () => {
    if (!quote || !accessToken) return;
    setStrategistResult(null);
    setActiveResult("strategist");
    setChainEnabled(true);
    setIsStrategizing(true);

    try {
      let chainData = chain ?? null;
      if (!chainData) {
        const chainRes = await fetch(
          `${API_BASE}/market/options?symbol=${encodeURIComponent(symbol)}&accessToken=${encodeURIComponent(accessToken)}&contractType=ALL&daysToExpiration=30`
        );
        if (!chainRes.ok) {
          const errText = await chainRes.text().catch(() => "Unknown error");
          setStrategistResult(`**Error fetching options chain:** ${errText}`);
          return;
        }
        chainData = await chainRes.json();
        if (chainData?.error && chainData.error !== "unauthorized") {
          setStrategistResult(`**Options chain error:** ${chainData.error}${chainData.message ? ` — ${chainData.message}` : ""}`);
          return;
        }
      }

      const res = await fetch(`${API_BASE}/ai/options-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote,
          candles: history?.candles ?? [],
          chain: chainData,
          model: aiModel,
          temperature: aiTemp,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        setStrategistResult(`**Strategist error:** ${errText}`);
        return;
      }
      const data = await res.json() as { response?: string };
      setStrategistResult(data.response ?? "No response received.");
    } catch (err) {
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsStrategizing(false);
    }
  };


  const isPendingAnalysis = taMutation.isPending;
  const isPendingAny = isPendingAnalysis || isStrategizing;

  const currentResult = activeResult === "analysis" ? analysisResult
    : activeResult === "strategist" ? strategistResult
    : null;

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto pb-6">

      {/* ── DEEP ANALYSIS ── */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <span className="font-mono text-xs font-bold text-foreground">DEEP ANALYSIS — {symbol}</span>
        </div>
        <div className="p-4 space-y-3 bg-[#0c0c0c]">
          <Textarea
            placeholder="Add specific instructions (optional)... e.g. 'Focus on the MACD divergence and key gamma levels'"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            className="font-mono text-xs bg-background border-card-border focus-visible:ring-primary/50 min-h-[60px] resize-none"
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleRunTA}
              disabled={isPendingAny || !accessToken || !quote}
              className="flex-1 font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Activity className="w-3.5 h-3.5 mr-2 shrink-0" />
              RUN TECHNICAL ANALYSIS
            </Button>
            <Button
              onClick={handleRunStrategist}
              disabled={isPendingAny || !accessToken || !quote}
              variant="outline"
              className="flex-1 font-mono text-xs border-primary/50 text-primary hover:bg-primary/10"
            >
              {chainLoading ? (
                <><span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />LOADING CHAIN...</>
              ) : (
                <><BarChart2 className="w-3.5 h-3.5 mr-2 shrink-0" />RUN OPTIONS STRATEGIST</>
              )}
            </Button>
          </div>
        </div>

        {/* Analysis / Strategist Result */}
        {(activeResult === "analysis" || activeResult === "strategist") && (
          <div className="border-t border-card-border p-4 bg-[#0c0c0c]">
            {isPendingAnalysis || isStrategizing ? (
              <div className="flex flex-col items-center justify-center py-10 gap-4">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="font-mono text-xs text-primary animate-pulse tracking-widest">
                  {isStrategizing ? "RUNNING DERIVATIVES STRATEGIST..." : "PROCESSING TECHNICAL ANALYSIS..."}
                </span>
              </div>
            ) : currentResult ? (
              <MarkdownResult content={currentResult} />
            ) : null}
          </div>
        )}
      </div>

    </div>
  );
}
