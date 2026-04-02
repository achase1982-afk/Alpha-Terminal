import { useState, useEffect, useCallback, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
} from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  BarChart2, DollarSign, Shield, TrendingUp, Scale,
  Zap, ChevronDown, AlertTriangle, CheckCircle2, XCircle, AlertCircle, Search,
  Target, Activity, Clock, Crosshair,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MarketPulseDashboard, type MarketPulseDashboardHandle } from "@/components/market-pulse/MarketPulseDashboard";
import { StrategistAuditPanel, type StrategistAuditData } from "@/components/market-pulse/StrategistAuditPanel";
import type { AiSubTab } from "@/components/ai-tab/AiSubTabs";
import { AiThinkingFeed } from "@/components/ai-shared/AiThinkingFeed";
import { useStrategistCache, type StrategistCacheData } from "@/hooks/useStrategistCache";

const API_BASE = "/api";

const COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", GOOGL: "Alphabet Inc.", GOOG: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.", META: "Meta Platforms Inc.", NVDA: "NVIDIA Corp.", TSLA: "Tesla Inc.",
  SPY: "SPDR S&P 500 ETF", QQQ: "Invesco QQQ Trust", IWM: "iShares Russell 2000",
  DIA: "SPDR Dow Jones ETF", HYG: "iShares High Yield Corp", LQD: "iShares Invest Grade Corp",
  AMD: "Advanced Micro Devices", NFLX: "Netflix Inc.", CRM: "Salesforce Inc.", MRVL: "Marvell Technology",
  MU: "Micron Technology", AVGO: "Broadcom Inc.", QCOM: "Qualcomm Inc.", ARM: "Arm Holdings",
  SMCI: "Super Micro Computer", TSM: "Taiwan Semiconductor",
  INTC: "Intel Corp.", BA: "Boeing Co.", JPM: "JPMorgan Chase", GS: "Goldman Sachs",
  V: "Visa Inc.", MA: "Mastercard Inc.", WMT: "Walmart Inc.", DIS: "Walt Disney Co.",
  PYPL: "PayPal Holdings", SQ: "Block Inc.", COIN: "Coinbase Global",
  PLTR: "Palantir Technologies", SOFI: "SoFi Technologies", UBER: "Uber Technologies",
  SNOW: "Snowflake Inc.", NET: "Cloudflare Inc.", SHOP: "Shopify Inc.",
  ROKU: "Roku Inc.", RIVN: "Rivian Automotive Inc.", LCID: "Lucid Group Inc.",
  PANW: "Palo Alto Networks", CRWD: "CrowdStrike Holdings", ZS: "Zscaler Inc.",
  DDOG: "Datadog Inc.", MDB: "MongoDB Inc.", TTD: "The Trade Desk",
  ENPH: "Enphase Energy", FSLR: "First Solar Inc.", ON: "ON Semiconductor",
  ANET: "Arista Networks", NOW: "ServiceNow Inc.", ADBE: "Adobe Inc.",
  ORCL: "Oracle Corp.", IBM: "IBM Corp.", DELL: "Dell Technologies",
  GM: "General Motors", F: "Ford Motor Co.", SNAP: "Snap Inc.",
  PINS: "Pinterest Inc.", SQ: "Block Inc.", HOOD: "Robinhood Markets",
  SOXX: "iShares Semiconductor", XLF: "Financial Select SPDR", XLE: "Energy Select SPDR",
  GLD: "SPDR Gold Trust", SLV: "iShares Silver Trust", TLT: "iShares 20+ Year Treasury",
  USO: "United States Oil Fund", ARKK: "ARK Innovation ETF",
  NIO: "NIO Inc.", BABA: "Alibaba Group", JD: "JD.com Inc.",
  XOM: "Exxon Mobil Corp.", CVX: "Chevron Corp.", PFE: "Pfizer Inc.",
  MRNA: "Moderna Inc.", UNH: "UnitedHealth Group", LLY: "Eli Lilly & Co.",
  COST: "Costco Wholesale", HD: "Home Depot Inc.", LOW: "Lowe's Companies",
  TGT: "Target Corp.", KO: "Coca-Cola Co.", PEP: "PepsiCo Inc.",
  MCD: "McDonald's Corp.", SBUX: "Starbucks Corp.", NKE: "Nike Inc.",
  ABNB: "Airbnb Inc.", DASH: "DoorDash Inc.", LYFT: "Lyft Inc.",
  VIX: "CBOE Volatility Index", "$VIX": "CBOE Volatility Index", "$TRIN": "Arms Index",
};

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

