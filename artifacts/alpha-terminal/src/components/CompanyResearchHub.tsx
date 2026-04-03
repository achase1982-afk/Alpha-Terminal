import { useState, useEffect, useCallback, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { consumeStream } from "@/lib/consumeStream";
import { useTechnicalsCache } from "@/hooks/useTechnicalsCache";
import { AiThinkingFeed } from "@/components/ai-shared/AiThinkingFeed";
import { Button } from "@/components/ui/button";
import { Loader2, Activity } from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  useGetQuote, useGetPriceHistory,
} from "@workspace/api-client-react";

const API_BASE = "/api";

interface FundamentalData {
  symbol: string;
  marketCap: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  eps: number | null;
  beta: number | null;
  dividendYield: number | null;
  high52: number | null;
  low52: number | null;
  error?: string;
}

interface TechnicalSnapshot {
  trend: string | null;
  trendSignal: "bullish" | "neutral" | "bearish" | null;
  rsi: number | null;
  rsiLabel: string | null;
  resistance1: number | null;
  support1: number | null;
  resistance2: number | null;
  support2: number | null;
  shortTermOutlook: string | null;
  error?: string;
}

function fmtMarketCap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtShares(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtNum(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[8px] text-muted-foreground font-bold tracking-tighter">{label}</span>
      <span className="text-xs font-mono font-semibold text-white tabular-nums">{value}</span>
    </div>
  );
}

interface CompanyResearchHubProps {
  candles?: Array<{ datetime: string; open: number; high: number; low: number; close: number; volume: number }>;
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

export function CompanyResearchHub({ candles }: CompanyResearchHubProps) {
  const { symbol, accessToken, aiFeatureSettings, analysisResult, setAnalysisResult } = useTerminalStore();
  const aiModel = aiFeatureSettings.technicals.model;
  const aiTemp = aiFeatureSettings.technicals.temperature;
  const { data: quoteData } = useQuote(symbol);
  const { cachedData: technicalsCache, setCachedData: setTechnicalsCache } = useTechnicalsCache(symbol);

  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [technicals, setTechnicals] = useState<TechnicalSnapshot | null>(null);
  const [techLoading, setTechLoading] = useState(false);

  const [taStreaming, setTaStreaming] = useState(false);
  const [taStreamingText, setTaStreamingText] = useState("");
  const [taThinkingTokens, setTaThinkingTokens] = useState<string[]>([]);
  const [taShowResult, setTaShowResult] = useState(false);
  const taRunRef = useRef(0);
  const cacheRestoredRef = useRef(false);

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );
  const { data: history } = useGetPriceHistory(
    { symbol, accessToken: accessToken || "", periodType: "month", period: 3, frequencyType: "daily", frequency: 1 },
    { query: { enabled: !!accessToken } }
  );

  useEffect(() => {
    cacheRestoredRef.current = false;
    setTaShowResult(false);
    setTaStreamingText("");
    setTaThinkingTokens([]);
  }, [symbol]);

  useEffect(() => {
    if (cacheRestoredRef.current) return;
    cacheRestoredRef.current = true;
    if (technicalsCache) {
      setAnalysisResult(technicalsCache.analysisResult);
      setTaThinkingTokens(technicalsCache.thinkingTokens);
      setTaShowResult(true);
    }
  }, [symbol, technicalsCache]);

  const handleRunTA = useCallback(async () => {
    if (!quote || !history?.candles) return;
    const runId = ++taRunRef.current;
    setAnalysisResult(null);
    setTaStreamingText("");
    setTaThinkingTokens([]);
    setTaShowResult(true);
    setTaStreaming(true);

    let accumulated = "";
    const collectedThinking: string[] = [];
    await consumeStream(
      `${API_BASE}/ai/technical-analysis/stream`,
      { quote, candles: history.candles, model: aiModel, temperature: aiTemp },
      (chunk) => {
        if (taRunRef.current !== runId) return;
        accumulated += chunk;
        setTaStreamingText(accumulated);
      },
      () => {
        if (taRunRef.current !== runId) return;
        setAnalysisResult(accumulated);
        setTaStreamingText("");
        setTaStreaming(false);
        setTechnicalsCache({
          analysisResult: accumulated,
          thinkingTokens: collectedThinking,
          timestamp: Date.now(),
        });
      },
      (err) => {
        if (taRunRef.current !== runId) return;
        setAnalysisResult(`**Analysis failed:** ${err}`);
        setTaStreamingText("");
        setTaStreaming(false);
      },
      (reasoning) => {
        if (taRunRef.current !== runId) return;
        collectedThinking.push(reasoning);
        setTaThinkingTokens((prev) => [...prev, reasoning]);
      },
    );
  }, [quote, history, aiModel, aiTemp, setAnalysisResult, setTechnicalsCache]);

