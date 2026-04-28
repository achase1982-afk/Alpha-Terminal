import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { useTerminalStore, type StrategistValidationMeta } from "@/lib/store";
import { StrategistValidationCard } from "@/components/StrategistValidationCard";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import {
  useGetQuote, useGetPriceHistory, useGetOptionChain,
} from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { startStrategistPolling, resumeAllRunningPollers } from "@/lib/strategistPoller";
import {
  BarChart2, DollarSign, Shield, TrendingUp, Scale,
  Zap, ChevronDown, AlertTriangle, CheckCircle2, XCircle, AlertCircle, Search,
  Target, Activity, Clock, Crosshair, Send, X, Minus, Plus, ArrowRight, Beaker,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MarketPulseDashboard, type MarketPulseDashboardHandle } from "@/components/market-pulse/MarketPulseDashboard";
import { StrategistAuditPanel, type StrategistAuditData } from "@/components/market-pulse/StrategistAuditPanel";
import type { AiSubTab } from "@/components/ai-tab/AiSubTabs";
import { AiThinkingFeed } from "@/components/ai-shared/AiThinkingFeed";
import { useStrategistCache, type StrategistCacheData } from "@/hooks/useStrategistCache";
import { MarketScanner, type DetCandidate } from "@/components/MarketScanner";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { AiLabStrategistView } from "@/components/AiLabStrategistView";
import { StrategistV2RecommendationCard, StrategistV2BlockCard, type StrategistV2Result as StrategistV2ResultType, type StrategistSendToOrderPayload } from "@/components/StrategistV2Card";
import { StrategistHistoryList } from "@/components/StrategistHistoryList";

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
  PINS: "Pinterest Inc.", HOOD: "Robinhood Markets",
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
  gamma: number | null;
  theta: number | null;
  vega: number | null;
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