function MiniGauge({ value, max, color, label, display }: { value: number; max: number; color: string; label: string; display?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const r = 20;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ * 0.75;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-12 h-12">
        <svg viewBox="0 0 48 48" className="w-full h-full -rotate-[135deg]">
          <circle cx="24" cy="24" r={r} fill="none" stroke="#2A2A2C" strokeWidth="3"
            strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeLinecap="round" />
          <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[10px] font-bold text-white">{display ?? `${value}%`}</span>
        </div>
      </div>
      <span className="font-mono text-[8px] text-[#71717a] uppercase tracking-wider">{label}</span>
    </div>
  );
}

function parseRRValue(rr: string): number {
  const parts = rr.split(":");
  if (parts.length === 2) {
    const num = parseFloat(parts[1]);
    if (!isNaN(num)) return Math.min(num, 5);
  }
  return 1;
}

function LegRow({ leg, label, even }: { leg: LegPayload; label: string; even: boolean }) {
  const actionColor = leg.action === "SELL" ? "#f23645" : "#00d166";
  return (
    <div className="flex items-center justify-between py-2 px-3" style={{ background: even ? "rgba(255,255,255,0.015)" : "transparent" }}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] w-10 text-center py-0.5 rounded font-bold" style={{ background: `${actionColor}15`, color: actionColor }}>
          {leg.action}
        </span>
        <span className="font-mono text-[10px] text-[#71717a] uppercase w-14">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-white font-bold tabular-nums">{leg.strike}</span>
        <span className="font-mono text-[10px] text-white/60">{leg.type}</span>
        <span className="font-mono text-[10px] text-[#52525b] tabular-nums">{'\u0394'}{leg.delta.toFixed(2)}</span>
        <span className="font-mono text-[10px] text-[#52525b] tabular-nums">{leg.bid}/{leg.ask}</span>
      </div>
    </div>
  );
}

