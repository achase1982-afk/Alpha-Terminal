import { useState, useMemo, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, BarChart2, Target, DollarSign, Shield, TrendingUp, Scale,
  Zap, ChevronDown, AlertTriangle, Crosshair,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

const THINKING_PHRASES = [
  "Initializing secure connection...",
  "Processing market data feed...",
  "Scanning options chain...",
  "Computing implied volatility surface...",
  "Mapping gamma exposure by strike...",
  "Evaluating put/call skew...",
  "Calculating spread risk profiles...",
  "Running Monte Carlo probability engine...",
  "Analyzing multi-leg structures...",
  "Identifying high-conviction setups...",
  "Building risk-reward models...",
  "Optimizing position sizing...",
  "Compiling strategy output...",
];

const AI_THINKING_STYLES = `
@keyframes ai-sparkle {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}
@keyframes ai-breathe {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
@keyframes ai-fade-swap {
  0% { opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { opacity: 0; }
}
`;

function AiThinking() {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    if (phraseIdx >= THINKING_PHRASES.length - 1) return;
    const t = setTimeout(() => setPhraseIdx(i => i + 1), 3000);
    return () => clearTimeout(t);
  }, [phraseIdx]);

  return (
    <div className="flex items-center gap-3 py-8 justify-center" style={{ minHeight: 72 }}>
      <style>{AI_THINKING_STYLES}</style>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path
          d="M12 2l2.09 6.26L20.18 10l-6.09 1.74L12 18l-2.09-6.26L3.82 10l6.09-1.74L12 2z"
          fill="#FFB800"
          style={{ animation: "ai-sparkle 2.4s ease-in-out infinite", transformOrigin: "center" }}
        />
        <path
          d="M19 14l1.05 3.15L23 18.2l-2.95.85L19 22.2l-1.05-3.15L15 18.2l2.95-.85L19 14z"
          fill="#FFB800"
          opacity=".6"
          style={{ animation: "ai-sparkle 2.4s ease-in-out infinite 0.6s", transformOrigin: "center" }}
        />
        <path
          d="M5 14l.7 2.1L8 16.8l-2.3.7L5 19.6l-.7-2.1L2 16.8l2.3-.7L5 14z"
          fill="#FFB800"
          opacity=".4"
          style={{ animation: "ai-sparkle 2.4s ease-in-out infinite 1.2s", transformOrigin: "center" }}
        />
      </svg>
      <div style={{ width: 300, height: 18, position: "relative" }}>
        <span
          key={phraseIdx}
          className="font-mono text-xs text-gray-400 tracking-wide absolute inset-0 flex items-center"
          style={{ animation: "ai-fade-swap 3s ease-in-out forwards, ai-breathe 3s ease-in-out infinite" }}
        >
          {THINKING_PHRASES[phraseIdx]}
        </span>
      </div>
    </div>
  );
}

interface StrategyJSON {
  strategyName: string;
  targetEntryTrigger: string;
  entryCostCredit: string;
  maxRisk: string;
  maxReward: string;
  rrRatio: string;
  pop: string;
  breakevens: string;
  positionSize: string;
  exitRules: string;
  rationale: string;
}

function extractJSONArray(raw: string): { json: string; endIdx: number } | null {
  const start = raw.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    if (ch === "]") { depth--; if (depth === 0) return { json: raw.slice(start, i + 1), endIdx: i + 1 }; }
  }
  return null;
}

function parseStrategistJSON(raw: string): { strategies: StrategyJSON[]; extraText: string } | null {
  const extracted = extractJSONArray(raw);
  if (!extracted) return null;

  try {
    const parsed = JSON.parse(extracted.json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed[0].strategyName) return null;
    const after = raw.slice(extracted.endIdx).trim();
    return { strategies: parsed as StrategyJSON[], extraText: after };
  } catch {
    return null;
  }
}

