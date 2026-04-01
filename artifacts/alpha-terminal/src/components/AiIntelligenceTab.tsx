import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
} from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  BarChart2, Target, DollarSign, Shield, TrendingUp, Scale,
  Zap, ChevronDown, AlertTriangle, CheckCircle2, XCircle, AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MarketPulseDashboard } from "@/components/market-pulse/MarketPulseDashboard";
import { StrategistAuditPanel, type StrategistAuditData } from "@/components/market-pulse/StrategistAuditPanel";
import type { AiSubTab } from "@/components/ai-tab/AiSubTabs";
import { AiThinkingFeed } from "@/components/ai-shared/AiThinkingFeed";
import { useStrategistCache, type StrategistCacheData } from "@/hooks/useStrategistCache";

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

interface RiskEvaluation {
  category: "DEFINED" | "CASH_SECURED" | "MARGIN_BASED";
  risk_metric: number;
  risk_label: string;
  capital_required?: number;
  within_limits: boolean;
}

interface PreTradeCheck {
  id: string;
  label: string;
  status: "PASS" | "WARN" | "FAIL";
  value: string;
  threshold: string;
  detail: string;
}

interface PreTradeResult {
  overall: "PASS" | "WARN" | "FAIL";
  checks: PreTradeCheck[];
  failCount: number;
  warnCount: number;
  passCount: number;
  blockTrade: boolean;
  aiOneLiner?: string;
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
  risk_reward_display?: string;
  size_recommendation: string;
  contracts: number;
  exit_rules: ExitRules;
  undefined_risk?: boolean;
  risk_evaluation?: RiskEvaluation;
}

interface RegimeInfo {
  regime: string;
  description: string;
  strategyUniverse: string[];
  dteRange: { min: number; max: number };
  deltaTargets: { shortStrike: number };
  sizeMultiplier: number;
}