function RegimeDisplayBanner({ regime, pulse }: { regime: RegimeInfo; pulse?: PulseSnapshot }) {
  const regimeFormatted = regime.regime.replace(/_/g, " ").toUpperCase();
  const strategies = regime.strategyUniverse.map(s => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));

  const regimeIcon = regime.regime.toLowerCase().includes("bull") ? "▲"
    : regime.regime.toLowerCase().includes("bear") ? "▼" : "◆";
  const regimeColor = regime.regime.toLowerCase().includes("bull") ? "#00d166"
    : regime.regime.toLowerCase().includes("bear") ? "#f23645" : "#FFB800";

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: `${regimeColor}30`, background: `${regimeColor}06` }}>
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-lg font-bold"
            style={{ background: `${regimeColor}15`, color: regimeColor }}>
            {regimeIcon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: regimeColor }}>Market Regime</span>
            </div>
            <div className="font-mono text-sm font-bold text-white mb-1">{regimeFormatted}</div>
            <div className="font-mono text-[11px] text-[#a1a1aa] leading-relaxed">{regime.description}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {strategies.map(s => (
            <span key={s} className="font-mono text-[9px] px-2 py-1 rounded-full font-bold uppercase tracking-wider"
              style={{ background: `${regimeColor}12`, color: regimeColor, border: `1px solid ${regimeColor}25` }}>
              {s}
            </span>
          ))}
        </div>

        {pulse && (
          <div className="mt-3 pt-2 border-t" style={{ borderColor: `${regimeColor}15` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[9px] text-[#3f3f46] uppercase tracking-wider">Confidence</span>
              <span className="font-mono text-[10px] font-bold" style={{ color: regimeColor }}>{pulse.confidence}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1f1f22" }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pulse.confidence}%`, background: `linear-gradient(90deg, ${regimeColor}80, ${regimeColor})` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 mt-2.5">
          <span className="font-mono text-[10px] text-[#52525b]">
            <Clock className="w-3 h-3 inline mr-1 -mt-px" />{regime.dteRange.min}–{regime.dteRange.max} DTE
          </span>
          <span className="font-mono text-[10px] text-[#52525b]">
            <Crosshair className="w-3 h-3 inline mr-1 -mt-px" />{'\u0394'}{regime.deltaTargets.shortStrike}
          </span>
          {pulse?.timestamp && (
            <span className="font-mono text-[9px] text-[#3f3f46] ml-auto">
              {new Date(pulse.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function OverrideWarningBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-yellow-500/30 px-4 py-3 flex items-start gap-3" style={{ background: "rgba(234,179,8,0.06)" }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(234,179,8,0.12)" }}>
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
      </div>
      <span className="font-mono text-[11px] text-yellow-400/90 leading-relaxed pt-1.5">{message}</span>
    </div>
  );
}

function UndefinedRiskWarning() {
  return (
    <div className="rounded-lg border border-red-500/30 px-3 py-2 flex items-start gap-2 mx-4 mb-3" style={{ background: "rgba(239,68,68,0.06)" }}>
      <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
      <span className="font-mono text-[10px] text-red-400/80 leading-relaxed">
        Undefined/unlimited risk. Requires margin and active management.
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
    <div className="mx-4 mb-3 rounded-lg border overflow-hidden" style={{ borderColor: `${overallColor}30`, background: `${overallColor}06` }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${overallColor}20` }}>
        <div className="flex items-center gap-2">
          {STATUS_ICONS[result.overall]}
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: overallColor }}>
            Pre-Trade: {overallLabel}
          </span>
        </div>
        <span className="font-mono text-[9px] text-[#52525b]">
          {result.passCount}P / {result.warnCount}W / {result.failCount}F
        </span>
      </div>
      <div className="px-3 py-1.5">
        {result.checks.map(c => (
          <div key={c.id} className="flex items-center justify-between py-1 border-b border-[#2A2A2C]/30 last:border-0">
            <div className="flex items-center gap-1.5">
              {STATUS_ICONS[c.status]}
              <span className="font-mono text-[10px] text-[#a1a1aa]">{c.label}</span>
            </div>
            <span className="font-mono text-[10px] font-bold text-white tabular-nums">{c.value}</span>
          </div>
        ))}
      </div>
      {result.aiOneLiner && (
        <div className="px-3 py-2 border-t" style={{ borderColor: `${overallColor}15` }}>
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
  const label = evaluation.category === "DEFINED" ? "DEFINED"
    : evaluation.category === "CASH_SECURED" ? "CASH SECURED" : "MARGIN";
  return (
    <span className="font-mono text-[8px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
      style={{ background: `${badgeColor}12`, color: badgeColor, border: `1px solid ${badgeColor}25` }}>
      {label}
    </span>
  );
}

function RealStrategyCard({ s, idx, preTradeResult }: { s: StrategyPayload; idx: number; preTradeResult?: PreTradeResult | null }) {
  const [showTradePlan, setShowTradePlan] = useState(false);
  const isCredit = s.net_credit > 0;
  const re = s.risk_evaluation;
  const riskLabel = re ? re.risk_label : "Max Risk";
  const riskValue = re ? fmtDollar(re.risk_metric) : fmtDollar(s.max_loss);
  const accentColor = isCredit ? "#00d166" : "#f23645";

  const metrics = [
    { label: isCredit ? "Net Credit" : "Net Debit", value: fmtDollar(s.net_credit), icon: <DollarSign className="w-3.5 h-3.5" />, color: "#FFB800" },
    { label: riskLabel, value: riskValue, icon: <Shield className="w-3.5 h-3.5" />, color: "#f23645" },
    { label: "Max Reward", value: fmtDollar(s.max_profit), icon: <TrendingUp className="w-3.5 h-3.5" />, color: "#00d166" },
    { label: "R/R Ratio", value: s.risk_reward_ratio, icon: <Scale className="w-3.5 h-3.5" />, color: "#FF6B2B" },
  ];

  const allLegs = [
    { leg: s.short_leg, label: "Short" },
    { leg: s.long_leg, label: s.long_leg.action === "SELL" ? "Short 2" : "Long" },
    ...(s.short_leg_2 ? [{ leg: s.short_leg_2, label: "Short Call" }] : []),
    ...(s.long_leg_2 ? [{ leg: s.long_leg_2, label: "Long Call" }] : []),
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="flex">
        <div className="w-1 shrink-0" style={{ background: accentColor }} />
        <div className="flex-1">
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#151517", borderBottom: "1px solid #2A2A2C" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center font-mono text-xs font-bold"
                style={{ background: `${accentColor}15`, color: accentColor }}>
                {idx + 1}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-white">{s.strategy_type}</span>
                  <RiskCategoryBadge evaluation={re} />
                </div>
                <span className="font-mono text-[10px] text-[#52525b]">{s.days_to_expiration} DTE · Exp {s.expiration_date}</span>
              </div>
            </div>
          </div>

          {s.undefined_risk && <UndefinedRiskWarning />}
          {preTradeResult && <PreTradeCheckPanel result={preTradeResult} />}

          {s.risk_reward_display && (
            <div className="mx-4 mt-3 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,107,43,0.06)", border: "1px solid rgba(255,107,43,0.2)" }}>
              <span className="font-mono text-[10px] text-[#FF6B2B] font-bold">{s.risk_reward_display}</span>
            </div>
          )}

          <div className="mx-4 mt-3 rounded-lg overflow-hidden" style={{ border: "1px solid #2A2A2C" }}>
            <div className="px-3 py-1.5" style={{ background: "#0c0c0c", borderBottom: "1px solid #2A2A2C" }}>
              <span className="font-mono text-[9px] text-[#3f3f46] uppercase tracking-widest">Contract Legs</span>
            </div>
            <div style={{ background: "#0a0a0a" }}>
              {allLegs.map((l, i) => (
                <LegRow key={i} leg={l.leg} label={l.label} even={i % 2 === 0} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 p-4">
            {metrics.map(m => (
              <div key={m.label} className="rounded-lg p-3 flex flex-col gap-1" style={{ background: "#0a0a0b", border: "1px solid #1f1f22" }}>
                <div className="flex items-center gap-1.5">
                  <span style={{ color: m.color }}>{m.icon}</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[#52525b]">{m.label}</span>
                </div>
                <span className="font-mono text-sm font-bold text-white tabular-nums">{m.value}</span>
              </div>
            ))}
          </div>

          <div className="px-4 pb-2 flex items-center gap-4">
            <MiniGauge value={s.probability_of_profit_pct} max={100} color="#00d166" label="PoP" />
            <MiniGauge value={parseRRValue(s.risk_reward_ratio)} max={5} color="#FF6B2B" label="R/R" display={s.risk_reward_ratio} />
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider">Breakeven</span>
                <span className="font-mono text-[11px] text-white tabular-nums">{fmtDollar(s.breakeven)}{s.breakeven_upper ? ` / ${fmtDollar(s.breakeven_upper)}` : ""}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider">Size</span>
                <span className="font-mono text-[11px] text-white">{s.contracts} contract{s.contracts > 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>

          <div className="mx-4 mb-4">
            <button
              type="button"
              onClick={() => setShowTradePlan(!showTradePlan)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg font-mono text-[10px] text-[#52525b] uppercase tracking-widest hover:text-[#a1a1aa] transition-colors"
              style={{ background: "#0a0a0b", border: "1px solid #1f1f22" }}
            >
              <span className="flex items-center gap-1.5">
                <Target className="w-3 h-3" />
                Trade Plan
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showTradePlan ? "rotate-180" : ""}`} />
            </button>
            {showTradePlan && (
              <div className="mt-1.5 px-3 py-2.5 rounded-lg space-y-1.5" style={{ background: "#0a0a0b", border: "1px solid #1f1f22" }}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-[#52525b] uppercase">Profit Target</span>
                  <span className="font-mono text-[10px] text-[#00d166] font-bold">{s.exit_rules.profit_target_pct}% ({fmtDollar(s.exit_rules.profit_target_amount)})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-[#52525b] uppercase">Stop Loss</span>
                  <span className="font-mono text-[10px] text-[#f23645] font-bold">{fmtDollar(s.exit_rules.stop_loss_amount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-[#52525b] uppercase">Time Exit</span>
                  <span className="font-mono text-[10px] text-[#a1a1aa]">{s.exit_rules.time_exit}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StrategistCommandBar({ onRun, disabled, lastRunSymbol, lastRunTime }: {
  onRun: (ticker: string) => void; disabled: boolean; lastRunSymbol?: string | null; lastRunTime?: number | null;
}) {
  const { symbol, streamPrices, accessToken } = useTerminalStore();
  const [inputVal, setInputVal] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [previewTicker, setPreviewTicker] = useState("");
  const [previewQuote, setPreviewQuote] = useState<{ last: number; change: number; changePct: number; volume?: number } | null>(null);
  const [fetchingTicker, setFetchingTicker] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamPricesRef = useRef(streamPrices);
  streamPricesRef.current = streamPrices;

  const displaySymbol = previewTicker || symbol;
  const liveQuote = streamPrices[displaySymbol];

  useEffect(() => {
    const typed = inputVal.trim().toUpperCase();
    if (!typed) {
      setPreviewTicker("");
      setPreviewQuote(null);
      setFetchingTicker(false);
      return;
    }
    setPreviewTicker(typed);
    if (streamPricesRef.current[typed]?.last != null) {
      setPreviewQuote(null);
      setFetchingTicker(false);
      return;
    }
    setFetchingTicker(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!accessToken) { setFetchingTicker(false); return; }
      try {
        const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(typed)}&accessToken=${encodeURIComponent(accessToken)}`);
        if (!res.ok) { setFetchingTicker(false); return; }
        const data = await res.json();
        if (data?.last != null) {
          setPreviewQuote({ last: data.last, change: data.change ?? 0, changePct: data.changePct ?? 0, volume: data.volume });
        } else {
          setPreviewQuote(null);
        }
      } catch {
        setPreviewQuote(null);
      }
      setFetchingTicker(false);
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputVal, accessToken]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = inputVal.trim().toUpperCase() || symbol;
    onRun(ticker);
  };

  const quoteData = liveQuote?.last != null ? liveQuote : previewQuote;
  const price = quoteData?.last;
  const change = quoteData?.change;
  const changePct = quoteData?.changePct;
  const isPositive = (change ?? 0) >= 0;
  const volume = liveQuote?.volume ?? previewQuote?.volume;
  const cpcQuote = streamPrices["$CPC"];
  const pcRatio = cpcQuote?.last;

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="rounded-xl overflow-hidden transition-all duration-300"
        style={{
          background: "#111113",
          border: `1px solid ${isFocused ? "rgba(255,184,0,0.5)" : "#2A2A2C"}`,
          boxShadow: isFocused ? "0 0 20px rgba(255,184,0,0.08), inset 0 1px 0 rgba(255,184,0,0.05)" : "none",
        }}
      >
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #1f1f22" }}>
          <div>
            <div className="font-mono text-xl font-normal text-white tracking-wide leading-tight">{displaySymbol}</div>
            <div className="font-mono text-sm font-normal text-[#FFB800] tracking-wide leading-tight">{COMPANY_NAMES[displaySymbol.toUpperCase()] ?? displaySymbol}</div>
          </div>
          {fetchingTicker ? (
            <span className="font-mono text-xs text-white/40 animate-pulse">Loading...</span>
          ) : price != null ? (
            <div className="flex flex-col items-end">
              <span className="font-mono text-lg font-normal tabular-nums" style={{ color: isPositive ? "#00d166" : "#f23645" }}>${price.toFixed(2)}</span>
              {change != null && changePct != null && (
                <span className="font-mono text-xs font-light tabular-nums" style={{ color: isPositive ? "#00d166" : "#f23645" }}>
                  {isPositive ? "+" : ""}{change.toFixed(2)} ({isPositive ? "+" : ""}{changePct.toFixed(2)}%)
                </span>
              )}
            </div>
          ) : null}
        </div>
        <div className="px-4 pb-2 flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/40 uppercase tracking-wider">Vol</span>
            <span className="font-mono text-sm text-white/70 tabular-nums">
              {volume != null ? volume.toLocaleString() : "—"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/40 uppercase tracking-wider">P/C</span>
            <span className="font-mono text-sm text-white/70 tabular-nums">{pcRatio != null ? pcRatio.toFixed(2) : "—"}</span>
          </div>
        </div>

        <div className="px-4 py-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#3f3f46] pointer-events-none" />
            <input
              value={inputVal}
              onChange={e => setInputVal(e.target.value.toUpperCase())}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={`Analyze ${displaySymbol} or enter new ticker...`}
              className="w-full h-10 pl-9 pr-3 rounded-lg font-mono text-xs text-white
                placeholder:text-[#3f3f46] focus:outline-none transition-colors uppercase"
              style={{ background: "#0a0a0b", border: "1px solid #1f1f22" }}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            disabled={disabled}
            className="h-10 px-5 rounded-lg font-mono text-[11px] font-bold tracking-widest shrink-0 transition-all duration-200 uppercase
              disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: disabled ? "#2A2A2C" : "linear-gradient(135deg, #FFB800, #E5A600)",
              color: disabled ? "#52525b" : "#0c0c0c",
              boxShadow: disabled ? "none" : "0 2px 8px rgba(255,184,0,0.25)",
            }}
          >
            <BarChart2 className="w-3.5 h-3.5 inline mr-1.5 -mt-px" />Analyze
          </button>
        </div>
      </div>
    </form>
  );
}

function StrategistPipeline({ status, thinkingTokens }: { status: string; thinkingTokens: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thinkingTokens]);

  const stages = [
    { key: "pulse", label: "PULSE ENGINE", icon: <Activity className="w-3 h-3" /> },
    { key: "regime", label: "REGIME SCAN", icon: <Crosshair className="w-3 h-3" /> },
    { key: "ai", label: "AI REASONING", icon: <Zap className="w-3 h-3" /> },
  ];

  const currentIdx = status.toLowerCase().includes("regime") || status.toLowerCase().includes("chain") ? 1
    : status.toLowerCase().includes("thesis") || thinkingTokens.length > 0 ? 2
    : 0;

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid rgba(255,184,0,0.2)" }}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-[10px] font-bold text-[#FFB800] uppercase tracking-widest">Analyzing</span>
            <span className="font-mono text-[10px] text-[#FFB800]/60 tabular-nums">{Math.round(((currentIdx + (currentIdx < 2 ? 0.6 : 0.3)) / 3) * 100)}%</span>
          </div>
          <span className="font-mono text-[10px] text-[#52525b] tabular-nums">
            <Clock className="w-3 h-3 inline mr-1 -mt-px" />{fmtTime(elapsed)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {stages.map((s, i) => (
            <div key={s.key} className="flex-1 flex items-center gap-1">
              <div className="flex-1">
                <div className="flex items-center gap-1 mb-1">
                  <span style={{ color: i < currentIdx ? "#00d166" : i === currentIdx ? "#FFB800" : "#2A2A2C" }}>
                    {i < currentIdx ? <CheckCircle2 className="w-3 h-3" /> : s.icon}
                  </span>
                  <span className="font-mono text-[8px] tracking-wider"
                    style={{
                      color: i < currentIdx ? "#00d166" : i === currentIdx ? "#FFB800" : "#3f3f46",
                      fontWeight: i === currentIdx ? 700 : 400,
                    }}>
                    {s.label}
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1f1f22" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: i < currentIdx ? "100%" : i === currentIdx ? "60%" : "0%",
                      background: i < currentIdx ? "#00d166" : i === currentIdx
                        ? "linear-gradient(90deg, #FFB800, #FFB800 60%, transparent)" : "transparent",
                    }}
                  />
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className="w-3 h-px mt-2" style={{ background: i < currentIdx ? "#00d166" : "#1f1f22" }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t" style={{ borderColor: "#1f1f22" }}>
        <div className="px-4 py-2 flex items-center gap-1.5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-mono text-[9px] text-emerald-500 uppercase tracking-widest font-bold">Terminal Output</span>
        </div>
        <div
          ref={scrollRef}
          className="max-h-[160px] overflow-y-auto px-4 pb-3 relative"
          style={{ scrollBehavior: "smooth" }}
        >
          <div className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap"
            style={{ color: "#4ade80" }}>
            {thinkingTokens.length === 0 ? (
              <span style={{ color: "#2A2A2C" }}>Awaiting AI output...</span>
            ) : (
              thinkingTokens.join("")
            )}
            <span className="inline-block w-2 h-3.5 ml-0.5 animate-pulse" style={{ background: "#4ade80" }} />
          </div>
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
        <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
          <div style={{ height: 2, background: "linear-gradient(90deg, #FFB800, #E5A600, #FFB800)" }} />
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest"
                style={{ background: "rgba(255,184,0,0.1)", color: "#FFB800", border: "1px solid rgba(255,184,0,0.2)" }}>
                Thesis
              </span>
              {isStreaming && (
                <span className="font-mono text-[9px] text-[#52525b] animate-pulse">Streaming...</span>
              )}
            </div>
            <MarkdownResult content={isStreaming ? streamingText : narrative} />
          </div>
        </div>
      )}
    </div>
  );
}

function MarkdownResult({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-primary max-w-none text-[13px] text-[#c4c4c6] leading-relaxed
      prose-headings:text-white prose-headings:font-bold prose-headings:tracking-wide prose-headings:mt-4 prose-headings:mb-2
      prose-h2:text-base prose-h3:text-sm
      prose-a:text-[#FFB800] hover:prose-a:text-[#FFB800]/80
      prose-strong:text-white prose-strong:font-bold
      prose-li:my-0.5
      prose-code:text-[#FFB800] prose-code:bg-[#FFB800]/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
      prose-pre:bg-[#0a0a0b] prose-pre:border prose-pre:border-[#1f1f22] prose-pre:text-xs"
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

function StrategistEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 relative">
      <div className="relative z-10 flex flex-col items-center">
        <h3 className="font-mono text-lg font-bold text-white tracking-wide mb-2">Options Strategist</h3>
        <p className="font-mono text-sm font-light text-white/70 text-center leading-relaxed max-w-[280px]">
          Enter a ticker above to run AI-powered options analysis with real-time chain data.
        </p>
        <div className="flex items-center gap-5 mt-5">
          {["Regime Detection", "Chain Scanning", "AI Thesis"].map(label => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#FFB800" }} />
              <span className="font-mono text-xs font-light text-white/70 uppercase tracking-wider">{label}</span>
            </div>
          ))}
        </div>
      </div>
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

export function StrategySettings() {
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

          <div className="mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
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
  pulseDashRef?: React.RefObject<MarketPulseDashboardHandle | null>;
}

export function AiIntelligenceTab({ subTab, onSubTabChange, pulseDashRef }: AiIntelligenceTabProps) {
  const {
    symbol, setSymbol, accessToken,
    aiFeatureSettings,
    strategistResult, setStrategistResult,
    stratAutopilot, stratMaxRisk, stratMinPoP, stratMinRR,
    stratBias, stratPremium, stratAvoidEarnings,
    preTradeEnabled, preTradeBlockOnRed, preTradeMinRR,
    preTradeMaxPositionPct, preTradeMinDTE, accountSize,
  } = useTerminalStore();
  const aiModel = aiFeatureSettings.strategist.model;
  const aiTemp = aiFeatureSettings.strategist.temperature;

  const { cachedData: strategistCache, setCachedData: setStrategistCache } = useStrategistCache(symbol);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [activeResult, setActiveResult] = useState<"strategist" | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const [thinkingTokens, setThinkingTokens] = useState<string[]>([]);
  const [strategistAudit, setStrategistAudit] = useState<StrategistAuditData | null>(null);
  const [realStrategies, setRealStrategies] = useState<StrategyPayload[]>([]);
  const [narrativeText, setNarrativeText] = useState("");
  const [regimeInfo, setRegimeInfo] = useState<RegimeInfo | null>(null);
  const [pulseSnapshot, setPulseSnapshot] = useState<PulseSnapshot | null>(null);
  const [overrideWarning, setOverrideWarning] = useState<string | null>(null);
  const [strategistStatus, setStrategistStatus] = useState<string>("");
  const [preTradeResults, setPreTradeResults] = useState<Record<number, PreTradeResult>>({});
  const [lastRunSymbol, setLastRunSymbol] = useState<string | null>(null);
  const [lastRunTime, setLastRunTime] = useState<number | null>(null);
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

  const handleRunStrategist = useCallback(async (targetTicker?: string) => {
    if (!accessToken) return;

    const runSymbol = targetTicker?.toUpperCase() || symbol;
    if (targetTicker && targetTicker.toUpperCase() !== symbol) {
      setSymbol(targetTicker.toUpperCase());
    }

    const runId = ++strategistRunRef.current;
    setStrategistResult(null);
    setStrategistAudit(null);
    setStreamingText("");
    setIsStreaming(false);
    setIsStrategizing(true);
    setActiveResult("strategist");
    setRealStrategies([]);
    setNarrativeText("");
    setRegimeInfo(null);
    setPulseSnapshot(null);
    setOverrideWarning(null);
    setThinkingTokens([]);
    setPreTradeResults({});
    setStrategistStatus("Running market pulse engine...");
    setLastRunSymbol(runSymbol);
    setLastRunTime(Date.now());

    const snap = useTerminalStore.getState();
    const currentBias = snap.stratBias;
    const currentAiModel = snap.aiFeatureSettings.strategist.model;
    const currentAiTemp = snap.aiFeatureSettings.strategist.temperature;

    const collected: StrategistCacheData = {
      strategies: [],
      narrative: "",
      regime: null,
      pulse: null,
      overrideWarning: null,
      audit: null,
      thinkingTokens: [],
      resultStatus: null,
      timestamp: 0,
    };

    try {
      setStrategistStatus("Classifying regime & scanning chain...");
      const res = await fetchWithAuth(`${API_BASE}/ai/options-strategist/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: runSymbol,
          accessToken,
          model: currentAiModel,
          temperature: currentAiTemp,
          todayEdge: currentBias === "auto" ? undefined : currentBias === "bullish" ? "BULLISH_EDGE" : currentBias === "bearish" ? "BEARISH_EDGE" : "NEUTRAL_EDGE",
        }),
      });

      if (strategistRunRef.current !== runId) return;

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        setStrategistResult(`**Error:** ${errText}`);
        setIsStrategizing(false);
        setStrategistStatus("");
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
        if (strategistRunRef.current !== runId) { reader.cancel(); return; }
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
                symbol: runSymbol,
                price: parsed.underlyingPrice ?? null,
                change: q && typeof q.netChange === "number" ? q.netChange : null,
                changePct: q && typeof q.netPercentChange === "number" ? q.netPercentChange : null,
                volume: null,
                autopilot: snap.stratAutopilot,
                maxRisk: snap.stratMaxRisk,
                minPoP: snap.stratMinPoP,
                minRR: snap.stratMinRR,
                bias: parsed.edge ?? "—",
                premium: snap.stratPremium,
                avoidEarnings: snap.stratAvoidEarnings,
                chainCallCount: 0,
                chainPutCount: 0,
                model: currentAiModel,
                temperature: currentAiTemp,
                timestamp: Date.now(),
              };
              setStrategistAudit(auditData);
              collected.audit = auditData;
            }
            if (parsed.reasoning) {
              collected.thinkingTokens.push(parsed.reasoning);
              setThinkingTokens(prev => [...prev, parsed.reasoning!]);
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
  }, [quote, accessToken, symbol, setSymbol, setStrategistResult, setStrategistCache]);

  const handleRunStrategistWithTicker = useCallback((ticker: string) => {
    handleRunStrategist(ticker);
  }, [handleRunStrategist]);

  const isPendingAny = isStreaming || isStrategizing;

  const currentResult = activeResult === "strategist" ? strategistResult : null;

  const hasRealStrategies = realStrategies.length > 0;

  return (
    <div className="flex flex-col gap-0 w-full max-w-5xl mx-auto pb-6 flex-1" style={{ minHeight: "calc(var(--vvh, 100vh) - 200px)" }}>
      {subTab === "pulse" && (
        <MarketPulseDashboard ref={pulseDashRef} />
      )}

      {subTab === "strategist" && (
        <div className="px-3 sm:px-4 lg:px-5 space-y-4 pt-3">
          <StrategistCommandBar onRun={handleRunStrategistWithTicker} disabled={isPendingAny || !accessToken}
            lastRunSymbol={lastRunSymbol} lastRunTime={lastRunTime} />

          {activeResult === "strategist" && (
            <div className="space-y-4">
              {isStrategizing && (
                <StrategistPipeline status={strategistStatus} thinkingTokens={thinkingTokens} />
              )}
              {!isStrategizing && (isStreaming || hasRealStrategies) && (
                <>
                  {(isStreaming || thinkingTokens.length > 0) && (
                    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
                      <AiThinkingFeed texts={thinkingTokens} isStreaming={isStreaming} />
                    </div>
                  )}
                  {hasRealStrategies && (
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
                  )}
                </>
              )}
              {!isStrategizing && !isStreaming && !hasRealStrategies && currentResult && currentResult !== "done" && (
                <div className="rounded-xl overflow-hidden p-4" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
                  <MarkdownResult content={currentResult} />
                </div>
              )}
            </div>
          )}

          {!activeResult && !isPendingAny && (
            <StrategistEmptyState />
          )}

          {strategistAudit && activeResult === "strategist" && !isStreaming && !isStrategizing && (
            <StrategistAuditPanel audit={strategistAudit} />
          )}
        </div>
      )}

    </div>
  );
}
