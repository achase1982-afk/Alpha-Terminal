import { useState, useMemo, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
} from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, BarChart2, Target, DollarSign, Shield, TrendingUp, Scale,
  Zap, ChevronDown, AlertTriangle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MarketPulseDashboard } from "@/components/market-pulse/MarketPulseDashboard";
import { StrategistAuditPanel, type StrategistAuditData } from "@/components/market-pulse/StrategistAuditPanel";
import { AiSubTabs, type AiSubTab } from "@/components/ai-tab/AiSubTabs";
import { AiThinkingFeed } from "@/components/ai-shared/AiThinkingFeed";

const API_BASE = "/api";

interface LegPayload {
  strike: number;
  type: "CALL" | "PUT";
  action: "BUY" | "SELL";
  bid: number;
  ask: number;
  mark: number;
  delta: number;
  volume: number;
  openInterest: number;
}

interface ExitRules {
  profit_target_pct: number;
  profit_target_amount: number;
  stop_loss_pct: number;
  stop_loss_amount: number;
  time_exit: string;
}

interface StrategyPayload {
  strategy_type: string;
  expiration_date: string;
  days_to_expiration: number;
  short_leg: LegPayload;
  long_leg: LegPayload;
  short_leg_2?: LegPayload;
  long_leg_2?: LegPayload;
  net_credit: number;
  max_profit: number;
  max_loss: number;
  breakeven: number;
  breakeven_upper?: number;
  probability_of_profit_pct: number;
  risk_reward_ratio: string;
  size_recommendation: string;
  contracts: number;
  exit_rules: ExitRules;
}

function fmtDollar(v: number): string {
  return `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function LegRow({ leg, label }: { leg: LegPayload; label: string }) {
  const actionColor = leg.action === "SELL" ? "#f23645" : "#00d166";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#2A2A2C] last:border-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${actionColor}20`, color: actionColor }}>
          {leg.action}
        </span>
        <span className="font-mono text-[10px] text-[#a1a1aa] uppercase">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-white font-bold">{leg.strike} {leg.type}</span>
        <span className="font-mono text-[10px] text-[#71717a]">\u0394{leg.delta.toFixed(2)}</span>
        <span className="font-mono text-[10px] text-[#71717a]">{leg.bid}/{leg.ask}</span>
      </div>
    </div>
  );
}