interface PulseSnapshot {
  composite: number;
  confidence: number;
  label: string;
  todayEdge: string;
  size: string;
  timestamp?: number;
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

function RegimeDisplayBanner({ regime, pulse }: { regime: RegimeInfo; pulse?: PulseSnapshot }) {
  const regimeFormatted = regime.regime.replace(/_/g, " ");
  const strategies = regime.strategyUniverse.map(s => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(", ");

  return (
    <div className="rounded-xl border border-[#FFB800]/30 overflow-hidden" style={{ background: "rgba(255,184,0,0.05)" }}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: "#FFB800" }} />
          <span className="font-mono text-[10px] font-bold text-[#FFB800] uppercase tracking-widest">Market Regime</span>
        </div>
        <div className="font-mono text-sm font-bold text-white mb-1">{regimeFormatted}</div>
        <div className="font-mono text-[11px] text-[#a1a1aa] leading-relaxed">{regime.description}</div>
        <div className="font-mono text-[10px] text-[#71717a] mt-2">
          Scanning {regime.dteRange.min}–{regime.dteRange.max} DTE | Universe: {strategies}
        </div>
        {pulse?.timestamp && (
          <div className="font-mono text-[9px] text-[#52525b] mt-1">
            Pulse snapshot: {new Date(pulse.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}

function OverrideWarningBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-yellow-500/40 px-4 py-3 flex items-start gap-2" style={{ background: "rgba(234,179,8,0.08)" }}>
      <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
      <span className="font-mono text-[11px] text-yellow-400 leading-relaxed">{message}</span>
    </div>
  );
}

function UndefinedRiskWarning() {
  return (
    <div className="rounded-lg border border-red-500/40 px-3 py-2 flex items-start gap-2 mx-4 mb-3" style={{ background: "rgba(239,68,68,0.08)" }}>
      <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
      <span className="font-mono text-[10px] text-red-400 leading-relaxed">
        This strategy has undefined/unlimited risk. Requires margin and active management. Not suitable for small accounts.
      </span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = { PASS: "#00d166", WARN: "#FFB800", FAIL: "#f23645" };
const STATUS_ICONS: Record<string, React.ReactNode> = {
  PASS: <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#00d166" }} />,
  WARN: <AlertCircle className="w-3.5 h-3.5" style={{ color: "#FFB800" }} />,
  FAIL: <XCircle className="w-3.5 h-3.5" style={{ color: "#f23645" }} />,
};

function PreTradeCheckPanel({ result }: { result: PreTradeResult }) {
  const overallColor = STATUS_COLORS[result.overall];
  const overallLabel = result.overall === "PASS" ? "CLEAR" : result.overall === "WARN" ? "CAUTION" : "BLOCKED";
  return (
    <div className="mx-4 mb-3 rounded-lg border overflow-hidden" style={{ borderColor: `${overallColor}40`, background: `${overallColor}08` }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${overallColor}30` }}>
        <div className="flex items-center gap-2">
          {STATUS_ICONS[result.overall]}
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: overallColor }}>
            Pre-Trade: {overallLabel}
          </span>
        </div>
        <span className="font-mono text-[9px] text-[#71717a]">
          {result.passCount}P / {result.warnCount}W / {result.failCount}F
        </span>
      </div>
      <div className="px-3 py-1.5">
        {result.checks.map(c => (
          <div key={c.id} className="flex items-center justify-between py-1 border-b border-[#2A2A2C]/50 last:border-0">
            <div className="flex items-center gap-1.5">
              {STATUS_ICONS[c.status]}
              <span className="font-mono text-[10px] text-[#a1a1aa]">{c.label}</span>
            </div>
            <span className="font-mono text-[10px] font-bold text-white">{c.value}</span>
          </div>
        ))}
      </div>
      {result.aiOneLiner && (
        <div className="px-3 py-2 border-t" style={{ borderColor: `${overallColor}20` }}>
          <span className="font-mono text-[10px] text-[#a1a1aa] italic">{result.aiOneLiner}</span>
        </div>
      )}
    </div>
  );
}

function RiskCategoryBadge({ evaluation }: { evaluation?: RiskEvaluation }) {
  if (!evaluation) return null;
  const badgeColor = evaluation.category === "DEFINED" ? "#00d166"
    : evaluation.category === "CASH_SECURED" ? "#FFB800" : "#f23645";
  const label = evaluation.category === "DEFINED" ? "Defined Risk"
    : evaluation.category === "CASH_SECURED" ? "Cash Secured" : "Margin Based";
  return (
    <span className="font-mono text-[8px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${badgeColor}15`, color: badgeColor }}>
      {label}
    </span>
  );
}

function RealStrategyCard({ s, idx, preTradeResult }: { s: StrategyPayload; idx: number; preTradeResult?: PreTradeResult | null }) {
  const isCredit = s.net_credit > 0;
  const re = s.risk_evaluation;
  const riskLabel = re ? re.risk_label : "Max Risk";
  const riskValue = re ? fmtDollar(re.risk_metric) : fmtDollar(s.max_loss);

  const metrics = [
    { label: isCredit ? "Net Credit" : "Net Debit", value: fmtDollar(s.net_credit), icon: <DollarSign className="w-3.5 h-3.5" />, color: "#FFB800" },
    { label: riskLabel, value: riskValue, icon: <Shield className="w-3.5 h-3.5" />, color: "#f23645" },
    { label: "Max Reward", value: fmtDollar(s.max_profit), icon: <TrendingUp className="w-3.5 h-3.5" />, color: "#00d166" },
    { label: "R/R Ratio", value: s.risk_reward_ratio, icon: <Scale className="w-3.5 h-3.5" />, color: "#FF6B2B" },
  ];

  return (
    <div className="rounded-xl border border-card-border overflow-hidden" style={{ background: "#111113" }}>
      <div className="px-4 py-3 border-b border-card-border flex items-center justify-between" style={{ background: "#151517" }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-primary">#{idx + 1}</span>
          <span className="font-mono text-sm font-bold text-white">{s.strategy_type}</span>
          <RiskCategoryBadge evaluation={re} />
        </div>
        <span className="font-mono text-[10px] text-[#71717a]">{s.days_to_expiration}DTE</span>
      </div>
      {s.undefined_risk && <UndefinedRiskWarning />}
      {preTradeResult && <PreTradeCheckPanel result={preTradeResult} />}

      {s.risk_reward_display && (
        <div className="mx-4 mt-2 px-3 py-1.5 rounded-lg border border-[#FF6B2B]/30" style={{ background: "rgba(255,107,43,0.06)" }}>
          <span className="font-mono text-[10px] text-[#FF6B2B] font-bold">{s.risk_reward_display}</span>
        </div>
      )}

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

function StrategistResultView({ strategies, narrative, isStreaming, streamingText, regime, pulse, overrideWarning, preTradeResults }: {
  strategies: StrategyPayload[];
  narrative: string;
  isStreaming: boolean;
  streamingText: string;
  regime?: RegimeInfo | null;
  pulse?: PulseSnapshot | null;
  overrideWarning?: string | null;
  preTradeResults?: Record<number, PreTradeResult>;
}) {
  return (
    <div className="space-y-4">
      {regime && <RegimeDisplayBanner regime={regime} pulse={pulse ?? undefined} />}
      {overrideWarning && <OverrideWarningBanner message={overrideWarning} />}
      {strategies.map((s, i) => (
        <RealStrategyCard key={i} s={s} idx={i} preTradeResult={preTradeResults?.[i]} />
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
    preTradeEnabled, setPreTradeEnabled,
    preTradeBlockOnRed, setPreTradeBlockOnRed,
    preTradeMinRR, setPreTradeMinRR,
    preTradeMaxPositionPct, setPreTradeMaxPositionPct,
    preTradeMinDTE, setPreTradeMinDTE,
    accountSize, setAccountSize,
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

        <div className="border-t border-card-border pt-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-3.5 h-3.5 text-[#FFB800]" />
            <span className="font-mono text-[11px] font-bold text-gray-400 uppercase tracking-wider">Pre-Trade Risk Manager</span>
          </div>

          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Enable Risk Checks</span>
            <ToggleSwitch checked={preTradeEnabled} onChange={setPreTradeEnabled} />
          </div>

          <div className="flex items-center justify-between mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Block on RED</span>
            <ToggleSwitch checked={preTradeBlockOnRed} onChange={setPreTradeBlockOnRed} disabled={!preTradeEnabled} />
          </div>

          <div className="mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Account Size</span>
              <span className="font-mono text-xs text-white font-bold">${accountSize.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={5000}
              max={500000}
              step={5000}
              value={accountSize}
              onChange={e => setAccountSize(Number(e.target.value))}
              disabled={!preTradeEnabled}
              className="w-full h-1 rounded-full appearance-none"
              style={{ accentColor: "#FFB800", background: "#2A2A2C", cursor: preTradeEnabled ? "pointer" : "not-allowed" }}
            />
            <div className="flex justify-between mt-0.5">
              <span className="font-mono text-[9px] text-gray-600">$5K</span>
              <span className="font-mono text-[9px] text-gray-600">$500K</span>
            </div>
          </div>

          <div className="mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Min R/R</span>
              <span className="font-mono text-xs text-white font-bold">{preTradeMinRR.toFixed(2)}:1</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={preTradeMinRR}
              onChange={e => setPreTradeMinRR(Number(e.target.value))}
              disabled={!preTradeEnabled}
              className="w-full h-1 rounded-full appearance-none"
              style={{ accentColor: "#FF6B2B", background: "#2A2A2C", cursor: preTradeEnabled ? "pointer" : "not-allowed" }}
            />
          </div>

          <div className="mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Max Position %</span>
              <span className="font-mono text-xs text-white font-bold">{preTradeMaxPositionPct}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={preTradeMaxPositionPct}
              onChange={e => setPreTradeMaxPositionPct(Number(e.target.value))}
              disabled={!preTradeEnabled}
              className="w-full h-1 rounded-full appearance-none"
              style={{ accentColor: "#FF6B2B", background: "#2A2A2C", cursor: preTradeEnabled ? "pointer" : "not-allowed" }}
            />
          </div>

          <div style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Min DTE</span>
              <span className="font-mono text-xs text-white font-bold">{preTradeMinDTE} days</span>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={preTradeMinDTE}
              onChange={e => setPreTradeMinDTE(Number(e.target.value))}
              disabled={!preTradeEnabled}
              className="w-full h-1 rounded-full appearance-none"
              style={{ accentColor: "#FF6B2B", background: "#2A2A2C", cursor: preTradeEnabled ? "pointer" : "not-allowed" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface AiIntelligenceTabProps {
  subTab: AiSubTab;
  onSubTabChange: (tab: AiSubTab) => void;
}

export function AiIntelligenceTab({ subTab, onSubTabChange }: AiIntelligenceTabProps) {
  const {
    symbol, accessToken,
    aiModel, aiTemp,
    strategistResult, setStrategistResult,
    stratAutopilot, stratMaxRisk, stratMinPoP, stratMinRR,
    stratBias, stratPremium, stratAvoidEarnings,
    preTradeEnabled, preTradeBlockOnRed, preTradeMinRR,
    preTradeMaxPositionPct, preTradeMinDTE, accountSize,
  } = useTerminalStore();

  const { cachedData: strategistCache, setCachedData: setStrategistCache } = useStrategistCache(symbol);

  const [customPrompt, setCustomPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [activeResult, setActiveResult] = useState<"strategist" | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [thinkingTokens, setThinkingTokens] = useState<string[]>([]);
  const [strategistAudit, setStrategistAudit] = useState<StrategistAuditData | null>(null);
  const [realStrategies, setRealStrategies] = useState<StrategyPayload[]>([]);
  const [narrativeText, setNarrativeText] = useState("");
  const [regimeInfo, setRegimeInfo] = useState<RegimeInfo | null>(null);
  const [pulseSnapshot, setPulseSnapshot] = useState<PulseSnapshot | null>(null);
  const [overrideWarning, setOverrideWarning] = useState<string | null>(null);
  const [strategistStatus, setStrategistStatus] = useState<string>("");
  const [preTradeResults, setPreTradeResults] = useState<Record<number, PreTradeResult>>({});
  const cacheRestoredRef = useRef(false);
  const prevSymbolRef = useRef(symbol);
  const strategistRunRef = useRef(0);

  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      cacheRestoredRef.current = false;
    }
  }, [symbol]);

  useEffect(() => {
    if (cacheRestoredRef.current) return;
    cacheRestoredRef.current = true;

    if (subTab === "strategist" && strategistCache && !isStreaming && !isStrategizing) {
      setRealStrategies(strategistCache.strategies);
      setNarrativeText(strategistCache.narrative);
      setRegimeInfo(strategistCache.regime);
      setPulseSnapshot(strategistCache.pulse);
      setOverrideWarning(strategistCache.overrideWarning);
      setStrategistAudit(strategistCache.audit);
      setThinkingTokens(strategistCache.thinkingTokens);
      if (strategistCache.resultStatus) setStrategistResult(strategistCache.resultStatus);
      setActiveResult("strategist");
    }
  }, [symbol, strategistCache]);

  useEffect(() => {
    setStreamingText("");

    if (subTab === "strategist" && strategistCache && !isStreaming && !isStrategizing) {
      setRealStrategies(strategistCache.strategies);
      setNarrativeText(strategistCache.narrative);
      setRegimeInfo(strategistCache.regime);
      setPulseSnapshot(strategistCache.pulse);
      setOverrideWarning(strategistCache.overrideWarning);
      setStrategistAudit(strategistCache.audit);
      setThinkingTokens(strategistCache.thinkingTokens);
      if (strategistCache.resultStatus) setStrategistResult(strategistCache.resultStatus);
      setActiveResult("strategist");
    } else {
      setThinkingTokens([]);
      setActiveResult(null);
    }
  }, [subTab]);

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

  useEffect(() => {
    if (!preTradeEnabled) {
      setPreTradeResults({});
      return;
    }
    if (realStrategies.length === 0 || !pulseSnapshot) return;
    if (isStreaming || isStrategizing) return;

    const runChecks = async () => {
      const results: Record<number, PreTradeResult> = {};
      for (let i = 0; i < realStrategies.length; i++) {
        try {
          const res = await fetchWithAuth(`${API_BASE}/ai/pre-trade-check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              strategy: realStrategies[i],
              pulseComposite: pulseSnapshot.composite,
              pulseConfidence: pulseSnapshot.confidence,
              pulseEdge: pulseSnapshot.todayEdge,
              vix: null,
              accountSize,
              settings: {
                minRR: preTradeMinRR,
                maxPositionPct: preTradeMaxPositionPct,
                minDTE: preTradeMinDTE,
                blockOnRed: preTradeBlockOnRed,
              },
            }),
          });
          if (res.ok) {
            results[i] = await res.json();
          }
        } catch {}
      }
      setPreTradeResults(results);
    };

    runChecks();
  }, [realStrategies, pulseSnapshot, preTradeEnabled, preTradeMinRR, preTradeMaxPositionPct, preTradeMinDTE, preTradeBlockOnRed, accountSize, isStreaming, isStrategizing]);

  const handleRunStrategist = useCallback(async () => {
    if (!accessToken) return;
    const runId = ++strategistRunRef.current;
    setStrategistResult(null);
    setStrategistAudit(null);
    setStreamingText("");
    setThinkingTokens([]);
    setRealStrategies([]);
    setNarrativeText("");
    setRegimeInfo(null);
    setPulseSnapshot(null);
    setOverrideWarning(null);
    setPreTradeResults({});
    setActiveResult("strategist");
    setIsStrategizing(true);
    setStrategistStatus("Running market pulse...");

    const collected = {
      strategies: [] as StrategyPayload[],
      narrative: "",
      regime: null as RegimeInfo | null,
      pulse: null as PulseSnapshot | null,
      overrideWarning: null as string | null,
      audit: null as StrategistAuditData | null,
      thinkingTokens: [] as string[],
      resultStatus: null as string | null,
    };

    try {
      setStrategistStatus("Classifying regime & scanning chain...");
      const res = await fetchWithAuth(`${API_BASE}/ai/options-strategist/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          accessToken,
          todayEdge: stratBias === "auto" ? undefined : stratBias === "bullish" ? "BULLISH_EDGE" : stratBias === "bearish" ? "BEARISH_EDGE" : "NEUTRAL_EDGE",
        }),
      });

      if (strategistRunRef.current !== runId) return;

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        setStrategistResult(`**Error:** ${errText}`);
        setIsStrategizing(false);
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        if (strategistRunRef.current !== runId) return;
        const json = await res.json() as { strategies?: StrategyPayload[]; narrative?: string; error?: string; edge?: string; regime?: RegimeInfo; pulse?: PulseSnapshot; overrideWarning?: string };
        if (json.regime) { setRegimeInfo(json.regime); collected.regime = json.regime; }
        if (json.pulse) { setPulseSnapshot(json.pulse); collected.pulse = json.pulse; }
        if (json.overrideWarning) { setOverrideWarning(json.overrideWarning); collected.overrideWarning = json.overrideWarning; }
        if (json.error) {
          setStrategistResult(`**Error:** ${json.error}`);
        } else if (json.strategies && json.strategies.length > 0) {
          setRealStrategies(json.strategies);
          setNarrativeText(json.narrative ?? "");
          setStrategistResult("done");
          collected.strategies = json.strategies;
          collected.narrative = json.narrative ?? "";
          collected.resultStatus = "done";
          setStrategistCache({ ...collected, timestamp: Date.now() });
        } else {
          setStrategistResult(json.narrative ?? "No strategies available.");
          collected.resultStatus = json.narrative ?? "No strategies available.";
          setStrategistCache({ ...collected, timestamp: Date.now() });
        }
        setIsStrategizing(false);
        setStrategistStatus("");
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
              regime?: RegimeInfo;
              pulse?: PulseSnapshot;
              overrideWarning?: string;
            };
            if (parsed.error) {
              setStrategistResult(`**Error:** ${parsed.error}`);
              setIsStreaming(false);
              setStrategistStatus("");
              return;
            }
            if (parsed.regime) { setRegimeInfo(parsed.regime); collected.regime = parsed.regime; }
            if (parsed.pulse) { setPulseSnapshot(parsed.pulse); collected.pulse = parsed.pulse; }
            if (parsed.overrideWarning) { setOverrideWarning(parsed.overrideWarning); collected.overrideWarning = parsed.overrideWarning; }
            if (parsed.strategies) {
              setStrategistStatus("Building AI thesis...");
              setRealStrategies(parsed.strategies);
              collected.strategies = parsed.strategies;
              const q = quote as Record<string, unknown> | undefined;
              const auditData: StrategistAuditData = {
                symbol,
                price: parsed.underlyingPrice ?? null,
                change: q && typeof q.netChange === "number" ? q.netChange : null,
                changePct: q && typeof q.netPercentChange === "number" ? q.netPercentChange : null,
                volume: null,
                autopilot: stratAutopilot,
                maxRisk: stratMaxRisk,
                minPoP: 0,
                minRR: "0.20:1",
                bias: parsed.edge ?? "—",
                premium: "—",
                avoidEarnings: false,
                chainCallCount: 0,
                chainPutCount: 0,
                model: "gemini-2.5-flash",
                temperature: 0.2,
                timestamp: Date.now(),
              };
              setStrategistAudit(auditData);
              collected.audit = auditData;
            }
            if (parsed.reasoning) {
              collected.thinkingTokens.push(parsed.reasoning);
              setThinkingTokens((prev) => [...prev, parsed.reasoning!]);
            }
            if (parsed.text) {
              accumulated += parsed.text;
              setStreamingText(accumulated);
            }
          } catch {}
        }
      }
      if (strategistRunRef.current !== runId) return;
      setNarrativeText(accumulated);
      collected.narrative = accumulated;
      collected.resultStatus = "done";
      setStrategistResult("done");
      setStreamingText("");
      setIsStreaming(false);
      setStrategistStatus("");
      setStrategistCache({ ...collected, timestamp: Date.now() });
    } catch (err) {
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
      setIsStrategizing(false);
      setIsStreaming(false);
      setStrategistStatus("");
    }
  }, [quote, accessToken, symbol, setStrategistResult, setStrategistCache,
      stratAutopilot, stratMaxRisk, stratBias]);


  const isPendingAny = isStreaming || isStrategizing;

  const currentResult = activeResult === "strategist" ? strategistResult : null;

  const hasRealStrategies = realStrategies.length > 0;

  return (
    <div className="flex flex-col gap-0 w-full max-w-5xl mx-auto pb-6 flex-1" style={{ minHeight: "calc(var(--vvh, 100vh) - 200px)" }}>
      {subTab === "pulse" && (
        <MarketPulseDashboard />
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
                    <span className="font-mono text-xs text-[#a1a1aa]">{strategistStatus || "Processing..."}</span>
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
                      regime={regimeInfo}
                      pulse={pulseSnapshot}
                      overrideWarning={overrideWarning}
                      preTradeResults={preTradeResults}
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

    </div>
  );
}