  const fetchFundamentals = useCallback(async () => {
    if (!accessToken || !symbol) return;
    setFundLoading(true);
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/market/fundamentals?symbol=${encodeURIComponent(symbol)}&accessToken=${encodeURIComponent(accessToken)}`
      );
      const data = await res.json();
      setFundamentals(data);
    } catch {
      setFundamentals({ symbol, marketCap: null, sharesOutstanding: null, peRatio: null, eps: null, beta: null, dividendYield: null, high52: null, low52: null, error: "Failed to load" });
    } finally {
      setFundLoading(false);
    }
  }, [symbol, accessToken]);

  const [techFetchedFor, setTechFetchedFor] = useState<string | null>(null);

  useEffect(() => {
    fetchFundamentals();
  }, [fetchFundamentals]);

  useEffect(() => {
    if (!symbol || !quoteData || techFetchedFor === symbol) return;
    let cancelled = false;

    (async () => {
      setTechLoading(true);
      setTechFetchedFor(symbol);
      try {
        const quote = {
          symbol: quoteData.symbol,
          last: quoteData.last,
          bid: quoteData.bid,
          ask: quoteData.ask,
          change: quoteData.change,
          changePct: quoteData.changePct,
          volume: quoteData.volume,
          high: quoteData.high,
          low: quoteData.low,
          fiftyTwoWeekHigh: quoteData.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quoteData.fiftyTwoWeekLow,
          peRatio: quoteData.peRatio,
        };
        const res = await fetchWithAuth(`${API_BASE}/ai/technical-snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quote, candles: candles ?? [] }),
        });
        if (cancelled) return;
        const data = await res.json();
        setTechnicals(data);
      } catch {
        if (!cancelled) {
          setTechnicals({ trend: null, trendSignal: null, rsi: null, rsiLabel: null, resistance1: null, support1: null, resistance2: null, support2: null, shortTermOutlook: null, error: "Failed to load" });
        }
      } finally {
        if (!cancelled) setTechLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [symbol, quoteData]);

  const currentPrice = quoteData?.last;
  const high52 = fundamentals?.high52 ?? quoteData?.fiftyTwoWeekHigh;
  const low52 = fundamentals?.low52 ?? quoteData?.fiftyTwoWeekLow;

  const rangePosition = (() => {
    if (currentPrice == null || high52 == null || low52 == null || high52 === low52) return 50;
    return Math.max(0, Math.min(100, ((currentPrice - low52) / (high52 - low52)) * 100));
  })();

  const trendBorderColor = technicals?.trendSignal === "bullish"
    ? "border-terminal-success/30"
    : technicals?.trendSignal === "bearish"
      ? "border-terminal-danger/30"
      : "border-card-border";

  const trendTextColor = technicals?.trendSignal === "bullish"
    ? "text-terminal-success"
    : technicals?.trendSignal === "bearish"
      ? "text-terminal-danger"
      : "text-white";

  if (!accessToken) {
    return (
      <div className="p-6 text-center">
        <p className="font-mono text-xs text-muted-foreground tracking-widest">
          Connect brokerage for company data
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 animate-in fade-in duration-500">
      <section>
        <h3 className="text-primary text-[10px] font-black tracking-widest mb-3">FUNDAMENTALS</h3>
        {fundLoading ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : fundamentals?.error ? (
          <p className="text-xs text-terminal-danger font-mono">{fundamentals.error}</p>
        ) : (
          <div className="grid grid-cols-3 gap-y-4 gap-x-2 bg-card/30 p-3 rounded-lg border border-card-border">
            <DataPoint label="MKT CAP" value={fmtMarketCap(fundamentals?.marketCap ?? null)} />
            <DataPoint label="SHARES" value={fmtShares(fundamentals?.sharesOutstanding ?? null)} />
            <DataPoint label="P/E RATIO" value={fmtNum(fundamentals?.peRatio ?? quoteData?.peRatio ?? null)} />
            <DataPoint label="EPS (TTM)" value={fmtNum(fundamentals?.eps ?? null)} />
            <DataPoint label="BETA" value={fmtNum(fundamentals?.beta ?? null)} />
            <DataPoint label="DIV YIELD" value={fmtPct(fundamentals?.dividendYield ?? null)} />
          </div>
        )}

        {(high52 != null || low52 != null) && (
          <div className="mt-4 px-1">
            <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
              <span>52W LOW {low52 != null ? `$${low52.toFixed(2)}` : "—"}</span>
              {currentPrice != null && (
                <span className="text-primary">CURRENT ${currentPrice.toFixed(2)}</span>
              )}
              <span>52W HIGH {high52 != null ? `$${high52.toFixed(2)}` : "—"}</span>
            </div>
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden relative">
              <div className="absolute h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 w-full opacity-30" />
              <div
                className="absolute h-full w-1 bg-white shadow-[0_0_8px_white]"
                style={{ left: `${rangePosition}%` }}
              />
            </div>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-primary text-[10px] font-black tracking-widest mb-3">TECHNICAL ANALYSIS</h3>
        {techLoading ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : technicals?.error ? (
          <p className="text-xs text-terminal-danger font-mono">{technicals.error}</p>
        ) : technicals ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className={`bg-[#1a1a1a] p-3 rounded border ${trendBorderColor}`}>
                <span className="text-[9px] text-muted-foreground block">TREND</span>
                <span className={`${trendTextColor} font-bold text-sm`}>
                  {technicals.trend ?? "—"}
                </span>
              </div>
              <div className="bg-[#1a1a1a] p-3 rounded border border-card-border">
                <span className="text-[9px] text-muted-foreground block">RSI (14)</span>
                <span className="text-white font-bold text-sm tabular-nums">
                  {technicals.rsi != null ? `${technicals.rsi.toFixed(1)}` : "—"}
                  {technicals.rsiLabel && (
                    <span className="text-muted-foreground text-xs ml-1">({technicals.rsiLabel})</span>
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {technicals.resistance1 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-danger">
                  <span className="text-[10px] font-bold">RESISTANCE 1</span>
                  <span className="font-mono text-xs tabular-nums">${technicals.resistance1.toFixed(2)}</span>
                </div>
              )}
              {technicals.resistance2 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-danger/50">
                  <span className="text-[10px] font-bold text-muted-foreground">RESISTANCE 2</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">${technicals.resistance2.toFixed(2)}</span>
                </div>
              )}
              {technicals.support1 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-success">
                  <span className="text-[10px] font-bold">SUPPORT 1</span>
                  <span className="font-mono text-xs tabular-nums">${technicals.support1.toFixed(2)}</span>
                </div>
              )}
              {technicals.support2 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-success/50">
                  <span className="text-[10px] font-bold text-muted-foreground">SUPPORT 2</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">${technicals.support2.toFixed(2)}</span>
                </div>
              )}
            </div>

            {technicals.shortTermOutlook && (
              <div className="mt-3 p-3 bg-[#1a1a1a] rounded border border-card-border">
                <span className="text-[9px] text-muted-foreground block mb-1">SHORT-TERM OUTLOOK</span>
                <span className="text-xs text-white/90 leading-relaxed">{technicals.shortTermOutlook}</span>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground font-mono">No data available</p>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-3.5 h-3.5 text-[#FFB800]" />
          <h3 className="text-primary text-[10px] font-black tracking-widest">AI DEEP ANALYSIS</h3>
          <span className="font-mono text-[10px] text-[#71717a] ml-1">
            <span className="text-[#FFB800] font-bold">{symbol}</span>
          </span>
        </div>

        <Button
          onClick={handleRunTA}
          disabled={taStreaming || !accessToken || !quote}
          className="w-full font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90 h-9"
        >
          {taStreaming ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 shrink-0 animate-spin" />
          ) : (
            <Activity className="w-3.5 h-3.5 mr-2 shrink-0" />
          )}
          {taStreaming ? "ANALYZING..." : "RUN TECHNICAL ANALYSIS"}
        </Button>

        {taShowResult && (
          <div className="bg-card border border-card-border rounded-xl p-4 mt-3">
            {taStreaming ? (
              <>
                <AiThinkingFeed texts={taThinkingTokens} isStreaming={true} />
                {taStreamingText && (
                  <div className="mt-3">
                    <MarkdownResult content={taStreamingText} />
                  </div>
                )}
              </>
            ) : analysisResult ? (
              <>
                {taThinkingTokens.length > 0 && (
                  <div className="mb-3">
                    <AiThinkingFeed texts={taThinkingTokens} isStreaming={false} />
                  </div>
                )}
                <MarkdownResult content={analysisResult} />
              </>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
