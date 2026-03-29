import { useState, useMemo, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
  useRunTechnicalAnalysis,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, BarChart2,
  Target, DollarSign, Shield, TrendingUp, Scale,
} from "lucide-react";

import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

const THINKING_PHRASES = [
  "Analyzing options chain...",
  "Evaluating MACD divergence...",
  "Calculating risk/reward...",
  "Drafting strategy...",
];

function AiThinking() {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPhraseIdx(i => (i + 1) % THINKING_PHRASES.length), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-3 py-8 justify-center">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <style>{`
          @keyframes ai-star-pulse { 0%,100% { opacity:.45; transform:scale(.85) rotate(0deg); } 50% { opacity:1; transform:scale(1.1) rotate(90deg); } }
          .ai-star { animation: ai-star-pulse 2.4s ease-in-out infinite; transform-origin: center; }
        `}</style>
        <path
          className="ai-star"
          d="M12 2l2.09 6.26L20.18 10l-6.09 1.74L12 18l-2.09-6.26L3.82 10l6.09-1.74L12 2z"
          fill="#FFB800"
        />
        <path
          className="ai-star"
          d="M19 14l1.05 3.15L23 18.2l-2.95.85L19 22.2l-1.05-3.15L15 18.2l2.95-.85L19 14z"
          fill="#FFB800"
          opacity=".6"
          style={{ animationDelay: "0.6s" }}
        />
        <path
          className="ai-star"
          d="M5 14l.7 2.1L8 16.8l-2.3.7L5 19.6l-.7-2.1L2 16.8l2.3-.7L5 14z"
          fill="#FFB800"
          opacity=".4"
          style={{ animationDelay: "1.2s" }}
        />
      </svg>
      <span
        key={phraseIdx}
        className="font-mono text-xs text-gray-400 tracking-wide"
        style={{ animation: "ai-star-pulse 3s ease-in-out infinite" }}
      >
        {THINKING_PHRASES[phraseIdx]}
      </span>
    </div>
  );
}

interface MetricCard {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

const METRIC_KEYS: { key: string; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "entry", label: "Entry", icon: <DollarSign className="w-3.5 h-3.5" />, color: "#FFB800" },
  { key: "max risk", label: "Max Risk", icon: <Shield className="w-3.5 h-3.5" />, color: "#f23645" },
  { key: "max reward", label: "Max Reward", icon: <TrendingUp className="w-3.5 h-3.5" />, color: "#00d166" },
  { key: "r/r ratio", label: "R/R Ratio", icon: <Scale className="w-3.5 h-3.5" />, color: "#FF6B2B" },
];

function extractMetrics(md: string): { cards: MetricCard[]; cleaned: string } {
  const cards: MetricCard[] = [];
  let cleaned = md;

  for (const mk of METRIC_KEYS) {
    const re = new RegExp(
      `\\*\\*${mk.key}:?\\*\\*:?\\s*([^|*\\n]+)`,
      "i"
    );
    const m = cleaned.match(re);
    if (m) {
      cards.push({ label: mk.label, value: m[1].trim().replace(/\s*\|?\s*$/, ""), icon: mk.icon, color: mk.color });
      cleaned = cleaned.replace(m[0], "");
    }
  }

  cleaned = cleaned.replace(/\|\s*\|/g, "").replace(/^\s*\|\s*$/gm, "").replace(/\n{3,}/g, "\n\n");
  return { cards, cleaned };
}

function MetricCards({ cards }: { cards: MetricCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 my-4">
      {cards.map(c => (
        <div
          key={c.label}
          className="rounded-lg border border-card-border p-3 flex flex-col gap-1"
          style={{ background: "#111113" }}
        >
          <div className="flex items-center gap-1.5">
            <span style={{ color: c.color }}>{c.icon}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">{c.label}</span>
          </div>
          <span className="font-mono text-sm font-bold text-white">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

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

function StrategistResult({ content }: { content: string }) {
  const sections = useMemo(() => {
    const blocks = content.split(/(?=(?:🎯|🟢|⚪|💰|🔵|🟡|🔴)\s*\d+DTE\b)/);
    return blocks.map(block => {
      const { cards, cleaned } = extractMetrics(block);
      return { cards, cleaned };
    });
  }, [content]);

  return (
    <div>
      {sections.map((sec, i) => {
        const legsMatch = sec.cleaned.match(/(.*?(?:Legs:.*?)(?:\n|$)(?:.*?(?:Buy|Sell).*?(?:\n|$))*)(.*)/s);
        if (sec.cards.length > 0 && legsMatch) {
          const beforeRationale = legsMatch[1];
          const afterRationale = legsMatch[2];
          return (
            <div key={i}>
              <MarkdownResult content={beforeRationale} />
              <MetricCards cards={sec.cards} />
              <MarkdownResult content={afterRationale} />
            </div>
          );
        }
        return (
          <div key={i}>
            {sec.cards.length > 0 && <MetricCards cards={sec.cards} />}
            <MarkdownResult content={sec.cleaned} />
          </div>
        );
      })}
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
    { symbol, accessToken: accessToken || "", contractType: "ALL", daysToExpiration: 45, strikeCount: 20 },
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
          `${API_BASE}/market/options?symbol=${encodeURIComponent(symbol)}&accessToken=${encodeURIComponent(accessToken)}&contractType=ALL&daysToExpiration=45&strikeCount=20`
        );
        if (!chainRes.ok) {
          const errText = await chainRes.text().catch(() => "Unknown error");
          setStrategistResult(`**Error fetching options chain:** ${errText}`);
          return;
        }
        chainData = await chainRes.json();
        if (chainData?.error) {
          setStrategistResult(`**Options chain error:** ${chainData.error}${chainData.message ? ` — ${chainData.message}` : ""}`);
          return;
        }
      }

      const calls = chainData?.calls as unknown[] | undefined;
      const puts = chainData?.puts as unknown[] | undefined;
      if (!calls?.length && !puts?.length) {
        setStrategistResult("**No option chain data available.** The chain returned empty — this can happen outside market hours or if the token has expired. Please re-authenticate and try again.");
        return;
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
    <div className="flex flex-col gap-0 max-w-5xl mx-auto pb-6">

      <div
        className="sticky top-[76px] z-20 flex gap-2 py-2 -mx-3 px-3 sm:-mx-4 sm:px-4 lg:-mx-5 lg:px-5"
        style={{ background: "#151517" }}
      >
        <Button
          onClick={handleRunTA}
          disabled={isPendingAny || !accessToken || !quote}
          className="flex-1 font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90 h-9"
        >
          <Activity className="w-3.5 h-3.5 mr-2 shrink-0" />
          TECHNICAL ANALYSIS
        </Button>
        <Button
          onClick={handleRunStrategist}
          disabled={isPendingAny || !accessToken || !quote}
          variant="outline"
          className="flex-1 font-mono text-xs border-primary/50 text-primary hover:bg-primary/10 h-9"
        >
          {chainLoading ? (
            <><span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />LOADING CHAIN...</>
          ) : (
            <><BarChart2 className="w-3.5 h-3.5 mr-2 shrink-0" />OPTIONS STRATEGIST</>
          )}
        </Button>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden mt-3">
        <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <span className="font-mono text-xs font-bold text-foreground">DEEP ANALYSIS — {symbol}</span>
        </div>
        <div className="p-4 bg-[#0c0c0c]">
          <Textarea
            placeholder="Add specific instructions (optional)... e.g. 'Focus on the MACD divergence and key gamma levels'"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            className="font-mono text-xs bg-background border-card-border focus-visible:ring-primary/50 min-h-[60px] resize-none"
          />
        </div>

        {(activeResult === "analysis" || activeResult === "strategist") && (
          <div className="border-t border-card-border p-4 bg-[#0c0c0c]">
            {isPendingAnalysis || isStrategizing ? (
              <AiThinking />
            ) : currentResult ? (
              activeResult === "strategist"
                ? <StrategistResult content={currentResult} />
                : <MarkdownResult content={currentResult} />
            ) : null}
          </div>
        )}
      </div>

    </div>
  );
}
