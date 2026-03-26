import { useState, useRef, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
  useRunTechnicalAnalysis,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, BarChart2, Send, Trash2,
  TerminalSquare, User,
  Target, TrendingUp
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

function getChipsForSymbol(symbol: string): string[] {
  return [
    `Analyze the recent price action on ${symbol}`,
    `What are the key technical levels for ${symbol}?`,
    `Generate a high-confidence options strategy for ${symbol}`,
    `What's the sentiment and risk profile for ${symbol}?`,
    `Identify potential catalysts for ${symbol} this week`,
  ];
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

export function AiIntelligenceTab() {
  const {
    symbol, accessToken,
    aiModel, aiTemp,
    chatHistory, addChatMessage, clearChat,
    analysisResult, setAnalysisResult,
    strategistResult, setStrategistResult,
  } = useTerminalStore();

  const [customPrompt, setCustomPrompt] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [activeResult, setActiveResult] = useState<"analysis" | "strategist" | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, activeResult]);

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
    if (!quote) return;
    setStrategistResult(null);
    setActiveResult("strategist");
    setChainEnabled(true);

    // Wait for chain if not loaded
    const chainData = chain ?? null;

    setIsStrategizing(true);
    try {
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
      const data = await res.json() as { response?: string };
      setStrategistResult(data.response ?? "No response received.");
    } catch (err) {
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsStrategizing(false);
    }
  };


  const handleChipClick = (chip: string) => {
    setChatInput(chip);
  };

  const handleSend = () => {
    if (!chatInput.trim() || !accessToken) return;
    const userMessage = chatInput.trim();
    setChatInput("");
    addChatMessage({ role: "user", content: userMessage });

    const marketContext = quote
      ? `CURRENT MARKET CONTEXT for ${symbol}:\nLast: $${quote.last}\nChange: ${quote.changePct}%\nVol: ${quote.volume}\nRange: ${quote.low}-${quote.high}`
      : `No live market context available for ${symbol}.`;

    setIsChatLoading(true);
    fetch(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: userMessage, marketContext, model: aiModel, temperature: aiTemp }),
    })
      .then(r => r.json())
      .then((data: { response?: string }) => {
        addChatMessage({ role: "assistant", content: data.response ?? "No response." });
      })
      .catch(err => {
        addChatMessage({ role: "assistant", content: `**ERROR:** ${err.message}` });
      })
      .finally(() => setIsChatLoading(false));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
        <div className="p-4 space-y-3 bg-[#0D1117]">
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
          <div className="border-t border-card-border p-4 bg-[#0D1117]">
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

      {/* ── AI CHAT ── */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden flex flex-col min-h-[420px]">
        {/* Chat header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-card-border bg-[#0D1117]">
          <div className="flex items-center gap-2 text-primary font-mono font-bold text-xs">
            <TerminalSquare className="w-4 h-4" />
            AI TRADING ASSISTANT — {symbol}
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={clearChat}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 font-mono text-[10px] h-7"
          >
            <Trash2 className="w-3 h-3 mr-1.5" /> CLEAR
          </Button>
        </div>

        {/* Chat history */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.length === 0 && (
            <div className="py-8 flex flex-col items-center justify-center text-muted-foreground opacity-40 font-mono text-xs text-center">
              <TerminalSquare className="w-8 h-8 mb-3" />
              READY — ASK ANYTHING ABOUT {symbol}
            </div>
          )}
          {chatHistory.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`flex items-center gap-1.5 mb-1 px-1 font-mono text-[9px] uppercase tracking-wider
                ${msg.role === "user" ? "text-[#58A6FF]" : "text-primary"}`}>
                {msg.role === "user" ? <User className="w-2.5 h-2.5" /> : <TerminalSquare className="w-2.5 h-2.5" />}
                {msg.role === "user" ? "YOU" : "AI ANALYST"}
              </div>
              <div className={`max-w-[90%] rounded-xl p-3 shadow-sm
                ${msg.role === "user"
                  ? "bg-[#1F6FEB]/10 border border-[#1F6FEB]/30 text-gray-200"
                  : "bg-primary/5 border border-primary/20 text-gray-300"}`}
              >
                <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:text-xs
                  prose-code:text-primary prose-a:text-primary">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          {/* Typing indicator */}
          {isChatLoading && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5 mb-1 px-1 font-mono text-[9px] uppercase tracking-wider text-primary">
                <TerminalSquare className="w-2.5 h-2.5" /> AI ANALYST
              </div>
              <div className="rounded-xl p-3 bg-primary/5 border border-primary/20 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="font-mono text-[10px] text-primary animate-pulse">PROCESSING...</span>
              </div>
            </div>
          )}
        </div>

        {/* Prompt chips */}
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {getChipsForSymbol(symbol).map(chip => (
            <button
              key={chip}
              onClick={() => handleChipClick(chip)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20
                text-primary font-mono text-[9px] hover:bg-primary/20 transition-colors"
            >
              <TrendingUp className="w-2.5 h-2.5" />
              {chip}
            </button>
          ))}
        </div>

        {/* Chat input */}
        <div className="p-4 border-t border-card-border bg-[#0D1117]">
          <div className="relative">
            <Textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${symbol} technicals, options, risk... (Enter to send)`}
              className="min-h-[72px] pr-12 bg-background border-card-border font-mono text-xs resize-none focus-visible:ring-primary/50"
            />
            <Button
              onClick={handleSend}
              disabled={!chatInput.trim() || !accessToken}
              size="icon"
              className="absolute bottom-2 right-2 h-8 w-8 bg-primary hover:bg-primary/80 text-background rounded-full"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
          {!accessToken && (
            <p className="text-[10px] text-destructive font-mono mt-1.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" />
              Connect Schwab to enable AI Intelligence
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