function RealStrategyCard({ s, idx }: { s: StrategyPayload; idx: number }) {
  const isCredit = s.net_credit > 0;

  const metrics = [
    { label: isCredit ? "Net Credit" : "Net Debit", value: fmtDollar(s.net_credit), icon: <DollarSign className="w-3.5 h-3.5" />, color: "#FFB800" },
    { label: "Max Risk", value: fmtDollar(s.max_loss), icon: <Shield className="w-3.5 h-3.5" />, color: "#f23645" },
    { label: "Max Reward", value: fmtDollar(s.max_profit), icon: <TrendingUp className="w-3.5 h-3.5" />, color: "#00d166" },
    { label: "R/R Ratio", value: s.risk_reward_ratio, icon: <Scale className="w-3.5 h-3.5" />, color: "#FF6B2B" },
  ];

  return (
    <div className="rounded-xl border border-card-border overflow-hidden" style={{ background: "#111113" }}>
      <div className="px-4 py-3 border-b border-card-border flex items-center justify-between" style={{ background: "#151517" }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-primary">#{idx + 1}</span>
          <span className="font-mono text-sm font-bold text-white">{s.strategy_type}</span>
        </div>
        <span className="font-mono text-[10px] text-[#71717a]">{s.days_to_expiration}DTE</span>
      </div>

      <div className="mx-4 mt-3 rounded-lg border border-[#2A2A2C] overflow-hidden" style={{ background: "#0c0c0c" }}>
        <div className="px-3 py-1.5 border-b border-[#2A2A2C]">
          <span className="font-mono text-[9px] text-[#52525b] uppercase tracking-widest">Contract Legs — Exp {s.expiration_date}</span>
        </div>
        <div className="px-3">
          <LegRow leg={s.short_leg} label="Short" />
          <LegRow leg={s.long_leg} label={s.long_leg.action === "SELL" ? "Short 2" : "Long"} />
          {s.short_leg_2 && <LegRow leg={s.short_leg_2} label="Short Call" />}
          {s.long_leg_2 && <LegRow leg={s.long_leg_2} label="Long Call" />}
        </div>
      </div>

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
        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">PoP</span>
          <span className="text-white font-bold">{s.probability_of_profit_pct}%</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">Breakeven</span>
          <span className="text-white">{fmtDollar(s.breakeven)}{s.breakeven_upper ? ` / ${fmtDollar(s.breakeven_upper)}` : ""}</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">Size</span>
          <span className="text-white">{s.contracts} contract{s.contracts > 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-start gap-2 text-xs font-mono text-gray-400 mt-1">
          <span className="text-gray-500 uppercase tracking-wider w-20 shrink-0">Exit Rules</span>
          <span className="text-white">Take profit at {s.exit_rules.profit_target_pct}% ({fmtDollar(s.exit_rules.profit_target_amount)}); Stop at {fmtDollar(s.exit_rules.stop_loss_amount)}; {s.exit_rules.time_exit}</span>
        </div>
      </div>
    </div>
  );
}

function StrategistResultView({ strategies, narrative, isStreaming, streamingText }: {
  strategies: StrategyPayload[];
  narrative: string;
  isStreaming: boolean;
  streamingText: string;
}) {
  return (
    <div className="space-y-4">
      {strategies.map((s, i) => (
        <RealStrategyCard key={i} s={s} idx={i} />
      ))}
      {(narrative || streamingText) && (
        <div className="border-t border-card-border pt-4">
          <div className="font-mono text-[9px] text-[#52525b] uppercase tracking-widest mb-2">AI Thesis</div>
          <MarkdownResult content={isStreaming ? streamingText : narrative} />
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
  onReasoning?: (text: string) => void,
): Promise<void> {
  try {
    const res = await fetchWithAuth(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      console.error("[consumeStream] HTTP error:", res.status, errText);
      onError(`Server error (${res.status}). Please refresh the page and try again.`);
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
          const parsed = JSON.parse(payload) as { text?: string; reasoning?: string; error?: string };
          if (parsed.error) { onError(parsed.error); return; }
          if (parsed.reasoning) {
            onReasoning?.(parsed.reasoning);
            await delay();
          }
          if (parsed.text) {
            onChunk(parsed.text);
            await delay();
          }
        } catch {}
      }
    }
    onDone();
  } catch (err: any) {
    console.error("[consumeStream] Network error:", err);
    onError("Connection lost. Please try again.");
  }
}

interface AiIntelligenceTabProps {
  initialSubTab?: AiSubTab;
}

export function AiIntelligenceTab({ initialSubTab }: AiIntelligenceTabProps) {
  const {
    symbol, accessToken,
    aiModel, aiTemp,
    analysisResult, setAnalysisResult,
    strategistResult, setStrategistResult,
    stratAutopilot, stratMaxRisk, stratMinPoP, stratMinRR,
    stratBias, stratPremium, stratAvoidEarnings,
  } = useTerminalStore();

  const [subTab, setSubTab] = useState<AiSubTab>(initialSubTab ?? "pulse");
  const [customPrompt, setCustomPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [activeResult, setActiveResult] = useState<"analysis" | "strategist" | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [thinkingTokens, setThinkingTokens] = useState<string[]>([]);
  const [strategistAudit, setStrategistAudit] = useState<StrategistAuditData | null>(null);
  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab);
  }, [initialSubTab]);

  const handleSubTabChange = useCallback((tab: AiSubTab) => {
    setSubTab(tab);
    setThinkingTokens([]);
    setStreamingText("");
    setActiveResult(null);
  }, []);

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
    setThinkingTokens([]);
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
      (reasoning) => {
        setThinkingTokens((prev) => [...prev, reasoning]);
      },
    );
  }, [quote, history, aiModel, aiTemp, customPrompt, setAnalysisResult]);

  const [realStrategies, setRealStrategies] = useState<StrategyPayload[]>([]);
  const [narrativeText, setNarrativeText] = useState("");

  const handleRunStrategist = useCallback(async () => {
    if (!accessToken) return;
    setStrategistResult(null);
    setStrategistAudit(null);
    setStreamingText("");
    setThinkingTokens([]);
    setRealStrategies([]);
    setNarrativeText("");
    setActiveResult("strategist");
    setIsStrategizing(true);

    try {
      const res = await fetchWithAuth(`${API_BASE}/ai/options-strategist/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          accessToken,
          todayEdge: stratBias === "auto" ? undefined : stratBias === "bullish" ? "BULLISH_EDGE" : stratBias === "bearish" ? "BEARISH_EDGE" : "NEUTRAL_EDGE",
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        setStrategistResult(`**Error:** ${errText}`);
        setIsStrategizing(false);
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = await res.json() as { strategies?: StrategyPayload[]; narrative?: string; error?: string; edge?: string };
        if (json.error) {
          setStrategistResult(`**Error:** ${json.error}`);
        } else if (json.strategies && json.strategies.length > 0) {
          setRealStrategies(json.strategies);
          setNarrativeText(json.narrative ?? "");
          setStrategistResult("done");
        } else {
          setStrategistResult(json.narrative ?? "No strategies available.");
        }
        setIsStrategizing(false);
        return;
      }

      setIsStrategizing(false);
      setIsStreaming(true);

      const reader = res.body?.getReader();
      if (!reader) { setStrategistResult("**Error:** No readable stream."); setIsStreaming(false); return; }

      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload) as {
              strategies?: StrategyPayload[];
              edge?: string;
              underlyingPrice?: number;
              text?: string;
              reasoning?: string;
              error?: string;
            };
            if (parsed.error) {
              setStrategistResult(`**Error:** ${parsed.error}`);
              setIsStreaming(false);
              return;
            }
            if (parsed.strategies) {
              setRealStrategies(parsed.strategies);
              const q = quote as Record<string, unknown> | undefined;
              setStrategistAudit({
                symbol,
                price: parsed.underlyingPrice ?? null,
                change: q && typeof q.netChange === "number" ? q.netChange : null,
                changePct: q && typeof q.netPercentChange === "number" ? q.netPercentChange : null,
                volume: null,
                autopilot: stratAutopilot,
                maxRisk: stratMaxRisk,
                minPoP: 0,
                minRR: "—",
                bias: parsed.edge ?? "—",
                premium: "—",
                avoidEarnings: false,
                chainCallCount: 0,
                chainPutCount: 0,
                model: "gemini-2.5-flash",
                temperature: 0.2,
                timestamp: Date.now(),
              });
            }
            if (parsed.reasoning) {
              setThinkingTokens((prev) => [...prev, parsed.reasoning!]);
            }
            if (parsed.text) {
              accumulated += parsed.text;
              setStreamingText(accumulated);
            }
          } catch {}
        }
      }
      setNarrativeText(accumulated);
      setStrategistResult("done");
      setStreamingText("");
      setIsStreaming(false);
    } catch (err) {
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
      setIsStrategizing(false);
      setIsStreaming(false);
    }
  }, [quote, accessToken, symbol, setStrategistResult,
      stratAutopilot, stratMaxRisk, stratBias]);


  const isPendingAny = isStreaming || isStrategizing;

  const currentResult = activeResult === "analysis" ? analysisResult
    : activeResult === "strategist" ? strategistResult
    : null;

  const hasRealStrategies = realStrategies.length > 0;

  return (
    <div className="flex flex-col gap-0 w-full max-w-5xl mx-auto pb-6 flex-1" style={{ minHeight: "calc(var(--vvh, 100vh) - 200px)" }}>
      <AiSubTabs active={subTab} onChange={handleSubTabChange} />

      {subTab === "pulse" && (
        <MarketPulseDashboard autoGenerate={initialSubTab === "pulse"} />
      )}

      {subTab === "strategist" && (
        <div className="px-3 sm:px-4 lg:px-5 space-y-4 pt-3">
          <div className="flex items-center gap-2 px-1">
            <BarChart2 className="w-4 h-4 text-[#FFB800]" />
            <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">OPTIONS STRATEGIST</span>
            <span className="font-mono text-[10px] text-[#71717a] ml-1">Analyzing: <span className="text-[#FFB800] font-bold">{symbol}</span></span>
          </div>

          <div className="mt-1">
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

          <Button
            onClick={handleRunStrategist}
            disabled={isPendingAny || !accessToken}
            className="w-full font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90 h-9"
          >
            <BarChart2 className="w-3.5 h-3.5 mr-2 shrink-0" />RUN STRATEGIST
          </Button>

          <div className={`bg-card border border-card-border overflow-hidden rounded-xl`}>
            <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="font-mono text-xs font-bold text-foreground">DEEP ANALYSIS — {symbol}</span>
            </div>
            <div className="p-4 bg-[#0c0c0c]">
              <Textarea
                placeholder="Add specific instructions (optional)... e.g. 'Focus on premium selling setups with high PoP'"
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                className="font-mono text-xs bg-background border-card-border focus-visible:ring-primary/50 min-h-[60px] resize-none"
              />
            </div>

            {activeResult === "strategist" && (
              <div className="border-t border-card-border p-4 bg-[#0c0c0c]">
                {isStrategizing ? (
                  <div className="flex items-center gap-3 py-4">
                    <span className="w-4 h-4 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
                    <span className="font-mono text-xs text-[#a1a1aa]">Fetching chain & selecting strikes...</span>
                  </div>
                ) : hasRealStrategies ? (
                  <>
                    {thinkingTokens.length > 0 && (
                      <div className="mb-3">
                        <AiThinkingFeed texts={thinkingTokens} isStreaming={isStreaming} />
                      </div>
                    )}
                    <StrategistResultView
                      strategies={realStrategies}
                      narrative={narrativeText}
                      isStreaming={isStreaming}
                      streamingText={streamingText}
                    />
                  </>
                ) : currentResult && currentResult !== "done" ? (
                  <MarkdownResult content={currentResult} />
                ) : isStreaming ? (
                  <AiThinkingFeed texts={thinkingTokens} isStreaming={true} />
                ) : null}
              </div>
            )}
          </div>

          {strategistAudit && activeResult === "strategist" && !isStreaming && !isStrategizing && (
            <StrategistAuditPanel audit={strategistAudit} />
          )}
        </div>
      )}

      {subTab === "technicals" && (
        <div className="px-3 sm:px-4 lg:px-5 space-y-4 pt-3">
          <div className="flex items-center gap-2 px-1">
            <Activity className="w-4 h-4 text-[#FFB800]" />
            <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">TECHNICAL ANALYSIS</span>
            <span className="font-mono text-[10px] text-[#71717a] ml-1">Analyzing: <span className="text-[#FFB800] font-bold">{symbol}</span></span>
          </div>

          <Button
            onClick={handleRunTA}
            disabled={isPendingAny || !accessToken || !quote}
            className="w-full font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90 h-9"
          >
            <Activity className="w-3.5 h-3.5 mr-2 shrink-0" />
            RUN TECHNICAL ANALYSIS
          </Button>

          {activeResult === "analysis" && (
            <div className="bg-card border border-card-border rounded-xl p-4">
              {isStreaming ? (
                <>
                  <AiThinkingFeed
                    texts={thinkingTokens}
                    isStreaming={true}
                  />
                  {streamingText && (
                    <div className="mt-3">
                      <MarkdownResult content={streamingText} />
                    </div>
                  )}
                </>
              ) : analysisResult ? (
                <>
                  {thinkingTokens.length > 0 && (
                    <div className="mb-3">
                      <AiThinkingFeed
                        texts={thinkingTokens}
                        isStreaming={false}
                      />
                    </div>
                  )}
                  <MarkdownResult content={analysisResult} />
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