function formatExpiration(dateStr: string, dte: number): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  try {
    const parts = dateStr.slice(0, 10).split("-");
    if (parts.length === 3) {
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return `${MONTHS[month]} ${day} (${dte} DTE)`;
      }
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return `${dateStr} (${dte} DTE)`;
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} (${dte} DTE)`;
  } catch {
    return `${dateStr} (${dte} DTE)`;
  }
}

function buildSchwabOptionSymbol(underlying: string, expirationDate: string, strike: number, type: "CALL" | "PUT"): string {
  const parts = expirationDate.slice(0, 10).split("-");
  if (parts.length !== 3) return "";
  const yy = parts[0].slice(2);
  const mm = parts[1];
  const dd = parts[2];
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  const sym = underlying.toUpperCase().padEnd(6, " ");
  return `${sym}${yy}${mm}${dd}${type === "CALL" ? "C" : "P"}${strikePadded}`;
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
          <span className="font-mono text-[11px] font-bold text-white">{display ?? `${value}%`}</span>
        </div>
      </div>
      <span className="font-mono text-[11px] text-[#71717a] uppercase tracking-wider">{label}</span>
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
  const fmtG = (v: number | null) => v != null ? v.toFixed(3) : "—";
  return (
    <div className="py-2 px-3" style={{ background: even ? "rgba(255,255,255,0.015)" : "transparent" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] w-10 text-center py-0.5 rounded font-bold" style={{ color: actionColor }}>
            {leg.action}
          </span>
          <span className="font-mono text-[11px] text-[#71717a] uppercase w-14">{label}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-white font-bold tabular-nums">{leg.strike}</span>
          <span className="font-mono text-[11px] text-white/60">{leg.type}</span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: "#71717a" }}>{leg.bid.toFixed(2)}/{leg.mark.toFixed(2)}/{leg.ask.toFixed(2)}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-0.5 pl-[72px]">
        <span className="font-mono text-[10px] tabular-nums" style={{ color: "#a1a1aa" }}>{'\u0394'}{leg.delta.toFixed(2)}</span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: "#52525b" }}>{'\u0393'}{fmtG(leg.gamma)}</span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: "#52525b" }}>{'\u0398'}{leg.theta != null ? leg.theta.toFixed(2) : "—"}</span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: "#52525b" }}>{'\u03BD'}{leg.vega != null ? leg.vega.toFixed(2) : "—"}</span>
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
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: `${regimeColor}30` }}>
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-lg font-bold"
            style={{ color: regimeColor }}>
            {regimeIcon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: regimeColor }}>Market Regime</span>
            </div>
            <div className="font-mono text-sm font-bold text-white mb-1">{regimeFormatted}</div>
            <div className="font-mono text-[11px] text-[#a1a1aa] leading-relaxed">{regime.description}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {strategies.map(s => (
            <span key={s} className="font-mono text-[11px] px-2 py-1 rounded-full font-bold uppercase tracking-wider"
              style={{ color: regimeColor, border: `1px solid ${regimeColor}25` }}>
              {s}
            </span>
          ))}
        </div>

        {pulse && (
          <div className="mt-3 pt-2 border-t" style={{ borderColor: `${regimeColor}15` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[11px] text-[#3f3f46] uppercase tracking-wider">Confidence</span>
              <span className="font-mono text-[11px] font-bold" style={{ color: regimeColor }}>{pulse.confidence}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1f1f22" }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pulse.confidence}%`, background: `linear-gradient(90deg, ${regimeColor}80, ${regimeColor})` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 mt-2.5">
          <span className="font-mono text-[11px] text-[#52525b]">
            <Clock className="w-3 h-3 inline mr-1 -mt-px" />{regime.dteRange.min}–{regime.dteRange.max} DTE
          </span>
          <span className="font-mono text-[11px] text-[#52525b]">
            <Crosshair className="w-3 h-3 inline mr-1 -mt-px" />{'\u0394'}{regime.deltaTargets.shortStrike}
          </span>
          {pulse?.timestamp && (
            <span className="font-mono text-[11px] text-[#3f3f46] ml-auto">
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
    <div className="rounded-xl border border-yellow-500/30 px-4 py-3 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg border border-yellow-500/20 flex items-center justify-center shrink-0">
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
      <span className="font-mono text-[11px] text-red-400/80 leading-relaxed">
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
    <div className="mx-4 mb-3 rounded-lg border overflow-hidden" style={{ borderColor: `${overallColor}30` }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${overallColor}20` }}>
        <div className="flex items-center gap-2">
          {STATUS_ICONS[result.overall]}
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: overallColor }}>
            Pre-Trade: {overallLabel}
          </span>
        </div>
        <span className="font-mono text-[11px] text-[#52525b]">
          {result.passCount}P / {result.warnCount}W / {result.failCount}F
        </span>
      </div>
      <div className="px-3 py-1.5">
        {result.checks.map(c => (
          <div key={c.id} className="flex items-center justify-between py-1 border-b border-[#2A2A2C]/30 last:border-0">
            <div className="flex items-center gap-1.5">
              {STATUS_ICONS[c.status]}
              <span className="font-mono text-[11px] text-[#a1a1aa]">{c.label}</span>
            </div>
            <span className="font-mono text-[11px] font-bold text-white tabular-nums">{c.value}</span>
          </div>
        ))}
      </div>
      {result.aiOneLiner && (
        <div className="px-3 py-2 border-t" style={{ borderColor: `${overallColor}15` }}>
          <span className="font-mono text-[11px] text-[#a1a1aa] italic">{result.aiOneLiner}</span>
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
    <span className="font-mono text-[11px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
      style={{ color: badgeColor, border: `1px solid ${badgeColor}25` }}>
      {label}
    </span>
  );
}

function OrderReviewPanel({ strategy, symbol, onClose }: { strategy: StrategyPayload; symbol: string; onClose: () => void }) {
  const [quantity, setQuantity] = useState(strategy.contracts);
  const [limitPrice, setLimitPrice] = useState(Math.abs(strategy.net_credit));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountHash, setAccountHash] = useState<string | null>(null);

  const isCredit = strategy.net_credit > 0;
  const stratType = strategy.strategy_type.toLowerCase().replace(/\s+/g, "_").toUpperCase();

  useEffect(() => {
    fetchWithAuth("/api/portfolio/account-hash")
      .then(r => r.json())
      .then(d => { if (d.hashValue) setAccountHash(d.hashValue); })
      .catch(() => {});
  }, []);

  const allLegs = [
    { leg: strategy.short_leg, label: "Short" },
    { leg: strategy.long_leg, label: strategy.long_leg.action === "SELL" ? "Short 2" : "Long" },
    ...(strategy.short_leg_2 ? [{ leg: strategy.short_leg_2, label: "Short Call" }] : []),
    ...(strategy.long_leg_2 ? [{ leg: strategy.long_leg_2, label: "Long Call" }] : []),
  ].filter(({ leg }) => leg.strike > 0);

  const handleSubmit = async () => {
    if (!accountHash) { setError("No account connected"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const orderLegCollection = allLegs.map(({ leg }) => ({
        instruction: leg.action === "SELL" ? "SELL_TO_OPEN" : "BUY_TO_OPEN",
        quantity,
        instrument: {
          symbol: buildSchwabOptionSymbol(symbol, strategy.expiration_date, leg.strike, leg.type),
          assetType: "OPTION",
        },
      }));

      const order: Record<string, unknown> = {
        orderType: isCredit ? "NET_CREDIT" : "NET_DEBIT",
        session: "NORMAL",
        duration: "DAY",
        complexOrderStrategyType: "NONE",
        orderStrategyType: "SINGLE",
        orderLegCollection,
      };
      if (limitPrice > 0) order.price = parseFloat(limitPrice.toFixed(2));

      const res = await fetchWithAuth("/api/portfolio/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountHash,
          order,
          journalContext: {
            symbol,
            strategyType: stratType,
            direction: isCredit ? "SELL" : "BUY",
            entryPrice: limitPrice,
            isCredit,
            maxLoss: strategy.max_loss,
            maxGain: strategy.max_profit,
            quantity,
            legs: allLegs.map(({ leg }) => ({
              action: leg.action,
              strike: leg.strike,
              type: leg.type,
            })),
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || data.error || `Order rejected (${res.status})`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setError(data.message || data.error);
      } else {
        setSubmitted(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-4 mb-4 rounded-lg overflow-hidden" style={{ border: "1px solid rgba(0,209,102,0.3)", background: "rgba(0,209,102,0.06)" }}>
        <div className="px-4 py-6 flex flex-col items-center gap-3">
          <CheckCircle2 className="w-8 h-8 text-[#00d166]" />
          <span className="font-mono text-sm font-bold text-[#00d166]">ORDER SUBMITTED</span>
          <span className="font-mono text-[11px] text-[#a1a1aa]">Check Portfolio tab for status</span>
          <button onClick={onClose}
            className="font-mono text-[11px] font-bold px-4 py-2 rounded-lg mt-2"
            style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>
            CLOSE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-4 rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,184,0,0.3)", background: "#0c0c0c" }}>
      <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,184,0,0.15)" }}>
        <span className="font-mono text-[11px] font-bold text-[#FFB800] uppercase tracking-widest">Order Review</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="font-mono text-[10px] text-zinc-600 uppercase">Symbol</span>
            <p className="font-mono text-sm font-bold text-white">{symbol}</p>
          </div>
          <div>
            <span className="font-mono text-[10px] text-zinc-600 uppercase">Strategy</span>
            <p className="font-mono text-sm font-bold text-white">{strategy.strategy_type}</p>
          </div>
          <div>
            <span className="font-mono text-[10px] text-zinc-600 uppercase">Expiration</span>
            <p className="font-mono text-sm font-bold text-white">{formatExpiration(strategy.expiration_date, strategy.days_to_expiration)}</p>
          </div>
          <div>
            <span className="font-mono text-[10px] text-zinc-600 uppercase">Order Type</span>
            <p className="font-mono text-sm font-bold text-white">Limit · Day</p>
          </div>
        </div>

        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #2A2A2C" }}>
          <div className="px-3 py-1.5" style={{ background: "#0a0a0a", borderBottom: "1px solid #2A2A2C" }}>
            <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">Legs</span>
          </div>
          {allLegs.map(({ leg, label }, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-3" style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent" }}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold" style={{ color: leg.action === "SELL" ? "#f23645" : "#00d166" }}>{leg.action}</span>
                <span className="font-mono text-[11px] text-zinc-500">{label}</span>
              </div>
              <span className="font-mono text-xs text-white tabular-nums">{leg.strike} {leg.type}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="font-mono text-[10px] text-zinc-600 uppercase mb-1 block">Quantity</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-7 h-7 rounded flex items-center justify-center border border-zinc-700 hover:border-zinc-500 transition-colors">
                <Minus className="w-3 h-3 text-zinc-400" />
              </button>
              <input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-14 text-center font-mono text-sm font-bold bg-transparent border border-zinc-700 rounded py-1 text-white tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button onClick={() => setQuantity(quantity + 1)}
                className="w-7 h-7 rounded flex items-center justify-center border border-zinc-700 hover:border-zinc-500 transition-colors">
                <Plus className="w-3 h-3 text-zinc-400" />
              </button>
            </div>
          </div>
          <div>
            <span className="font-mono text-[10px] text-zinc-600 uppercase mb-1 block">Limit Price</span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm text-zinc-500">$</span>
              <input type="number" step={0.01} min={0.01} value={limitPrice.toFixed(2)}
                onChange={e => setLimitPrice(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                className="w-20 font-mono text-sm font-bold bg-transparent border border-zinc-700 rounded py-1 px-2 text-white tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="font-mono text-[11px] text-zinc-500">
            {isCredit ? "Net Credit" : "Net Debit"}: <span className="text-white font-bold">${(limitPrice * quantity * 100).toFixed(2)}</span>
          </div>
          <div className="font-mono text-[11px] text-zinc-500">
            Max Risk: <span className="text-[#f23645] font-bold">{fmtDollar(Math.abs(strategy.max_loss) * quantity)}</span>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(242,54,69,0.08)", border: "1px solid rgba(242,54,69,0.3)" }}>
            <XCircle className="w-3.5 h-3.5 text-[#f23645] shrink-0" />
            <span className="font-mono text-[11px] text-[#f23645]">{error}</span>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 font-mono text-[11px] font-bold py-2.5 rounded-lg uppercase tracking-wider transition-colors hover:bg-zinc-800"
            style={{ color: "#a1a1aa", border: "1px solid #2A2A2C" }}>
            Cancel
          </button>
          <button onClick={handleSubmit}
            disabled={submitting || !accountHash}
            className="flex-1 font-mono text-[11px] font-bold py-2.5 rounded-lg uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#FFB800", color: "#0c0c0c" }}>
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-[#0c0c0c] border-t-transparent rounded-full animate-spin" />
                Submitting...
              </span>
            ) : "Submit Order"}
          </button>
        </div>

        {!accountHash && (
          <div className="flex justify-center">
            <ConnectBrokerPrompt label="Connect Brokerage To Submit Orders" compact />
          </div>
        )}
      </div>
    </div>
  );
}

function RealStrategyCard({ s, idx, preTradeResult, symbol }: { s: StrategyPayload; idx: number; preTradeResult?: PreTradeResult | null; symbol: string }) {
  const [showTradePlan, setShowTradePlan] = useState(false);
  const [showOrderReview, setShowOrderReview] = useState(false);
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
          <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ background: "#151517", borderBottom: "1px solid #2A2A2C" }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center font-mono text-xs font-bold shrink-0"
                style={{ color: accentColor }}>
                {idx + 1}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold text-white">{s.strategy_type}</span>
                  <span className="font-mono text-[11px] text-white/60 tabular-nums">{
                    [s.short_leg, s.long_leg, s.short_leg_2, s.long_leg_2]
                      .filter(l => l && l.strike > 0)
                      .map(l => l!.strike)
                      .join("/")
                  } {s.short_leg.type === s.long_leg.type ? s.short_leg.type : ""}</span>
                  <RiskCategoryBadge evaluation={re} />
                </div>
                <span className="font-mono text-[11px] text-[#52525b]">{formatExpiration(s.expiration_date, s.days_to_expiration)}</span>
              </div>
            </div>
          </div>

          {s.undefined_risk && <UndefinedRiskWarning />}
          {preTradeResult && <PreTradeCheckPanel result={preTradeResult} />}

          {s.risk_reward_display && (
            <div className="mx-4 mt-3 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,107,43,0.06)", border: "1px solid rgba(255,107,43,0.2)" }}>
              <span className="font-mono text-[11px] text-[#FF6B2B] font-bold">{s.risk_reward_display}</span>
            </div>
          )}

          <div className="mx-4 mt-3 rounded-lg overflow-hidden" style={{ border: "1px solid #2A2A2C" }}>
            <div className="px-3 py-1.5" style={{ background: "#0c0c0c", borderBottom: "1px solid #2A2A2C" }}>
              <span className="font-mono text-[11px] text-[#3f3f46] uppercase tracking-widest">Contract Legs</span>
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
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[#52525b]">{m.label}</span>
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
                <span className="font-mono text-[11px] text-[#52525b] uppercase tracking-wider">Breakeven</span>
                <span className="font-mono text-[11px] text-white tabular-nums">{fmtDollar(s.breakeven)}{s.breakeven_upper ? ` / ${fmtDollar(s.breakeven_upper)}` : ""}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-[#52525b] uppercase tracking-wider">Size</span>
                <span className="font-mono text-[11px] text-white">{s.contracts} contract{s.contracts > 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>

          <div className="mx-4 mb-3">
            <button
              type="button"
              onClick={() => setShowTradePlan(!showTradePlan)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg font-mono text-[11px] text-[#52525b] uppercase tracking-widest hover:text-[#a1a1aa] transition-colors"
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
                  <span className="font-mono text-[11px] text-[#52525b] uppercase">Profit Target</span>
                  <span className="font-mono text-[11px] text-[#00d166] font-bold">{s.exit_rules.profit_target_pct}% ({fmtDollar(s.exit_rules.profit_target_amount)})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-[#52525b] uppercase">Stop Loss</span>
                  <span className="font-mono text-[11px] text-[#f23645] font-bold">{fmtDollar(s.exit_rules.stop_loss_amount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-[#52525b] uppercase">Time Exit</span>
                  <span className="font-mono text-[11px] text-[#a1a1aa]">{s.exit_rules.time_exit}</span>
                </div>
              </div>
            )}
          </div>

          {showOrderReview ? (
            <OrderReviewPanel strategy={s} symbol={symbol} onClose={() => setShowOrderReview(false)} />
          ) : (
            <div className="mx-4 mb-4">
              <button
                type="button"
                onClick={() => setShowOrderReview(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg font-mono text-[11px] font-bold uppercase tracking-wider transition-all hover:brightness-110 active:scale-[0.98]"
                style={{ background: "#FFB800", color: "#0c0c0c" }}
              >
                <Send className="w-3.5 h-3.5" />
                Send Order
              </button>
            </div>
          )}
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
  const [tickerPcRatio, setTickerPcRatio] = useState<number | null>(null);
  const [tickerIvr, setTickerIvr] = useState<number | null>(null);
  const [tickerIvrAsOfDate, setTickerIvrAsOfDate] = useState<string | null>(null);
  const [tickerIvrSource, setTickerIvrSource] = useState<string | null>(null);
  const [tickerMmm, setTickerMmm] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyNameRef = useRef<HTMLDivElement>(null);
  const [companyNameSize, setCompanyNameSize] = useState("text-base");
  const streamPricesRef = useRef(streamPrices);
  streamPricesRef.current = streamPrices;

  const displaySymbol = previewTicker || symbol;
  const liveQuote = streamPrices[displaySymbol];

  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

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
    const ac = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(
          `/api/market/quote?symbol=${encodeURIComponent(typed)}`,
          { signal: ac.signal },
        );
        if (!res.ok) {
          setFetchingTicker(false);
          return;
        }
        const data = await res.json();
        if (ac.signal.aborted) return;
        if (data?.last != null) {
          setPreviewQuote({ last: data.last, change: data.change ?? 0, changePct: data.changePct ?? 0, volume: data.volume });
        } else {
          setPreviewQuote(null);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPreviewQuote(null);
      }
      setFetchingTicker(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      ac.abort();
    };
  }, [inputVal]);

  useEffect(() => {
    const ticker = (inputVal.trim().toUpperCase()) || symbol;
    if (!ticker) {
      setTickerPcRatio(null);
      setTickerIvr(null);
      setTickerIvrAsOfDate(null);
      setTickerIvrSource(null);
      setTickerMmm(null);
      return;
    }
    setTickerPcRatio(null);
    setTickerIvr(null);
    setTickerIvrAsOfDate(null);
    setTickerIvrSource(null);
    setTickerMmm(null);
    if (pcDebounceRef.current) clearTimeout(pcDebounceRef.current);
    const ac = new AbortController();
    pcDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ symbol: ticker });
        const draft = inputVal.trim().toUpperCase();
        if (draft) params.set("lite", "1");
        const res = await fetchWithAuth(`/api/market/ticker-stats?${params.toString()}`, { signal: ac.signal });
        if (!res.ok || ac.signal.aborted) return;
        const data = await res.json();
        if (ac.signal.aborted) return;
        if (data?.pcRatio != null) setTickerPcRatio(data.pcRatio);
        if (data?.ivr != null) setTickerIvr(data.ivr);
        if (data?.ivrAsOfDate != null) setTickerIvrAsOfDate(data.ivrAsOfDate);
        if (data?.ivrSource != null) setTickerIvrSource(data.ivrSource);
        if (data?.mmm != null) setTickerMmm(data.mmm);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }, 300);
    return () => {
      if (pcDebounceRef.current) clearTimeout(pcDebounceRef.current);
      ac.abort();
    };
  }, [inputVal, symbol]);

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
  const pcRatio = tickerPcRatio;

  const companyName = COMPANY_NAMES[displaySymbol.toUpperCase()] ?? displaySymbol;
  useLayoutEffect(() => {
    const el = companyNameRef.current;
    if (!el) return;
    el.style.fontSize = "16px";
    const isOneLine = el.scrollHeight <= el.clientHeight + 2;
    setCompanyNameSize(isOneLine ? "text-base" : "text-xs");
  }, [companyName]);

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="rounded-xl overflow-hidden transition-all duration-300"
        style={{
          background: "#111113",
          border: `1px solid ${isFocused ? "rgba(255,184,0,0.5)" : "#2A2A2C"}`,
          boxShadow: "none",
        }}
      >
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #1f1f22" }}>
          <div>
            <div className="font-mono text-xl font-normal text-white tracking-wide leading-tight">{displaySymbol}</div>
            <div ref={companyNameRef} className={`font-mono ${companyNameSize} font-normal text-[#FFB800] tracking-wide leading-tight`} style={{ maxHeight: "2.6em", overflow: "hidden" }}>{companyName}</div>
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
        <div className="px-4 pb-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/40 uppercase tracking-wider">Vol</span>
            <span className="font-mono text-sm text-white/70 tabular-nums">
              {volume != null ? Math.round(volume).toLocaleString() : "—"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/40 uppercase tracking-wider">P/C</span>
            <span className="font-mono text-sm text-white/70 tabular-nums">{pcRatio != null ? pcRatio.toFixed(2) : "—"}</span>
          </div>
          {tickerIvr != null && (() => {
            const isProxy = tickerIvrSource === "hv_proxy";
            const label = isProxy ? "IVR (est.)" : "IVR (EOD)";
            const baseTitle = tickerIvrAsOfDate
              ? `IV Rank, as of ${tickerIvrAsOfDate} (252-day window)`
              : "IV Rank (252-day window)";
            const title = isProxy
              ? `${baseTitle}. Source: realized-vol proxy (HV30 × VRP) — accumulating chain-based history; expect refinement as more days collect.`
              : `${baseTitle}. Source: ${tickerIvrSource ?? "EOD chain"} (Black-Scholes IV).`;
            return (
              <div className="flex items-center gap-2" title={title}>
                <span className="font-mono text-sm text-white/40 uppercase tracking-wider">{label}</span>
                <span className="font-mono text-sm tabular-nums" style={{ color: tickerIvr > 50 ? "#FFB800" : tickerIvr < 30 ? "#00d166" : "#a1a1aa" }}>
                  {`${tickerIvr}%`}
                </span>
              </div>
            );
          })()}
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/40 uppercase tracking-wider">MMM</span>
            <span className="font-mono text-sm text-white/70 tabular-nums">
              {tickerMmm != null ? `±$${tickerMmm.toFixed(2)}` : "—"}
            </span>
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
            className="p-[10px] rounded-lg font-mono text-[13px] font-bold tracking-widest shrink-0 transition-all duration-200 uppercase
              disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: "#18181b",
              color: disabled ? "#52525b" : "#FFB800",
              border: "none",
            }}
          >
            Analyze
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
    { key: "ai", label: "REASONING", icon: <Zap className="w-3 h-3" /> },
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
            <span className="font-mono text-[11px] font-bold text-[#FFB800] uppercase tracking-widest">Analyzing</span>
            <span className="font-mono text-[11px] text-[#FFB800]/60 tabular-nums">{Math.round(((currentIdx + (currentIdx < 2 ? 0.6 : 0.3)) / 3) * 100)}%</span>
          </div>
          <span className="font-mono text-[11px] text-[#52525b] tabular-nums">
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
                  <span className="font-mono text-[11px] tracking-wider"
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
          <span className="font-mono text-[11px] text-emerald-500 uppercase tracking-widest font-bold">Terminal Output</span>
        </div>
        <div
          ref={scrollRef}
          className="max-h-[160px] overflow-y-auto px-4 pb-3 relative"
          style={{ scrollBehavior: "smooth" }}
        >
          <div className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
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

function StrategistResultView({ strategies, narrative, isStreaming, streamingText, regime, pulse, overrideWarning, preTradeResults, symbol }: {
  strategies: StrategyPayload[];
  narrative: string;
  isStreaming: boolean;
  streamingText: string;
  regime?: RegimeInfo | null;
  pulse?: PulseSnapshot | null;
  overrideWarning?: string | null;
  preTradeResults?: Record<number, PreTradeResult>;
  symbol: string;
}) {
  return (
    <div className="space-y-4">
      {regime && <RegimeDisplayBanner regime={regime} pulse={pulse ?? undefined} />}
      {overrideWarning && <OverrideWarningBanner message={overrideWarning} />}
      {strategies.map((s, i) => (
        <RealStrategyCard key={i} s={s} idx={i} preTradeResult={preTradeResults?.[i]} symbol={symbol} />
      ))}
      {(narrative || streamingText) && (
        <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
          <div style={{ height: 2, background: "linear-gradient(90deg, #FFB800, #E5A600, #FFB800)" }} />
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest"
                style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.2)" }}>
                Thesis
              </span>
              {isStreaming && (
                <span className="font-mono text-[11px] text-[#52525b] animate-pulse">Streaming...</span>
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
      prose-code:text-[#FFB800] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
      prose-pre:bg-[#0a0a0b] prose-pre:border prose-pre:border-[#1f1f22] prose-pre:text-xs"
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

function StrategistShockBanner() {
  const { pulseData } = useMarketPulseStore();
  const shockState = pulseData?.shockState ?? "NORMAL";
  if (shockState !== "ACTIVE" && shockState !== "WARNING") return null;
  const isActive = shockState === "ACTIVE";
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
      isActive ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30"
    }`}>
      <AlertTriangle className={`w-5 h-5 shrink-0 ${isActive ? "text-red-400" : "text-amber-400"}`} />
      <div>
        <p className={`font-mono text-xs font-bold uppercase tracking-wider ${isActive ? "text-red-400" : "text-amber-400"}`}>
          {isActive ? "Regime Shock Active — Hedging Only" : "Regime Shock Warning — Reduced Size"}
        </p>
        <p className={`font-mono text-[10px] mt-0.5 ${isActive ? "text-red-400/70" : "text-amber-400/70"}`}>
          {isActive
            ? "Strategist locked to protective hedges only. No directional entries."
            : "Elevated regime stress detected. Position sizes will be reduced."}
        </p>
      </div>
    </div>
  );
}

function StrategistEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 relative">
      <div className="relative z-10 flex flex-col items-center">
        <h3 className="font-mono text-lg font-bold text-white tracking-wide mb-2">Options Strategist</h3>
        <p className="font-mono text-sm font-light text-white/70 text-center leading-relaxed max-w-[280px]">
          Enter a ticker above to run options analysis with real-time chain data.
        </p>
        <div className="flex items-center gap-5 mt-5">
          {["Regime Detection", "Chain Scanning", "Thesis"].map(label => (
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

interface DetPremiumGate {
  gate: string;
  passed: boolean;
  detail: string;
}

interface DetEventConflict {
  eventType: string;
  eventTitle: string;
  date: string;
  dateFormatted: string;
  time?: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  ticker?: string;
}

interface DetStrategyCriteria {
  strategyType: string;
  direction: string;
  ticker: string;
  dteRange: { min: number; max: number };
  deltaTargets: { shortStrike: number; longStrike: number };
  spreadWidth: number;
  positionSize: string;
  profitTargetPct: number;
  stopLossMultiple: number;
  maxContracts: number;
  eventConflicts: DetEventConflict[];
  hardBlocks: string[];
  warnings: string[];
  mode: string;
  modeReason: string;
  premiumGates: DetPremiumGate[];
  premiumSellingApproved: boolean;
}

interface ResolvedLeg {
  type: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  executable_price: number;
  delta: number;
  open_interest: number;
  volume: number;
  schwabSymbol?: string;
}

interface ResolvedTrade {
  schema_version: string;
  ticker: string;
  strategy: string;
  direction: "BULLISH" | "BEARISH";
  expiration: string;
  dte: number;
  legs: [ResolvedLeg, ResolvedLeg];
  pricing: {
    type: "debit" | "credit";
    executable_amount: number;
    mid_amount: number;
    display: string;
  };
  risk: {
    max_loss_per_contract: number;
    max_gain_per_contract: number;
    breakeven: number;
    profit_target_spread_value: number;
    profit_target_display: string;
    stop_loss_spread_value: number;
    stop_loss_display: string;
  };
  sizing: {
    recommended_contracts: number;
    total_risk: number;
    total_max_gain: number;
    size_modifier: string;
    account_net_liq: number;
    available_buying_power: number;
    max_risk_per_trade: number;
  };
  warnings: string[];
  as_of_timestamp: string;
  chain_source: "live" | "cache" | "previous_close";
  source: string;
  micro_override: boolean;
  scanner_score: number | null;
}

interface StrikeResolutionError {
  error: true;
  error_code: string;
  user_message: string;
  fallback_params: DetStrategyCriteria | null;
}

interface DetStrategistResult {
  criteria: DetStrategyCriteria | null;
  rejection: string | null;
  mode: string;
  modeReason: string;
  pulse: { composite: number; confidence: number; bias: string };
  shockActive: boolean;
  portfolio: { microOverrideCount: number };
  tickerData?: { price: number; sma20: number | null; atr14: number | null; ivr: number; optionsLiquidity: string };
  narrative: string;
  resolvedTrade?: ResolvedTrade | null;
  resolutionError?: StrikeResolutionError | null;
}

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  HIGH_CONVICTION_DIRECTIONAL: { label: "MODE 1: HIGH CONVICTION", color: "#26a69a" },
  LOW_CONVICTION_DIRECTIONAL: { label: "MODE 2: LOW CONVICTION", color: "#FFB800" },
  MICRO_OVERRIDE: { label: "MODE 3: MICRO-OVERRIDE", color: "#7c3aed" },
  HEDGING_DEFENSIVE: { label: "MODE 4: HEDGING", color: "#f23645" },
  NO_EDGE: { label: "NO EDGE", color: "#71717a" },
};

const STRATEGY_LABELS: Record<string, string> = {
  BULL_PUT_SPREAD: "Bull Put Spread",
  BEAR_CALL_SPREAD: "Bear Call Spread",
  BULL_CALL_SPREAD: "Bull Call Spread",
  BEAR_PUT_SPREAD: "Bear Put Spread",
  IRON_CONDOR: "Iron Condor",
  PROTECTIVE_PUT: "Protective Put",
};

function DetModeBadge({ mode }: { mode: string }) {
  const cfg = MODE_LABELS[mode] ?? MODE_LABELS["NO_EDGE"];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-[11px] font-bold uppercase tracking-wider"
      style={{ background: `${cfg.color}20`, color: cfg.color, border: `1px solid ${cfg.color}40` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
      {cfg.label}
    </span>
  );
}

function DetPremiumGatesPanel({ gates }: { gates: DetPremiumGate[] }) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Premium Selling Gates</p>
      {gates.map((g, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
          {g.passed
            ? <CheckCircle2 className="w-3.5 h-3.5 text-[#26a69a] shrink-0" />
            : <XCircle className="w-3.5 h-3.5 text-[#f23645] shrink-0" />}
          <span className={g.passed ? "text-zinc-300" : "text-zinc-400"}>{g.gate}</span>
          <span className="text-zinc-600 ml-auto text-[10px] max-w-[200px] text-right truncate">{g.detail}</span>
        </div>
      ))}
    </div>
  );
}

function AiNarrativePanel({ text, streamingText, isStreaming }: {
  text: string; streamingText: string; isStreaming: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming) { setCollapsed(false); }
  }, [isStreaming]);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && (text || streamingText)) {
      const timer = setTimeout(() => setCollapsed(true), 900);
      prevStreamingRef.current = false;
      return () => clearTimeout(timer);
    }
    if (isStreaming) prevStreamingRef.current = true;
    return;
  }, [isStreaming, text, streamingText]);

  const displayText = isStreaming ? streamingText : text;
  if (!displayText && !isStreaming) return null;

  if (collapsed && !isStreaming) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors hover:opacity-80"
        style={{ background: "#111113", border: "1px solid #2A2A2C" }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex rounded-full h-2 w-2 bg-[#FFB800]/50" />
          <span className="font-mono text-[11px] font-bold text-[#FFB800]/70 tracking-widest">AI NARRATIVE</span>
        </div>
        <span className="font-mono text-[10px] text-zinc-600 tracking-wider">tap to expand</span>
      </button>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid #1a1a1c" }}>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FFB800]" />
            </span>
          ) : (
            <span className="inline-flex rounded-full h-2 w-2 bg-[#FFB800]/50" />
          )}
          <span className="font-mono text-[11px] font-bold text-[#FFB800]/70 tracking-widest">
            AI NARRATIVE
            {isStreaming && <span className="ml-2 text-[#52525b] font-normal animate-pulse">streaming...</span>}
          </span>
        </div>
        {!isStreaming && (
          <button
            onClick={() => setCollapsed(true)}
            className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors tracking-wider"
          >
            collapse
          </button>
        )}
      </div>
      <div className="px-4 py-3">
        <div className="font-mono text-[12px] text-zinc-300 leading-relaxed">
          <ReactMarkdown>{displayText}</ReactMarkdown>
          {isStreaming && <span className="inline-block w-2 h-4 bg-[#FFB800] animate-pulse ml-0.5" />}
        </div>
      </div>
    </div>
  );
}

// Renders the structured Solo/Debate transcript: round headers + per-turn
// chips (A=gold, B=cyan, synthesis=green) with a streaming caret on the
// active turn. One single box, color-coded; collapses to fall back when the
// turn list is empty.
function DebateTranscript({
  transcript,
  isStreaming,
  defaultCollapsed = false,
  title = "Bull · Bear Debate",
}: {
  transcript: import("@/lib/store").StrategistTranscriptTurn[];
  isStreaming: boolean;
  defaultCollapsed?: boolean;
  title?: string;
}) {
  const groups = useMemo(() => {
    const m = new Map<1 | 2 | 3 | "synthesis", typeof transcript>();
    for (const t of transcript) {
      const key = t.round;
      if (!m.has(key)) m.set(key, [] as unknown as typeof transcript);
      (m.get(key) as typeof transcript).push(t);
    }
    return Array.from(m.entries());
  }, [transcript]);

  const roleStyle = (role: string): { bg: string; fg: string; border: string; label: string } => {
    switch (role) {
      case "A":
        return { bg: "rgba(255,184,0,0.12)", fg: "#FFB800", border: "rgba(255,184,0,0.4)", label: "Bull Case" };
      case "B":
        return { bg: "rgba(38,198,218,0.12)", fg: "#26C6DA", border: "rgba(38,198,218,0.4)", label: "Bear Case" };
      case "synthesis":
        return { bg: "rgba(0,209,102,0.12)", fg: "#00D166", border: "rgba(0,209,102,0.4)", label: "Recommendation" };
      case "system":
        return { bg: "rgba(186,130,255,0.10)", fg: "#BA82FF", border: "rgba(186,130,255,0.45)", label: "Verdict" };
      case "solo":
        // Solo validator wears both hats — distinct neutral cyan-blue so the
        // user knows this is a single-model pass, not a Bull/Bear debate.
        return { bg: "rgba(120,180,255,0.10)", fg: "#78B4FF", border: "rgba(120,180,255,0.4)", label: "Solo Validator" };
      default:
        return { bg: "rgba(255,255,255,0.06)", fg: "#999", border: "rgba(255,255,255,0.15)", label: "" };
    }
  };

  const phaseLabel = (phase: string, round: 1 | 2 | 3 | "synthesis", role: string): string => {
    if (role === "system" && phase === "info") return "Verdict";
    if (role === "solo" || phase === "solo") return "Solo Validation · Single Pass";
    if (round === "synthesis") return "Phase 3 · Senior PM Arbitration";
    if (round === 3 && phase === "propose") return "Phase 2 · R3 · Structure Vote";
    if (phase === "propose") return `Phase 1 · R${round} · Pitch`;
    if (phase === "critique") return `Phase 1 · R${round} · Rebut`;
    if (phase === "final") return `Phase 3 · Trade Build`;
    return phase;
  };

  const roundHeader = (round: 1 | 2 | 3 | "synthesis"): string => {
    if (round === "synthesis") return "Phase 3 — Senior PM Arbitration (Final Trade)";
    if (round === 1) return "Phase 1 — Round 1 (Directional Pitch)";
    if (round === 2) return "Phase 1 — Round 2 (Rebuttal & Verdict)";
    return "Phase 2 — Round 3 (Trade Structure Vote)";
  };

  // Pretty-print a turn's text as JSON when possible (the new debate flow has
  // every LLM emit JSON). Falls back to raw text for any non-JSON output.
  const formatTurnText = (raw: string): string => {
    if (!raw) return "";
    const stripped = raw.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) return raw;
    try {
      const obj = JSON.parse(stripped.slice(start, end + 1));
      return JSON.stringify(obj, null, 2);
    } catch {
      return raw;
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript]);

  // Collapse behavior: expanded while the run is streaming so the user can
  // watch live, then auto-collapses once the run finishes (mirrors the prior
  // CollapsibleAiReasoning pattern). User can manually toggle either way.
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed || !isStreaming);
  const wasStreamingRef = useRef<boolean>(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      // streaming just ended → collapse
      setCollapsed(true);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Derive a short summary for the collapsed header (verdict + turn count).
  const summary = useMemo(() => {
    const turnCount = transcript.length;
    const verdictTurn = [...transcript].reverse().find((t) => t.role === "system" && t.phase === "info");
    let verdict: string | null = null;
    if (verdictTurn) {
      try {
        const parsed = JSON.parse(verdictTurn.text.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim());
        if (parsed && typeof parsed.verdict === "string") verdict = parsed.verdict;
      } catch {
        /* noop */
      }
    }
    if (turnCount === 0) return "no turns yet";
    if (verdict) return `${verdict} · ${turnCount} turns`;
    return `${turnCount} turns`;
  }, [transcript]);

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    // Institutional copy payload — strip role/phase/label/model attribution.
    // Full attribution is preserved in the strategist_telemetry table and the
    // direct API endpoint; the user-facing copy is just round + content.
    const payload = transcript.map((t) => ({
      round: t.round,
      text: formatTurnText(t.text),
    }));
    const text = JSON.stringify(payload, null, 2);
    const writeFallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* noop */
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        writeFallback,
      );
    } else {
      writeFallback();
    }
  };

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "#0c0c0e", border: "1px solid rgba(255,184,0,0.18)" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{ borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.06)" }}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-label={collapsed ? "Expand debate transcript" : "Collapse debate transcript"}
        >
          <span className="font-mono text-[11px] text-[#FFB800] leading-none">
            {collapsed ? "▸" : "▾"}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#FFB800]">
            {title}
          </span>
          {isStreaming && (
            <span className="w-2 h-2 rounded-full bg-[#FFB800] animate-pulse" />
          )}
          <span className="font-mono text-[10px] text-[#888] truncate">· {summary}</span>
        </button>
        <button
          onClick={handleCopy}
          disabled={transcript.length === 0}
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded transition-colors disabled:opacity-40 shrink-0"
          style={{
            background: copied ? "rgba(0,209,102,0.15)" : "rgba(255,184,0,0.10)",
            border: `1px solid ${copied ? "rgba(0,209,102,0.5)" : "rgba(255,184,0,0.4)"}`,
            color: copied ? "#00D166" : "#FFB800",
          }}
        >
          {copied ? "✓ Copied" : "⧉ Copy JSON"}
        </button>
      </div>
      {!collapsed && (
      <div ref={scrollRef} className="p-4 max-h-[360px] overflow-y-auto space-y-4">
      {groups.map(([round, turns], gi) => (
        <div key={String(round)} className="space-y-3">
          <div
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#888]"
            style={{
              paddingTop: gi === 0 ? 0 : 8,
              borderTop: gi === 0 ? "none" : "1px dashed rgba(255,255,255,0.08)",
            }}
          >
            {roundHeader(round)}
          </div>
          {turns.map((t) => {
            const style = roleStyle(t.role);
            const showCaret = isStreaming && !t.done;
            return (
              <div key={t.id} className="pl-3" style={{ borderLeft: `2px solid ${style.fg}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: style.fg }}>
                    {style.label}
                  </span>
                  <span className="ml-auto font-mono text-[9px] text-[#666]">{phaseLabel(t.phase, t.round, t.role)}</span>
                </div>
                <pre className="font-mono text-[11px] leading-[1.55] text-[#ddd] whitespace-pre-wrap break-words m-0">
                  {formatTurnText(t.text) || (showCaret ? "" : <span className="text-[#666]">(no output)</span>)}
                  {showCaret && (
                    <span className="inline-block w-[7px] h-[12px] ml-0.5 align-middle" style={{ background: style.fg }} />
                  )}
                </pre>
              </div>
            );
          })}
        </div>
      ))}
      </div>
      )}
    </div>
  );
}