function StrategyCard({ s, idx }: { s: StrategyJSON; idx: number }) {
  const metrics = [
    { label: "Entry / Credit", value: s.entryCostCredit, icon: <DollarSign className="w-3.5 h-3.5" />, color: "#FFB800" },
    { label: "Max Risk", value: s.maxRisk, icon: <Shield className="w-3.5 h-3.5" />, color: "#f23645" },
    { label: "Max Reward", value: s.maxReward, icon: <TrendingUp className="w-3.5 h-3.5" />, color: "#00d166" },
    { label: "R/R Ratio", value: s.rrRatio, icon: <Scale className="w-3.5 h-3.5" />, color: "#FF6B2B" },
  ];

  return (
    <div className="rounded-xl border border-card-border overflow-hidden" style={{ background: "#111113" }}>
      <div className="px-4 py-3 border-b border-card-border flex items-center gap-2" style={{ background: "#151517" }}>
        <span className="font-mono text-xs font-bold text-primary">#{idx + 1}</span>
        <span className="font-mono text-sm font-bold text-white">{s.strategyName}</span>
      </div>

      {s.targetEntryTrigger && (
        <div className="mx-4 mt-3 rounded-lg px-3 py-2 border flex items-start gap-2" style={{ background: "rgba(0,180,150,0.08)", borderColor: "rgba(0,180,150,0.3)" }}>
          <Crosshair className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#00b496" }} />
          <span className="font-mono text-xs" style={{ color: "#00b496" }}>{s.targetEntryTrigger}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 p-4">
        {metrics.map(m => (
          <div key={m.label} className="rounded-lg border border-card-border p-3 flex flex-col gap-1" style={{ background: "#0c0c0c" }}>
            <div className="flex items-center gap-1.5">
              <span style={{ color: m.color }}>{m.icon}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">{m.label}</span>
            </div>
            <span className="font-mono text-sm font-bold text-white">{m.value}</span>
          </div>
        ))}
      </div>

      <div className="px-4 pb-3 space-y-2">
        {s.pop && (
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">PoP</span>
            <span className="text-white font-bold">{s.pop}</span>
          </div>
        )}
        {s.breakevens && (
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">Breakevens</span>
            <span className="text-white">{s.breakevens}</span>
          </div>
        )}
        {s.positionSize && (
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">Size</span>
            <span className="text-white">{s.positionSize}</span>
          </div>
        )}
        {s.exitRules && (
          <div className="flex items-start gap-2 text-xs font-mono text-gray-400 mt-1">
            <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">Exit Rules</span>
            <span className="text-white">{s.exitRules}</span>
          </div>
        )}
      </div>

      {s.rationale && (
        <div className="px-4 py-3 border-t border-card-border text-xs text-gray-400 font-sans leading-relaxed">
          {s.rationale}
        </div>
      )}
    </div>
  );
}

function StrategistResultView({ content }: { content: string }) {
  const parsed = useMemo(() => parseStrategistJSON(content), [content]);

  if (!parsed) {
    return <MarkdownResult content={content} />;
  }

  return (
    <div className="space-y-4">
      {parsed.strategies.map((s, i) => (
        <StrategyCard key={i} s={s} idx={i} />
      ))}
      {parsed.extraText && (
        <div className="border-t border-card-border pt-4">
          <MarkdownResult content={parsed.extraText} />
        </div>
      )}
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

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
      style={{
        background: checked ? "#FFB800" : "#2A2A2C",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200"
        style={{ transform: checked ? "translateX(16px) translateY(2px)" : "translateX(2px) translateY(2px)" }}
      />
    </button>
  );
}

function SegmentControl({ value, options, onChange, disabled }: {
  value: string; options: { label: string; value: string }[]; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-card-border">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => !disabled && onChange(o.value)}
          className="flex-1 font-mono text-[10px] py-1.5 px-2 transition-colors"
          style={{
            background: value === o.value ? "#FFB800" : "transparent",
            color: value === o.value ? "#0c0c0c" : "#9ca3af",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StrategySettings() {
  const {
    stratAutopilot, setStratAutopilot,
    stratMaxRisk, setStratMaxRisk,
    stratMinPoP, setStratMinPoP,
    stratMinRR, setStratMinRR,
    stratBias, setStratBias,
    stratPremium, setStratPremium,
    stratAvoidEarnings, setStratAvoidEarnings,
  } = useTerminalStore();

  const locked = stratAutopilot;

  return (
    <div className="rounded-xl border border-card-border overflow-hidden" style={{ background: "#111113" }}>
      <div className="px-4 py-2.5 border-b border-card-border flex items-center justify-between" style={{ background: "#151517" }}>
        <span className="font-mono text-[11px] font-bold text-gray-400 uppercase tracking-wider">Strategy Settings</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span className="font-mono text-xs text-white font-bold">AI Autopilot</span>
          </div>
          <ToggleSwitch checked={stratAutopilot} onChange={setStratAutopilot} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Max Risk Per Trade</span>
            <span className="font-mono text-xs text-white font-bold">${stratMaxRisk.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={50}
            max={10000}
            step={50}
            value={stratMaxRisk}
            onChange={e => setStratMaxRisk(Number(e.target.value))}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: "#FFB800", background: "#2A2A2C" }}
          />
          <div className="flex justify-between mt-0.5">
            <span className="font-mono text-[9px] text-gray-600">$50</span>
            <span className="font-mono text-[9px] text-gray-600">$10,000</span>
          </div>
        </div>

        <div style={{ opacity: locked ? 0.35 : 1 }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Min Probability of Profit</span>
            <span className="font-mono text-xs text-white font-bold">{stratMinPoP}%</span>
          </div>
          <input
            type="range"
            min={60}
            max={95}
            step={1}
            value={stratMinPoP}
            onChange={e => !locked && setStratMinPoP(Number(e.target.value))}
            disabled={locked}
            className="w-full h-1 rounded-full appearance-none"
            style={{ accentColor: "#00d166", background: "#2A2A2C", cursor: locked ? "not-allowed" : "pointer" }}
          />
          <div className="flex justify-between mt-0.5">
            <span className="font-mono text-[9px] text-gray-600">60%</span>
            <span className="font-mono text-[9px] text-gray-600">95%</span>
          </div>
        </div>

        <div className="flex items-center justify-between" style={{ opacity: locked ? 0.35 : 1 }}>
          <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Min R/R Ratio</span>
          <div className="relative">
            <select
              value={stratMinRR}
              onChange={e => !locked && setStratMinRR(e.target.value)}
              disabled={locked}
              className="font-mono text-xs text-white bg-transparent border border-card-border rounded-md px-2 py-1 pr-6 appearance-none"
              style={{ cursor: locked ? "not-allowed" : "pointer" }}
            >
              <option value="1:1">1:1</option>
              <option value="1:2">1:2</option>
              <option value="1:3">1:3</option>
            </select>
            <ChevronDown className="w-3 h-3 text-gray-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div style={{ opacity: locked ? 0.35 : 1 }}>
          <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider block mb-1.5">Directional Bias</span>
          <SegmentControl
            value={stratBias}
            options={[
              { label: "Auto", value: "auto" },
              { label: "Bull", value: "bullish" },
              { label: "Bear", value: "bearish" },
              { label: "Neutral", value: "neutral" },
            ]}
            onChange={v => setStratBias(v as typeof stratBias)}
            disabled={locked}
          />
        </div>

        <div style={{ opacity: locked ? 0.35 : 1 }}>
          <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider block mb-1.5">Premium Type</span>
          <SegmentControl
            value={stratPremium}
            options={[
              { label: "Any", value: "any" },
              { label: "Net Credit", value: "credit" },
              { label: "Net Debit", value: "debit" },
            ]}
            onChange={v => setStratPremium(v as typeof stratPremium)}
            disabled={locked}
          />
        </div>

        <div className="flex items-center justify-between" style={{ opacity: locked ? 0.35 : 1 }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
            <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Avoid Earnings / Catalyst</span>
          </div>
          <ToggleSwitch checked={stratAvoidEarnings} onChange={setStratAvoidEarnings} disabled={locked} />
        </div>
      </div>
    </div>
  );
}

const CHUNK_DELAY_MS = 30;

async function consumeStream(
  url: string,
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    onError(errText);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) { onError("No readable stream."); return; }

  const decoder = new TextDecoder();
  let buf = "";

  const delay = () => new Promise<void>(r => setTimeout(r, CHUNK_DELAY_MS));

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") { onDone(); return; }
      try {
        const parsed = JSON.parse(payload) as { text?: string; error?: string };
        if (parsed.error) { onError(parsed.error); return; }
        if (parsed.text) {
          onChunk(parsed.text);
          await delay();
        }
      } catch {}
    }
  }
  onDone();
}

export function AiIntelligenceTab() {
  const {
    symbol, accessToken,
    aiModel, aiTemp,
    analysisResult, setAnalysisResult,
    strategistResult, setStrategistResult,
    stratAutopilot, stratMaxRisk, stratMinPoP, stratMinRR,
    stratBias, stratPremium, stratAvoidEarnings,
  } = useTerminalStore();

  const [customPrompt, setCustomPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [activeResult, setActiveResult] = useState<"analysis" | "strategist" | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showSettings, setShowSettings] = useState(false);

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

  const handleRunTA = useCallback(async () => {
    if (!quote || !history?.candles) return;
    setAnalysisResult(null);
    setStreamingText("");
    setActiveResult("analysis");
    setIsStreaming(true);

    let accumulated = "";
    await consumeStream(
      `${API_BASE}/ai/technical-analysis/stream`,
      { quote, candles: history.candles, model: aiModel, temperature: aiTemp, customPrompt },
      (chunk) => {
        accumulated += chunk;
        setStreamingText(accumulated);
      },
      () => {
        setAnalysisResult(accumulated);
        setStreamingText("");
        setIsStreaming(false);
      },
      (err) => {
        setAnalysisResult(`**Analysis failed:** ${err}`);
        setStreamingText("");
        setIsStreaming(false);
      },
    );
  }, [quote, history, aiModel, aiTemp, customPrompt, setAnalysisResult]);

  const handleRunStrategist = useCallback(async () => {
    if (!quote || !accessToken) return;
    setStrategistResult(null);
    setStreamingText("");
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
          setIsStrategizing(false);
          return;
        }
        chainData = await chainRes.json();
        if (chainData?.error) {
          setStrategistResult(`**Options chain error:** ${chainData.error}${chainData.message ? ` — ${chainData.message}` : ""}`);
          setIsStrategizing(false);
          return;
        }
      }

      const calls = chainData?.calls as unknown[] | undefined;
      const puts = chainData?.puts as unknown[] | undefined;
      if (!calls?.length && !puts?.length) {
        setStrategistResult("**No option chain data available.** The chain returned empty — this can happen outside market hours or if the token has expired. Please re-authenticate and try again.");
        setIsStrategizing(false);
        return;
      }

      setIsStrategizing(false);
      setIsStreaming(true);

      let accumulated = "";
      await consumeStream(
        `${API_BASE}/ai/options-strategist/stream`,
        {
          quote,
          candles: history?.candles ?? [],
          chain: chainData,
          model: aiModel,
          temperature: aiTemp,
          settings: {
            autopilot: stratAutopilot,
            maxRisk: stratMaxRisk,
            minPoP: stratMinPoP,
            minRR: stratMinRR,
            bias: stratBias,
            premium: stratPremium,
            avoidEarnings: stratAvoidEarnings,
          },
        },
        (chunk) => {
          accumulated += chunk;
          setStreamingText(accumulated);
        },
        () => {
          setStrategistResult(accumulated);
          setStreamingText("");
          setIsStreaming(false);
        },
        (err) => {
          setStrategistResult(`**Strategist failed:** ${err}`);
          setStreamingText("");
          setIsStreaming(false);
        },
      );
    } catch (err) {
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
      setIsStrategizing(false);
      setIsStreaming(false);
    }
  }, [quote, accessToken, chain, history, symbol, aiModel, aiTemp, setStrategistResult,
      stratAutopilot, stratMaxRisk, stratMinPoP, stratMinRR, stratBias, stratPremium, stratAvoidEarnings]);


  const isPendingAny = isStreaming || isStrategizing;

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

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="w-full flex items-center justify-between px-4 py-2 rounded-t-xl border border-card-border font-mono text-[11px] text-gray-400 uppercase tracking-wider hover:text-white transition-colors"
          style={{ background: "#111113" }}
        >
          <span className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-primary" />
            Strategy Settings
            {stratAutopilot && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(255,184,0,0.15)", color: "#FFB800" }}>AUTOPILOT</span>}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSettings ? "rotate-180" : ""}`} />
        </button>
        {showSettings && <StrategySettings />}
      </div>

      <div className={`bg-card border border-card-border overflow-hidden ${showSettings ? "rounded-b-xl" : "rounded-xl mt-0 border-t-0"}`}>
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
            {isStrategizing ? (
              <AiThinking />
            ) : activeResult === "strategist" && isStreaming ? (
              <AiThinking />
            ) : activeResult === "analysis" && isStreaming && streamingText ? (
              <MarkdownResult content={streamingText} />
            ) : activeResult === "analysis" && isStreaming && !streamingText ? (
              <AiThinking />
            ) : currentResult ? (
              activeResult === "strategist"
                ? <StrategistResultView content={currentResult} />
                : <MarkdownResult content={currentResult} />
            ) : null}
          </div>
        )}
      </div>

    </div>
  );
}