function CollapsibleAiReasoning({ detThinking, isDetStreaming, detNarrative, detStreamingText }: {
  detThinking: string[];
  isDetStreaming: boolean;
  detNarrative: string;
  detStreamingText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = detThinking.length > 0 || detNarrative || detStreamingText;
  if (!hasContent && !isDetStreaming) return null;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 transition-colors hover:opacity-80"
      >
        <div className="flex items-center gap-2">
          {isDetStreaming ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FFB800]" />
            </span>
          ) : (
            <span className="inline-flex rounded-full h-2 w-2 bg-[#FFB800]/50" />
          )}
          <span className="font-mono text-[11px] font-bold text-[#FFB800]/70 tracking-widest">
            REASONING
            {isDetStreaming && <span className="ml-2 text-[#52525b] font-normal animate-pulse">streaming...</span>}
          </span>
        </div>
        <span className="font-mono text-[10px] text-zinc-600 tracking-wider">
          {expanded ? "collapse" : "tap to expand"}
        </span>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid #1a1a1c" }}>
          {detThinking.length > 0 && (
            <AiThinkingFeed texts={detThinking} isStreaming={isDetStreaming} />
          )}
          {(detNarrative || detStreamingText) && (
            <div className="px-4 py-3">
              <div className="font-mono text-[12px] text-zinc-300 leading-relaxed">
                <ReactMarkdown>{isDetStreaming ? detStreamingText : detNarrative}</ReactMarkdown>
                {isDetStreaming && <span className="inline-block w-2 h-4 bg-[#FFB800] animate-pulse ml-0.5" />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetRiskOverviewCard({ result }: { result: DetStrategistResult }) {
  const [expanded, setExpanded] = useState(false);
  const { resolvedTrade, criteria } = result;
  if (!resolvedTrade) return null;

  const allWarnings = [
    ...(criteria?.warnings ?? []),
    ...(resolvedTrade.warnings ?? []),
  ].filter(w => !w.startsWith("EARNINGS:"));

  const hasBlocks = (criteria?.hardBlocks?.length ?? 0) > 0;
  const overallStatus = hasBlocks ? "FAIL" : allWarnings.length > 0 ? "WARN" : "PASS";
  const statusColor = overallStatus === "PASS" ? "#00d166" : overallStatus === "WARN" ? "#FFB800" : "#f23645";

  const totalLoss = resolvedTrade.sizing.total_risk;
  const rrRatio = resolvedTrade.risk.max_loss_per_contract > 0
    ? (resolvedTrade.risk.max_gain_per_contract / resolvedTrade.risk.max_loss_per_contract).toFixed(1)
    : "—";

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: `1px solid ${statusColor}20` }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-400">RISK OVERVIEW</span>
          <span className="font-mono text-[11px] text-zinc-600">·</span>
          <span className="font-mono text-[11px] text-[#f23645]">Loss ${totalLoss.toLocaleString()}</span>
          <span className="font-mono text-[11px] text-zinc-600">·</span>
          <span className="font-mono text-[11px] text-zinc-400">R:R {rrRatio}:1</span>
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ color: statusColor, background: `${statusColor}15`, border: `1px solid ${statusColor}30` }}>
            {overallStatus}
          </span>
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-600 shrink-0 transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid #1a1a1c" }}>
          <div className="pt-3">
            {criteria?.premiumGates && criteria.premiumGates.length > 0 && (
              <div className="mb-3">
                <DetPremiumGatesPanel gates={criteria.premiumGates} />
              </div>
            )}

            {allWarnings.length > 0 && (
              <div className="space-y-1.5 mb-3">
                <p className="font-mono text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Warnings</p>
                {allWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 font-mono text-[11px] text-zinc-400">
                    <AlertCircle className="w-3.5 h-3.5 text-[#FFB800] shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {criteria?.modeReason && (
              <div className="mb-3">
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Mode Reason</p>
                <p className="font-mono text-[11px] text-zinc-400 leading-relaxed">{criteria.modeReason}</p>
              </div>
            )}

            {(criteria?.eventConflicts?.length ?? 0) > 0 && !hasBlocks && (
              <div>
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Events in DTE Window</p>
                {criteria!.eventConflicts.map((e, i) => (
                  <p key={i} className="font-mono text-[11px] text-amber-400/70">{e.eventTitle} ({e.dateFormatted})</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetCriteriaCard({ result, onSendToOrder }: {
  result: DetStrategistResult;
  onSendToOrder?: (trade: ResolvedTrade) => void;
}) {
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const { criteria, resolvedTrade, resolutionError } = result;
  if (!criteria) return null;

  const dirColor = criteria.direction === "BULLISH" ? "#26a69a" : criteria.direction === "BEARISH" ? "#f23645" : "#FFB800";

  const allWarnings = [
    ...criteria.warnings,
    ...(resolvedTrade?.warnings ?? []),
  ];
  const earningsWarnings = allWarnings.filter(w => w.startsWith("EARNINGS:"));
  const otherWarnings = allWarnings.filter(w => !w.startsWith("EARNINGS:"));

  const earningsConflict = criteria.eventConflicts.find(e =>
    e.eventType?.toLowerCase().includes("earn") || e.eventTitle?.toLowerCase().includes("earn")
  );
  const earningsLabel = earningsConflict?.dateFormatted
    ?? (earningsWarnings.length > 0 ? earningsWarnings[0].replace(/^EARNINGS:\s*/i, "") : null);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      {resolvedTrade?.chain_source === "previous_close" && (
        <div className="px-4 py-2 flex items-center gap-2 border-b" style={{ background: "rgba(255,184,0,0.08)", borderColor: "rgba(255,184,0,0.2)" }}>
          <Clock className="w-3.5 h-3.5 text-[#FFB800] shrink-0" />
          <p className="font-mono text-[11px] text-[#FFB800] font-bold">Market closed — prices from last session</p>
        </div>
      )}
      {criteria.hardBlocks.length > 0 && (
        <div className="px-4 py-2 flex items-start gap-2 border-b" style={{ background: "rgba(242,54,69,0.08)", borderColor: "rgba(242,54,69,0.2)" }}>
          <AlertTriangle className="w-3.5 h-3.5 text-[#f23645] shrink-0 mt-0.5" />
          <div>
            <p className="font-mono text-[11px] font-bold text-[#f23645] uppercase">Event Block</p>
            {criteria.hardBlocks.map((b, i) => (
              <p key={i} className="font-mono text-[10px] text-[#f23645]/80 mt-0.5">{b}</p>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-bold text-white">{criteria.ticker}</span>
            <span className="font-mono text-sm font-bold" style={{ color: dirColor }}>{criteria.direction}</span>
          </div>
          <DetModeBadge mode={criteria.mode} />
        </div>

        {resolvedTrade ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Strategy</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{resolvedTrade.strategy}</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Expiration</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{resolvedTrade.expiration} / {resolvedTrade.dte} DTE</p>
                {earningsLabel && (
                  <p className="font-mono text-[10px] font-bold mt-0.5" style={{ color: "#fb923c" }}>⚠ EARNINGS {earningsLabel.toUpperCase()}</p>
                )}
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Contracts</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{resolvedTrade.sizing.recommended_contracts}</p>
                <p className="font-mono text-[9px] text-zinc-500 mt-0.5">{resolvedTrade.sizing.size_modifier} size</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">{resolvedTrade.pricing.type === "debit" ? "Net Debit" : "Net Credit"}</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">${resolvedTrade.pricing.executable_amount.toFixed(2)}</p>
                <p className="font-mono text-[9px] text-zinc-500 mt-0.5">mid: ${resolvedTrade.pricing.mid_amount.toFixed(2)}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              {resolvedTrade.legs.map((leg, i) => (
                <div key={i} className="flex items-center gap-3 bg-[#0a0a0a] rounded-lg px-3 py-2 border border-[#1a1a1c]">
                  <span className={`font-mono text-[11px] font-bold uppercase px-2 py-0.5 rounded ${leg.action === "buy" ? "bg-[#26a69a]/15 text-[#26a69a]" : "bg-[#f23645]/15 text-[#f23645]"}`}>
                    {leg.action}
                  </span>
                  <span className="font-mono text-sm font-bold text-white">${leg.strike}</span>
                  <span className="font-mono text-[11px] text-zinc-400 uppercase">{leg.type}</span>
                  <span className="font-mono text-[11px] text-zinc-500 ml-auto">${leg.executable_price.toFixed(2)}</span>
                  <span className="font-mono text-[10px] text-zinc-600">{"\u0394"}{Math.abs(leg.delta).toFixed(2)}</span>
                  <span className="font-mono text-[10px] text-zinc-600">OI:{leg.open_interest.toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Max Risk</p>
                <p className="font-mono text-sm font-bold text-[#f23645] mt-0.5">${resolvedTrade.sizing.total_risk.toLocaleString()}</p>
                <p className="font-mono text-[9px] text-zinc-500 mt-0.5">${resolvedTrade.risk.max_loss_per_contract}/contract</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Max Gain</p>
                <p className="font-mono text-sm font-bold text-[#26a69a] mt-0.5">${resolvedTrade.sizing.total_max_gain.toLocaleString()}</p>
                <p className="font-mono text-[9px] text-zinc-500 mt-0.5">${resolvedTrade.risk.max_gain_per_contract}/contract</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Breakeven</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">${resolvedTrade.risk.breakeven.toFixed(2)}</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">R:R Ratio</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">
                  1:{resolvedTrade.risk.max_loss_per_contract > 0 ? (resolvedTrade.risk.max_gain_per_contract / resolvedTrade.risk.max_loss_per_contract).toFixed(1) : "—"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg px-3 py-2 border" style={{ background: "rgba(38,166,154,0.06)", borderColor: "rgba(38,166,154,0.35)" }}>
                <p className="font-mono text-[10px] text-[#26a69a] uppercase font-bold">Profit Target</p>
                <p className="font-mono text-sm font-bold text-[#26a69a] mt-0.5">{resolvedTrade.risk.profit_target_display}</p>
              </div>
              <div className="rounded-lg px-3 py-2 border" style={{ background: "rgba(242,54,69,0.06)", borderColor: "rgba(242,54,69,0.35)" }}>
                <p className="font-mono text-[10px] text-[#f23645] uppercase font-bold">Stop Loss</p>
                <p className="font-mono text-sm font-bold text-[#f23645] mt-0.5">{resolvedTrade.risk.stop_loss_display}</p>
              </div>
            </div>

            {otherWarnings.length > 0 && (
              <div className="rounded-lg overflow-hidden">
                <button
                  onClick={() => setWarningsExpanded(e => !e)}
                  className="w-full flex items-center justify-between px-3 py-2"
                  style={{ background: "#f5c518" }}
                >
                  <span className="font-mono text-[12px] font-bold text-black">⚠ {otherWarnings.length} warning{otherWarnings.length !== 1 ? "s" : ""}</span>
                  <span className="font-mono text-[10px] text-black/70 font-bold">{warningsExpanded ? "collapse" : "tap to view"}</span>
                </button>
                {warningsExpanded && (
                  <div className="px-3 pb-2 pt-1.5 space-y-1" style={{ background: "#f5c518", borderTop: "1px solid rgba(0,0,0,0.1)" }}>
                    {otherWarnings.map((w, i) => (
                      <p key={i} className="font-mono text-[11px] text-black leading-relaxed">• {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Strategy</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{STRATEGY_LABELS[criteria.strategyType] ?? criteria.strategyType}</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">DTE Range</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{criteria.dteRange.min}-{criteria.dteRange.max}d</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Deltas</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{criteria.deltaTargets.shortStrike}/{criteria.deltaTargets.longStrike}</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Width</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">${criteria.spreadWidth}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Size</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{criteria.positionSize}</p>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-1.5 border border-[#1a1a1c]">
                <p className="font-mono text-[10px] text-zinc-600 uppercase">Max Contracts</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{criteria.maxContracts}</p>
              </div>
              <div className="rounded-lg px-3 py-1.5 border" style={{ background: "rgba(38,166,154,0.06)", borderColor: "rgba(38,166,154,0.35)" }}>
                <p className="font-mono text-[10px] text-[#26a69a] uppercase font-bold">Profit Target</p>
                <p className="font-mono text-sm font-bold text-[#26a69a] mt-0.5">{criteria.profitTargetPct}%</p>
              </div>
              <div className="rounded-lg px-3 py-1.5 border" style={{ background: "rgba(242,54,69,0.06)", borderColor: "rgba(242,54,69,0.35)" }}>
                <p className="font-mono text-[10px] text-[#f23645] uppercase font-bold">Stop Loss</p>
                <p className="font-mono text-sm font-bold text-[#f23645] mt-0.5">{criteria.stopLossMultiple}x credit</p>
              </div>
            </div>

            {resolutionError && (
              <div className="bg-[#0a0a0a] rounded-lg px-3 py-2.5 border border-[#f23645]/30">
                <p className="font-mono text-[10px] text-[#f23645] uppercase font-bold mb-1">Strike Resolution Failed</p>
                <p className="font-mono text-[11px] text-zinc-300">{resolutionError.user_message}</p>
              </div>
            )}

            {otherWarnings.length > 0 && (
              <div className="rounded-lg overflow-hidden">
                <button
                  onClick={() => setWarningsExpanded(e => !e)}
                  className="w-full flex items-center justify-between px-3 py-2"
                  style={{ background: "#f5c518" }}
                >
                  <span className="font-mono text-[12px] font-bold text-black">⚠ {otherWarnings.length} warning{otherWarnings.length !== 1 ? "s" : ""}</span>
                  <span className="font-mono text-[10px] text-black/70 font-bold">{warningsExpanded ? "collapse" : "tap to view"}</span>
                </button>
                {warningsExpanded && (
                  <div className="px-3 pb-2 pt-1.5 space-y-1" style={{ background: "#f5c518", borderTop: "1px solid rgba(0,0,0,0.1)" }}>
                    {otherWarnings.map((w, i) => (
                      <p key={i} className="font-mono text-[11px] text-black leading-relaxed">• {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DetRejectionCard({ result }: { result: DetStrategistResult }) {
  const modeInfo = MODE_LABELS[result.mode] ?? MODE_LABELS["NO_EDGE"];
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="px-4 py-6 flex flex-col items-center text-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${modeInfo.color}15`, border: `1px solid ${modeInfo.color}30` }}>
          <Scale className="w-5 h-5" style={{ color: modeInfo.color }} />
        </div>
        <DetModeBadge mode={result.mode} />
        <p className="font-mono text-sm text-zinc-300 leading-relaxed max-w-md">{result.rejection ?? result.modeReason}</p>
        <p className="font-mono text-[11px] text-zinc-600 mt-1">No actionable edge. Cash is a position.</p>
        {result.mode === "NO_EDGE" && result.portfolio.microOverrideCount >= 2 && (
          <p className="font-mono text-[10px] text-amber-400/70 mt-1">
            Micro-Override limit: {result.portfolio.microOverrideCount}/2 positions open
          </p>
        )}
        {result.pulse && (
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-[10px] text-zinc-600">Pulse: {result.pulse.composite.toFixed(2)}</span>
            <span className="font-mono text-[10px] text-zinc-600">Conf: {result.pulse.confidence}</span>
            <span className="font-mono text-[10px] text-zinc-600">Bias: {result.pulse.bias}</span>
          </div>
        )}
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
          className="flex-1 font-mono text-[11px] py-1.5 px-2 transition-colors"
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
        <span className="font-mono text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Strategy Settings</span>
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
            <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Max Risk Per Trade</span>
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
            <span className="font-mono text-[11px] text-zinc-500">$50</span>
            <span className="font-mono text-[11px] text-zinc-500">$10,000</span>
          </div>
        </div>

        <div style={{ opacity: locked ? 0.35 : 1 }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Min Probability of Profit</span>
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
            <span className="font-mono text-[11px] text-zinc-500">60%</span>
            <span className="font-mono text-[11px] text-zinc-500">95%</span>
          </div>
        </div>

        <div className="flex items-center justify-between" style={{ opacity: locked ? 0.35 : 1 }}>
          <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Min R/R Ratio</span>
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
            <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div style={{ opacity: locked ? 0.35 : 1 }}>
          <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider block mb-1.5">Directional Bias</span>
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
          <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider block mb-1.5">Premium Type</span>
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
            <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Avoid Earnings / Catalyst</span>
          </div>
          <ToggleSwitch checked={stratAvoidEarnings} onChange={setStratAvoidEarnings} disabled={locked} />
        </div>

        <div className="border-t border-card-border pt-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-3.5 h-3.5 text-[#FFB800]" />
            <span className="font-mono text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Pre-Trade Risk Manager</span>
          </div>

          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Enable Risk Checks</span>
            <ToggleSwitch checked={preTradeEnabled} onChange={setPreTradeEnabled} />
          </div>

          <div className="flex items-center justify-between mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Block on RED</span>
            <ToggleSwitch checked={preTradeBlockOnRed} onChange={setPreTradeBlockOnRed} disabled={!preTradeEnabled} />
          </div>

          <div className="mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Account Size</span>
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
              <span className="font-mono text-[11px] text-zinc-500">$5K</span>
              <span className="font-mono text-[11px] text-zinc-500">$500K</span>
            </div>
          </div>

          <div className="mb-3" style={{ opacity: preTradeEnabled ? 1 : 0.35 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Min R/R</span>
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
              <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Max Position %</span>
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
              <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Min DTE</span>
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
  subscribeEquitySymbols?: (syms: string[]) => void;
  onNavigateToMarkets?: (sym: string) => void;
  onSendToOrder?: (trade: ResolvedTrade) => void;
  onStrategistSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
  // Reopen the OrderTicket pre-loaded with the validated ticket so the user
  // can route around (or honor) the strategist's verdict.
  onReopenValidatedOrder?: (meta: StrategistValidationMeta) => void;
}

const AI_TABS: AiSubTab[] = ["pulse", "strategist", "scanner"];

type StrategistMode = "options" | "ailab";

export function AiIntelligenceTab({ subTab, onSubTabChange, pulseDashRef, subscribeEquitySymbols, onNavigateToMarkets, onSendToOrder, onStrategistSendToOrder, onReopenValidatedOrder }: AiIntelligenceTabProps) {
  const [strategistMode, setStrategistMode] = useState<StrategistMode>("options");
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeLocked = useRef<"h" | "v" | null>(null);
  const swipeDelta = useRef(0);

  const handleSwipeStart = useCallback((e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    swipeLocked.current = null;
    swipeDelta.current = 0;
  }, []);

  const handleSwipeMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = e.touches[0].clientY - swipeStartY.current;
    if (!swipeLocked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        swipeLocked.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
    }
    if (swipeLocked.current === "h") {
      swipeDelta.current = dx;
    }
  }, []);

  const handleSwipeEnd = useCallback(() => {
    if (swipeLocked.current === "h" && Math.abs(swipeDelta.current) > 60) {
      const idx = AI_TABS.indexOf(subTab);
      if (swipeDelta.current < 0 && idx < AI_TABS.length - 1) {
        onSubTabChange(AI_TABS[idx + 1]);
      } else if (swipeDelta.current > 0 && idx > 0) {
        onSubTabChange(AI_TABS[idx - 1]);
      }
    }
    swipeLocked.current = null;
    swipeDelta.current = 0;
  }, [subTab, onSubTabChange]);
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

  const [detResult, setDetResult] = useState<DetStrategistResult | null>(null);
  const [detNarrative, setDetNarrative] = useState("");
  const [detStreamingText, setDetStreamingText] = useState("");
  const [isDetStreaming, setIsDetStreaming] = useState(false);
  const [isDetRunning, setIsDetRunning] = useState(false);
  const [detThinking, setDetThinking] = useState<string[]>([]);
  const detRunRef = useRef(0);
  const scannerCandidateCache = useRef<Record<string, DetCandidate>>({});

  const strategistJobs = useTerminalStore(s => s.strategistJobs);
  const strategistHistory = useTerminalStore(s => s.strategistHistory);
  const startStrategistJob = useTerminalStore(s => s.startStrategistJob);
  const completeStrategistJob = useTerminalStore(s => s.completeStrategistJob);
  const errorStrategistJob = useTerminalStore(s => s.errorStrategistJob);
  const markStrategistJobsViewed = useTerminalStore(s => s.markStrategistJobsViewed);
  const setStrategistHistoryStore = useTerminalStore(s => s.setStrategistHistory);

  // Derive the active jobId for the current symbol from the store so it
  // survives component unmount/remount (e.g. when user switches bottom tabs).
  //
  // Two-tier fallback so the most recent strategist run stays visible even
  // when the global `symbol` drifts (e.g. user clicks a scanner row, opens
  // OrderTicket for a different ticker, or just types a new symbol in the
  // command bar):
  //   1. Prefer the most-recent job whose ticker matches the current symbol.
  //   2. If none, fall back to the most-recent job overall, provided it is
  //      either still running OR finished within the last RECENT_JOB_MS.
  // This prevents the "ran a scan, navigated away, came back to a blank tab,
  // then typed another ticker and the old result popped up" UX.
  const RECENT_JOB_MS = 30 * 60 * 1000;
  const activeJobIdForSymbol = useMemo(() => {
    const upper = symbol.toUpperCase();
    let bestForSymbol: { id: string; startedAt: number } | null = null;
    let bestRecent: { id: string; startedAt: number } | null = null;
    const now = Date.now();
    for (const [id, job] of Object.entries(strategistJobs)) {
      if (job.ticker === upper) {
        if (!bestForSymbol || job.startedAt > bestForSymbol.startedAt) {
          bestForSymbol = { id, startedAt: job.startedAt };
        }
      }
      const isRunning = job.status === 'running';
      const finishedRecently = job.finishedAt != null && (now - job.finishedAt) < RECENT_JOB_MS;
      if (isRunning || finishedRecently) {
        if (!bestRecent || job.startedAt > bestRecent.startedAt) {
          bestRecent = { id, startedAt: job.startedAt };
        }
      }
    }
    return (bestForSymbol?.id ?? bestRecent?.id) ?? null;
  }, [strategistJobs, symbol]);

  const v2Result: StrategistV2ResultType | null = (() => {
    if (!activeJobIdForSymbol) return null;
    const job = strategistJobs[activeJobIdForSymbol];
    if (job?.status === 'done' && job.result) return job.result as StrategistV2ResultType;
    if (job?.status === 'error') {
      // Use the job's own ticker (not the current global symbol) so the
      // fallback error card stays truthful when cross-symbol fallback is
      // active (i.e. user is viewing AAPL but the only recent job was MSFT).
      return { status: "no_viable_setup", ticker: (job.ticker || symbol).toUpperCase(), blockReason: job.error || "Analysis failed", regime: { directionalConviction: "NEUTRAL", systemicRiskLevel: "NORMAL", correlationRegime: "MODERATE", compositeScore: 0, idioOpportunityFlag: false }, systemicRiskElevated: false };
    }
    return null;
  })();

  const isV2Running = activeJobIdForSymbol
    ? strategistJobs[activeJobIdForSymbol]?.status === 'running'
    : false;

  // V2 live tokens + status come from the global store so they survive
  // unmount/remount when the user navigates away from the strategist screen.
  const v2ThinkingTokens: string[] = activeJobIdForSymbol
    ? strategistJobs[activeJobIdForSymbol]?.tokens ?? []
    : [];
  const v2LiveStatus: string = activeJobIdForSymbol
    ? strategistJobs[activeJobIdForSymbol]?.liveStatus ?? ""
    : "";
  const v2Transcript = activeJobIdForSymbol
    ? strategistJobs[activeJobIdForSymbol]?.transcript ?? []
    : [];

  // Fetch history on mount AND every time the strategist sub-tab becomes
  // active. This ensures cards saved on the server always re-appear when the
  // user returns to the screen, even after a full page reload or after an
  // analysis was completed in another session.
  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/strategist/history`);
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows)) setStrategistHistoryStore(rows);
    } catch {
      // best-effort
    }
  }, [setStrategistHistoryStore]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Mark jobs as viewed and refresh history whenever the strategist sub-tab
  // becomes active.
  useEffect(() => {
    if (subTab === "strategist") {
      markStrategistJobsViewed();
      void refreshHistory();
    }
  }, [subTab, markStrategistJobsViewed, refreshHistory]);

  // Keep the pipeline status in sync with whether a job is actually running.
  // This restores the "Analyzing..." indicator when the user navigates back
  // to a tab while a background job is still in flight.
  useEffect(() => {
    if (isV2Running) {
      setStrategistStatus(prev => prev || "Running V2 strategist...");
      setActiveResult("strategist");
    } else {
      setStrategistStatus(prev => prev === "Running V2 strategist..." ? "" : prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isV2Running]);

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
    } else if (subTab !== "strategist") {
      // Only wipe the result panel when the user leaves the strategist tab.
      // When subTab === "strategist" but there is no cache yet (e.g. a fresh
      // validation job that started from the order ticket), leave activeResult
      // untouched — the isV2Running watcher sets it to "strategist" and we must
      // not override that here, otherwise the verdict card never appears.
      setThinkingTokens([]);
      setActiveResult(null);
    }
  }, [subTab]);

  const { data: quote } = useGetQuote(
    { symbol, accessToken: "" },
    { query: { enabled: !!symbol } }
  );
  const { data: history } = useGetPriceHistory(
    { symbol, accessToken: "", periodType: "month", period: 3, frequencyType: "daily", frequency: 1 },
    { query: { enabled: !!symbol } }
  );
  const { data: chain, isLoading: chainLoading } = useGetOptionChain(
    { symbol, accessToken: "", contractType: "ALL", daysToExpiration: 45, strikeCount: 20 },
    { query: { enabled: !!symbol && chainEnabled } }
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
    setDetResult(null);
    setDetNarrative("");
    setDetStreamingText("");
    setDetThinking([]);
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
          accessToken: accessToken || "",
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
              const trimmed = parsed.error.trimStart();
              const errMsg = trimmed.startsWith("{") || trimmed.startsWith("[")
                ? "Analysis unavailable. Tap Analyze to retry."
                : parsed.error;
              setStrategistResult(`**Error:** ${errMsg}`);
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
      const raw = (err instanceof Error ? err.message : String(err)).trimStart();
      const clean = raw.startsWith("{") || raw.startsWith("[")
        ? "Analysis unavailable. Tap Analyze to retry."
        : raw;
      setStrategistResult(`**Error:** ${clean}`);
      setIsStrategizing(false);
      setIsStreaming(false);
      setStrategistStatus("");
    }
  }, [quote, accessToken, symbol, setSymbol, setStrategistResult, setStrategistCache]);

  const handleRunDetStrategist = useCallback(async (sym: string, candidate?: DetCandidate) => {
    const runId = ++detRunRef.current;
    const upperSym = sym.toUpperCase();

    if (candidate) {
      scannerCandidateCache.current[upperSym] = candidate;
    }
    const resolvedCandidate = candidate || scannerCandidateCache.current[upperSym];

    setDetResult(null);
    setDetNarrative("");
    setDetStreamingText("");
    setDetThinking([]);
    setIsDetRunning(true);
    setIsDetStreaming(false);
    setActiveResult("strategist");
    setRealStrategies([]);
    setNarrativeText("");
    setStrategistResult(null);
    setStrategistStatus("Running deterministic strategist...");
    setLastRunSymbol(sym);
    setLastRunTime(Date.now());

    if (upperSym !== symbol) {
      setSymbol(upperSym);
    }

    const scannerPayload = resolvedCandidate ? {
      symbol: resolvedCandidate.symbol,
      totalScore: resolvedCandidate.totalScore,
      components: resolvedCandidate.components,
      microOverrideEligible: resolvedCandidate.microOverrideEligible,
      ivr: resolvedCandidate.ivr,
      atmSpreadPct: resolvedCandidate.atmSpreadPct,
      changePct: resolvedCandidate.changePct,
      sector: resolvedCandidate.sector,
      scanTimestamp: resolvedCandidate.scanTimestamp ?? Date.now(),
    } : undefined;

    try {
      const res = await fetchWithAuth(`${API_BASE}/ai/deterministic-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: sym.toUpperCase(),
          accessToken: accessToken || "",
          scannerData: scannerPayload,
        }),
      });

      if (detRunRef.current !== runId) return;

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        setDetResult({ criteria: null, rejection: errText, mode: "NO_EDGE", modeReason: errText, pulse: { composite: 0, confidence: 0, bias: "NO_EDGE" }, shockActive: false, portfolio: { microOverrideCount: 0 }, narrative: "" });
        setIsDetRunning(false);
        setStrategistStatus("");
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        const json = await res.json() as DetStrategistResult;
        json.narrative = "";
        setDetResult(json);
        setIsDetRunning(false);
        setStrategistStatus("");
        return;
      }

      setIsDetRunning(false);
      setIsDetStreaming(true);
      setStrategistStatus("Building AI thesis...");

      const reader = res.body?.getReader();
      if (!reader) { setIsDetStreaming(false); setStrategistStatus(""); return; }

      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (detRunRef.current !== runId) { reader.cancel(); return; }
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload) as {
              criteria?: DetStrategyCriteria;
              mode?: string;
              modeReason?: string;
              pulse?: { composite: number; confidence: number; bias: string };
              shockActive?: boolean;
              portfolio?: { microOverrideCount: number };
              tickerData?: DetStrategistResult["tickerData"];
              resolvedTrade?: ResolvedTrade;
              resolutionError?: StrikeResolutionError;
              text?: string;
              reasoning?: string;
              error?: string;
            };
            if (parsed.error) {
              const trimmed = parsed.error.trimStart();
              const errMsg = trimmed.startsWith("{") || trimmed.startsWith("[")
                ? "Analysis unavailable. Tap Analyze to retry."
                : parsed.error;
              setDetResult(prev => prev
                ? { ...prev, narrative: prev.narrative || errMsg }
                : { criteria: null, rejection: errMsg, mode: "NO_EDGE", modeReason: errMsg, pulse: { composite: 0, confidence: 0, bias: "NO_EDGE" }, shockActive: false, portfolio: { microOverrideCount: 0 }, narrative: "" }
              );
              setIsDetStreaming(false);
              setStrategistStatus("");
              return;
            }
            if (parsed.criteria) {
              setDetResult({
                criteria: parsed.criteria,
                rejection: null,
                mode: parsed.mode ?? "NO_EDGE",
                modeReason: parsed.modeReason ?? "",
                pulse: parsed.pulse ?? { composite: 0, confidence: 0, bias: "NO_EDGE" },
                shockActive: parsed.shockActive ?? false,
                portfolio: parsed.portfolio ?? { microOverrideCount: 0 },
                tickerData: parsed.tickerData,
                narrative: "",
              });
            }
            if (parsed.resolvedTrade) {
              setDetResult(prev => prev ? { ...prev, resolvedTrade: parsed.resolvedTrade } : prev);
              setStrategistStatus("Resolving strikes... done");
            }
            if (parsed.resolutionError) {
              setDetResult(prev => prev ? { ...prev, resolutionError: parsed.resolutionError } : prev);
            }
            if (parsed.reasoning) {
              setDetThinking(prev => [...prev, parsed.reasoning!]);
            }
            if (parsed.text) {
              accumulated += parsed.text;
              setDetStreamingText(accumulated);
            }
          } catch {}
        }
      }
      if (detRunRef.current !== runId) return;
      setDetNarrative(accumulated);
      if (detRunRef.current === runId) {
        setDetResult(prev => prev ? { ...prev, narrative: accumulated } : prev);
      }
      setDetStreamingText("");
      setIsDetStreaming(false);
      setStrategistStatus("");
    } catch (err) {
      setDetResult({ criteria: null, rejection: err instanceof Error ? err.message : String(err), mode: "NO_EDGE", modeReason: "Request failed", pulse: { composite: 0, confidence: 0, bias: "NO_EDGE" }, shockActive: false, portfolio: { microOverrideCount: 0 }, narrative: "" });
      setIsDetRunning(false);
      setIsDetStreaming(false);
      setStrategistStatus("");
    }
  }, [accessToken, symbol, setSymbol, setStrategistResult]);

  const handleRunV2 = useCallback((ticker: string, flowContext?: string) => {
    const upperTicker = ticker.toUpperCase();
    const jobId = `sj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setDetResult(null);
    setActiveResult("strategist");
    setRealStrategies([]);
    setNarrativeText("");
    setStrategistResult(null);
    setThinkingTokens([]);
    setStrategistStatus("Starting analysis…");
    setLastRunSymbol(ticker);
    setLastRunTime(Date.now());
    if (upperTicker !== symbol) setSymbol(upperTicker);
    // Register the job in the global store BEFORE the network round-trip so
    // the poller / UI can already reflect the running state.
    startStrategistJob(jobId, upperTicker);

    // Fire-and-forget — server runs the analysis to completion regardless of
    // client navigation. We hand off polling to a module-level driver so it
    // survives unmount/remount of this component (e.g. switching bottom tabs).
    (async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE}/strategist/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: upperTicker, jobId, ...(flowContext ? { flowContext } : {}) }),
          keepalive: true,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "Unknown error");
          errorStrategistJob(jobId, errText);
          return;
        }
        startStrategistPolling(jobId);
      } catch (err) {
        errorStrategistJob(jobId, err instanceof Error ? err.message : String(err));
      }
    })();
  }, [symbol, setSymbol, setStrategistResult, startStrategistJob, errorStrategistJob]);

  // On mount (and whenever the set of *running* job IDs changes), make sure
  // every job that is still in the "running" state has a poller attached.
  // This handles the case where the user navigated away and came back: the
  // component re-mounts but the in-flight server-side analysis must still
  // drive the UI to completion. startStrategistPolling is idempotent per
  // jobId so calling it for an already-polled job is a no-op.
  const runningJobIdsKey = useMemo(
    () =>
      Object.entries(strategistJobs)
        .filter(([, j]) => j.status === "running")
        .map(([id]) => id)
        .sort()
        .join(","),
    [strategistJobs],
  );
  useEffect(() => {
    if (!runningJobIdsKey) return;
    for (const jobId of runningJobIdsKey.split(",")) {
      if (jobId) startStrategistPolling(jobId);
    }
  }, [runningJobIdsKey]);

  // Mobile browsers (iOS Safari especially) throttle setTimeout chains in
  // backgrounded tabs, which freezes the in-flight poller. When the page
  // returns to the foreground, force-restart every running poller so the
  // analysis catches up immediately instead of waiting for the throttled
  // loop to drain. Same goes for explicit remounts of this component.
  useEffect(() => {
    resumeAllRunningPollers();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        resumeAllRunningPollers();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);

  const handleRunStrategistWithTicker = useCallback((ticker: string) => {
    handleRunV2(ticker);
  }, [handleRunV2]);

  const isPendingAny = isStreaming || isStrategizing || isDetRunning || isDetStreaming || isV2Running;

  const currentResult = activeResult === "strategist" ? strategistResult : null;

  const hasRealStrategies = realStrategies.length > 0;

  const pageIdx = AI_TABS.indexOf(subTab);

  return (
    <div
      className="flex flex-col gap-0 w-full max-w-5xl mx-auto pb-6 flex-1"
      style={{ minHeight: "calc(var(--vvh, 100vh) - 200px)", overflow: "hidden", touchAction: "pan-y" }}
      onTouchStart={handleSwipeStart}
      onTouchMove={handleSwipeMove}
      onTouchEnd={handleSwipeEnd}
      onTouchCancel={handleSwipeEnd}
    >
      <div
        style={{
          display: "flex",
          transform: `translateX(${-pageIdx * 100}%)`,
          transition: "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          willChange: "transform",
          height: "100%",
        }}
      >
        <div style={{ width: "100%", flexShrink: 0, height: "100%", overflowY: "auto" }}>
          <MarketPulseDashboard ref={pulseDashRef} />
        </div>

        <div style={{ width: "100%", flexShrink: 0, height: "100%", overflowY: "auto" }}>
          <div className="px-3 sm:px-4 lg:px-5 space-y-4 pt-3">
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="flex border-b border-card-border">
              {([["options", "OPTIONS STRATEGIST"], ["ailab", "AI LAB"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStrategistMode(key)}
                  className={`flex-1 py-3 text-sm font-bold uppercase tracking-widest transition-all border-b-2 ${
                    strategistMode === key
                      ? "bg-[#18181B] text-white border-b-[#FFB800]"
                      : "bg-transparent text-muted-foreground border-b-transparent hover:text-foreground hover:bg-secondary/20"
                  }`}
                >
                  <span className="flex items-center justify-center gap-2">
                    {key === "options" ? <Crosshair className="w-3.5 h-3.5" /> : <Beaker className="w-3.5 h-3.5" />}
                    {label}
                  </span>
                </button>
              ))}
            </div>
            </div>

            {strategistMode === "ailab" && <AiLabStrategistView />}

            {strategistMode === "options" && (
            <>
            <StrategistShockBanner />
            <StrategistCommandBar onRun={handleRunStrategistWithTicker} disabled={false}
              lastRunSymbol={lastRunSymbol} lastRunTime={lastRunTime} />

            {/* Live AI reasoning sits directly beneath the ticker bar.
                Auto-collapses when the run finishes; expand to view + copy. */}
            {(isV2Running || v2ThinkingTokens.length > 0 || v2Transcript.length > 0) &&
              /* Suppress the standalone transcript once a validation job completes —
                 the new StrategistValidationCard renders its own collapsible transcript. */
              (isV2Running || !(activeJobIdForSymbol && strategistJobs[activeJobIdForSymbol]?.kind === "validation")) && (
              <div className="space-y-2">
                {isV2Running && (v2LiveStatus || strategistStatus) && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg"
                    style={{ background: "#111113", border: "1px solid rgba(255,184,0,0.2)" }}>
                    <span className="w-3 h-3 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
                    <span className="font-mono text-[11px] text-[#FFB800] tracking-wider">{v2LiveStatus || strategistStatus}</span>
                  </div>
                )}
                {v2Transcript.length > 0 ? (
                  <DebateTranscript transcript={v2Transcript} isStreaming={isV2Running} />
                ) : (
                  <AiThinkingFeed texts={v2ThinkingTokens} isStreaming={isV2Running} />
                )}
              </div>
            )}

            {activeResult === "strategist" && (
              <div className="space-y-4">
                {(isDetRunning || isStrategizing) && (
                  <StrategistPipeline status={strategistStatus} thinkingTokens={isDetRunning ? detThinking : thinkingTokens} />
                )}

                {v2Result && !isV2Running && (() => {
                  const activeJob = activeJobIdForSymbol ? strategistJobs[activeJobIdForSymbol] : null;
                  const generatedAt = activeJob?.finishedAt ?? activeJob?.startedAt ?? null;
                  // Validation jobs render a verdict card; the v2Result here
                  // is actually a ValidationVerdictPayload (the poller stores
                  // whatever /thinking returns as `result`).
                  if (activeJob?.kind === "validation") {
                    return (
                      <StrategistValidationCard
                        result={v2Result as unknown}
                        meta={activeJob.validationMeta ?? null}
                        onReopenOrder={onReopenValidatedOrder}
                        generatedAt={generatedAt}
                        transcript={v2Transcript}
                      />
                    );
                  }
                  return (
                    <>
                      {v2Result.status === "recommendation" && v2Result.recommendation ? (
                        <StrategistV2RecommendationCard result={v2Result} onSendToOrder={onStrategistSendToOrder} generatedAt={generatedAt} />
                      ) : (
                        <StrategistV2BlockCard result={v2Result} generatedAt={generatedAt} />
                      )}
                    </>
                  );
                })()}

                {detResult && !isDetRunning && !v2Result && (
                  <>
                    {detResult.criteria ? (
                      <>
                        <DetCriteriaCard
                          result={detResult}
                          onSendToOrder={onSendToOrder}
                        />
                        {detResult.resolvedTrade && onSendToOrder ? (
                          <button
                            onClick={() => onSendToOrder(detResult.resolvedTrade!)}
                            className="flex items-center justify-center gap-2 w-full px-4 py-3.5 rounded-xl font-mono text-[14px] font-bold uppercase tracking-wider transition-all active:scale-[0.98]"
                            style={{ background: "linear-gradient(135deg, #f5a623, #ffce73)", color: "#050607" }}
                          >
                            <ArrowRight className="w-4 h-4" />
                            SEND TO ORDER
                          </button>
                        ) : detResult.criteria && (
                          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                            style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
                            <Shield className="w-4 h-4 text-zinc-600" />
                            <span className="font-mono text-[11px] text-zinc-600">
                              {detResult.resolutionError ? "Strike resolution failed — cannot place order" : "Resolving strikes..."}
                            </span>
                          </div>
                        )}
                        <DetRiskOverviewCard result={detResult} />
                      </>
                    ) : (
                      <DetRejectionCard result={detResult} />
                    )}
                    <CollapsibleAiReasoning
                      detThinking={detThinking}
                      isDetStreaming={isDetStreaming}
                      detNarrative={detNarrative}
                      detStreamingText={detStreamingText}
                    />
                  </>
                )}

                {!detResult && !isDetRunning && !isStrategizing && (isStreaming || hasRealStrategies) && (
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
                        symbol={lastRunSymbol ?? ""}
                      />
                    )}
                  </>
                )}
                {!detResult && !isDetRunning && !isStrategizing && !isStreaming && !hasRealStrategies && currentResult && currentResult !== "done" && (
                  <div className="rounded-xl overflow-hidden p-4" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
                    <MarkdownResult content={currentResult} />
                  </div>
                )}
              </div>
            )}

            {!activeResult && !isPendingAny && (
              <StrategistEmptyState />
            )}

            {strategistAudit && activeResult === "strategist" && !isStreaming && !isStrategizing && !detResult && (
              <StrategistAuditPanel audit={strategistAudit} />
            )}

            {/* Recent strategies history — always at the bottom so the active trade
                card stays directly under the reasoning feed. Excludes the currently
                active job so it doesn't duplicate the live card above. */}
            <StrategistHistoryList
              onSendToOrder={onStrategistSendToOrder}
              onReopenValidatedOrder={onReopenValidatedOrder}
              excludeJobIds={activeJobIdForSymbol ? new Set([activeJobIdForSymbol]) : undefined}
            />
            </>
            )}
          </div>
        </div>

        <div style={{ width: "100%", flexShrink: 0, height: "100%", overflowY: "auto" }}>
          <MarketScanner
            subscribeEquitySymbols={subscribeEquitySymbols ?? (() => {})}
            onNavigateToSymbol={onNavigateToMarkets ?? (() => {})}
            onSendToStrategist={(sym: string, _candidate?: DetCandidate, flowContext?: string) => {
              useTerminalStore.getState().setSymbol(sym);
              setStrategistMode("options");
              onSubTabChange("strategist");
              setTimeout(() => {
                handleRunV2(sym, flowContext);
              }, 500);
            }}
          />
        </div>

      </div>
    </div>
  );
}
