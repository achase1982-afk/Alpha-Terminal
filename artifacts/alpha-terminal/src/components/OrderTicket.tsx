import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  X, Minus, Plus, Loader2, CheckCircle2, AlertTriangle, ChevronDown,
  Shield, ShieldAlert, ShieldCheck, ShieldX, Settings2, Lock, Unlock,
  Eye, EyeOff, Sparkles, TrendingUp,
} from "lucide-react";

type OrderSide = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | "TRAILING_STOP";
type Duration = "DAY" | "GOOD_TILL_CANCEL" | "FILL_OR_KILL";
type ConfirmStage = "form" | "review" | "submitting" | "success" | "error";
type RiskLevel = "GREEN" | "YELLOW" | "RED";
type PositionEffect = "OPENING" | "CLOSING" | "AUTO";

const ORDER_TYPES: { value: OrderType; label: string; short: string }[] = [
  { value: "MARKET", label: "Market", short: "MKT" },
  { value: "LIMIT", label: "Limit", short: "LMT" },
  { value: "STOP", label: "Stop", short: "STP" },
  { value: "STOP_LIMIT", label: "Stop Limit", short: "STP LMT" },
  { value: "TRAILING_STOP", label: "Trail Stop", short: "TRAIL" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "GOOD_TILL_CANCEL", label: "GTC" },
  { value: "FILL_OR_KILL", label: "FOK" },
];

const GOLD = "#fbbf24";
const GOLD_DIM = "rgba(251,191,36,0.12)";
const UP = "#00d166";
const DOWN = "#f23645";
const BG = "#1C1C1E";
const BG2 = "#111113";
const CARD = "#141416";
const FIELD = "#1a1a1e";
const BORDER = "#1f1f23";
const BORDER2 = "#27272a";
const MUTED = "#71717a";
const DIM = "#52525b";
const TEXT = "#e4e4e7";
const WHITE = "#fafafa";

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

interface RiskCheck {
  id: string;
  label: string;
  level: RiskLevel;
  detail: string;
}

function runPreTradeChecks(params: {
  side: OrderSide;
  quantity: number;
  limitPrice: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  regime: string | null;
  sessionBias: string | null;
  preTradeMinRR: number;
  preTradeMaxPositionPct: number;
  preTradeMinDTE: number;
  accountSize: number;
  stratMinPoP: number;
  isOption: boolean;
  dte?: number | null;
  delta?: number | null;
  iv?: number | null;
  spreadMaxRisk?: number | null;
}): RiskCheck[] {
  const checks: RiskCheck[] = [];
  const { side, quantity, limitPrice, bid, ask, last, regime, sessionBias, preTradeMinRR, preTradeMaxPositionPct, preTradeMinDTE, accountSize, stratMinPoP, isOption, dte, delta, iv } = params;

  const isBuy = side === "BUY";
  const biasMatch = sessionBias === "BULLISH" ? isBuy : sessionBias === "BEARISH" ? !isBuy : null;
  if (regime && sessionBias) {
    if (regime === "NO_READ" || sessionBias === "NO_EDGE") {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "YELLOW", detail: `Regime: ${regime}, Bias: ${sessionBias}` });
    } else if (biasMatch === true) {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "GREEN", detail: `${side} aligns with ${sessionBias} bias` });
    } else if (biasMatch === false) {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "RED", detail: `${side} opposes ${sessionBias} bias` });
    } else {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "YELLOW", detail: `Neutral bias — no directional edge` });
    }
  } else {
    checks.push({ id: "pulse", label: "Pulse Alignment", level: "YELLOW", detail: "No Market Pulse data available" });
  }

  if (limitPrice && last && last > 0) {
    const rr = isBuy ? (last - limitPrice) / limitPrice : (limitPrice - last) / last;
    if (Math.abs(rr) >= preTradeMinRR) {
      checks.push({ id: "rr", label: "Risk/Reward", level: "GREEN", detail: `R:R meets ${preTradeMinRR}:1 minimum` });
    } else {
      checks.push({ id: "rr", label: "Risk/Reward", level: "YELLOW", detail: `R:R below ${preTradeMinRR}:1 target` });
    }
  } else {
    checks.push({ id: "rr", label: "Risk/Reward", level: "YELLOW", detail: "Set limit price for R:R calc" });
  }

  if (bid != null && ask != null && bid > 0) {
    const spreadPct = ((ask - bid) / bid) * 100;
    if (spreadPct > 15) {
      checks.push({ id: "liq", label: "Liquidity", level: "RED", detail: `Spread ${spreadPct.toFixed(1)}% > 15% — illiquid` });
    } else if (spreadPct > 5) {
      checks.push({ id: "liq", label: "Liquidity", level: "YELLOW", detail: `Spread ${spreadPct.toFixed(1)}% — moderate` });
    } else {
      checks.push({ id: "liq", label: "Liquidity", level: "GREEN", detail: `Spread ${spreadPct.toFixed(1)}% — tight` });
    }
  } else {
    checks.push({ id: "liq", label: "Liquidity", level: "YELLOW", detail: "No bid/ask data" });
  }

  if (isOption && delta != null) {
    const pop = isBuy ? Math.abs(delta) * 100 : (1 - Math.abs(delta)) * 100;
    if (pop >= stratMinPoP) {
      checks.push({ id: "pop", label: "Prob. of Profit", level: "GREEN", detail: `${pop.toFixed(0)}% >= ${stratMinPoP}% min` });
    } else if (pop >= stratMinPoP * 0.7) {
      checks.push({ id: "pop", label: "Prob. of Profit", level: "YELLOW", detail: `${pop.toFixed(0)}% near ${stratMinPoP}% min` });
    } else {
      checks.push({ id: "pop", label: "Prob. of Profit", level: "RED", detail: `${pop.toFixed(0)}% < ${stratMinPoP}% min` });
    }
  } else {
    checks.push({ id: "pop", label: "Prob. of Profit", level: "GREEN", detail: isOption ? "No delta data" : "Equity — n/a" });
  }

  const maxRiskAllowed = accountSize * (preTradeMaxPositionPct / 100);
  const positionRisk = params.spreadMaxRisk != null
    ? params.spreadMaxRisk * quantity
    : (limitPrice ?? last ?? 0) * quantity * (isOption ? 100 : 1);
  if (positionRisk > 0 && maxRiskAllowed > 0) {
    if (positionRisk <= maxRiskAllowed) {
      checks.push({ id: "size", label: "Position Size", level: "GREEN", detail: `${fmtCurrency(positionRisk)} <= ${fmtCurrency(maxRiskAllowed)} max` });
    } else if (positionRisk <= maxRiskAllowed * 1.5) {
      checks.push({ id: "size", label: "Position Size", level: "YELLOW", detail: `${fmtCurrency(positionRisk)} near ${fmtCurrency(maxRiskAllowed)} max` });
    } else {
      checks.push({ id: "size", label: "Position Size", level: "RED", detail: `${fmtCurrency(positionRisk)} > ${fmtCurrency(maxRiskAllowed)} max` });
    }
  } else {
    checks.push({ id: "size", label: "Position Size", level: "YELLOW", detail: "Enter price for size check" });
  }

  if (isOption && iv != null) {
    const ivPct = iv * 100;
    const selling = !isBuy;
    if (ivPct > 50 && selling) {
      checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: `IV ${ivPct.toFixed(0)}% — selling premium in high IV` });
    } else if (ivPct > 50 && !selling) {
      checks.push({ id: "vol", label: "Vol Environment", level: "YELLOW", detail: `IV ${ivPct.toFixed(0)}% — buying expensive premium` });
    } else if (ivPct <= 50 && selling) {
      checks.push({ id: "vol", label: "Vol Environment", level: "YELLOW", detail: `IV ${ivPct.toFixed(0)}% — selling cheap premium` });
    } else {
      checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: `IV ${ivPct.toFixed(0)}% — buying cheap premium` });
    }
  } else {
    checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: isOption ? "No IV data" : "Equity — n/a" });
  }

  if (isOption && dte != null) {
    if (dte < preTradeMinDTE) {
      checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "RED", detail: `${dte} DTE < ${preTradeMinDTE}-day minimum` });
    } else if (dte < preTradeMinDTE * 2) {
      checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "YELLOW", detail: `${dte} DTE — approaching gamma risk zone` });
    } else {
      checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "GREEN", detail: `${dte} DTE — within safe range` });
    }
  } else {
    checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "GREEN", detail: isOption ? "No DTE data" : "Equity — n/a" });
  }

  return checks;
}

function getOverallLevel(checks: RiskCheck[]): RiskLevel {
  if (checks.some(c => c.level === "RED")) return "RED";
  if (checks.some(c => c.level === "YELLOW")) return "YELLOW";
  return "GREEN";
}

function getRiskSummary(checks: RiskCheck[], side: OrderSide, overall: RiskLevel): string {
  const reds = checks.filter(c => c.level === "RED");
  const yellows = checks.filter(c => c.level === "YELLOW");

  if (overall === "GREEN") return `All ${checks.length} checks passed — clear to ${side.toLowerCase()}.`;
  if (overall === "RED") {
    const issues = reds.map(r => r.label.toLowerCase()).join(", ");
    return `BLOCKED: ${issues} ${reds.length === 1 ? "fails" : "fail"} risk threshold${yellows.length > 0 ? ` + ${yellows.length} caution${yellows.length > 1 ? "s" : ""}` : ""}.`;
  }
  const cautions = yellows.map(y => y.label.toLowerCase()).join(", ");
  return `CAUTION: ${cautions} ${yellows.length === 1 ? "needs" : "need"} attention — proceed with awareness.`;
}

function RiskIcon({ level }: { level: RiskLevel }) {
  if (level === "GREEN") return <ShieldCheck className="w-3.5 h-3.5" style={{ color: UP }} />;
  if (level === "YELLOW") return <ShieldAlert className="w-3.5 h-3.5" style={{ color: GOLD }} />;
  return <ShieldX className="w-3.5 h-3.5" style={{ color: DOWN }} />;
}

function levelColor(l: RiskLevel): string {
  if (l === "GREEN") return UP;
  if (l === "YELLOW") return GOLD;
  return DOWN;
}

export interface OrderLeg {
  schwabSymbol: string;
  instruction: string;
  quantity: number;
  optionType: string;
  strike: number;
  expiration: string;
  bid?: number;
  ask?: number;
  delta?: number;
}

interface OrderTicketProps {
  isOpen: boolean;
  onClose: () => void;
  initialSide?: OrderSide;
  optionSymbol?: string;
  optionInstruction?: string;
  strategyLegs?: OrderLeg[];
  strategyNetPrice?: number;
  strategyIsCredit?: boolean;
  isCloseOrder?: boolean;
}

function MiniPayoffChart({ legs, isMultiLeg, side, quantity, limitPrice, isOption, last }: {
  legs?: OrderLeg[];
  isMultiLeg: boolean;
  side: OrderSide;
  quantity: number;
  limitPrice: number;
  isOption: boolean;
  last: number;
}) {
  const W = 280;
  const H = 100;
  const PAD = 20;

  const points = useMemo(() => {
    if (!last || last <= 0) return null;

    if (isMultiLeg && legs && legs.length > 0) {
      const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
      const minS = strikes[0];
      const maxS = strikes[strikes.length - 1];
      const range = Math.max(maxS - minS, last * 0.1);
      const lo = minS - range * 0.5;
      const hi = maxS + range * 0.5;

      const pts: { x: number; y: number }[] = [];
      const steps = 60;
      let minPl = Infinity, maxPl = -Infinity;
      const plVals: number[] = [];

      for (let i = 0; i <= steps; i++) {
        const px = lo + (hi - lo) * (i / steps);
        let pl = 0;
        for (const leg of legs) {
          const isCall = leg.optionType === "CALL";
          const isBuy = leg.instruction.startsWith("BUY");
          const mid = ((leg.bid ?? 0) + (leg.ask ?? 0)) / 2 || limitPrice / legs.length;
          const intrinsic = isCall ? Math.max(0, px - leg.strike) : Math.max(0, leg.strike - px);
          const legPl = isBuy ? (intrinsic - mid) * leg.quantity * 100 : (mid - intrinsic) * leg.quantity * 100;
          pl += legPl;
        }
        plVals.push(pl);
        minPl = Math.min(minPl, pl);
        maxPl = Math.max(maxPl, pl);
      }

      const plRange = maxPl - minPl || 1;
      for (let i = 0; i <= steps; i++) {
        pts.push({
          x: PAD + (i / steps) * (W - 2 * PAD),
          y: PAD + (1 - (plVals[i] - minPl) / plRange) * (H - 2 * PAD),
        });
      }

      const zeroY = maxPl > 0 && minPl < 0
        ? PAD + (1 - (0 - minPl) / plRange) * (H - 2 * PAD)
        : null;

      const lastX = PAD + ((last - lo) / (hi - lo)) * (W - 2 * PAD);

      return { pts, zeroY, lastX, minPl, maxPl };
    }

    const price = limitPrice || last;
    const spread = last * 0.08;
    const lo = last - spread;
    const hi = last + spread;
    const cost = price * quantity * (isOption ? 100 : 1);
    const isBuy = side === "BUY";

    const pts: { x: number; y: number }[] = [];
    const steps = 60;
    let minPl = Infinity, maxPl = -Infinity;
    const plVals: number[] = [];

    for (let i = 0; i <= steps; i++) {
      const px = lo + (hi - lo) * (i / steps);
      const val = px * quantity * (isOption ? 100 : 1);
      const pl = isBuy ? val - cost : cost - val;
      plVals.push(pl);
      minPl = Math.min(minPl, pl);
      maxPl = Math.max(maxPl, pl);
    }

    const plRange = maxPl - minPl || 1;
    for (let i = 0; i <= steps; i++) {
      pts.push({
        x: PAD + (i / steps) * (W - 2 * PAD),
        y: PAD + (1 - (plVals[i] - minPl) / plRange) * (H - 2 * PAD),
      });
    }

    const zeroY = maxPl > 0 && minPl < 0
      ? PAD + (1 - (0 - minPl) / plRange) * (H - 2 * PAD)
      : null;

    const lastX = PAD + ((last - lo) / (hi - lo)) * (W - 2 * PAD);

    return { pts, zeroY, lastX, minPl, maxPl };
  }, [legs, isMultiLeg, side, quantity, limitPrice, isOption, last]);

  if (!points) return null;

  const { pts, zeroY, lastX, maxPl } = points;
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const profitFillD = zeroY != null
    ? `${pathD} L${pts[pts.length - 1].x},${zeroY} L${pts[0].x},${zeroY} Z`
    : pathD;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 100 }}>
      {zeroY != null && (
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke={MUTED} strokeWidth={0.5} strokeDasharray="3,3" />
      )}
      {lastX > PAD && lastX < W - PAD && (
        <line x1={lastX} y1={PAD} x2={lastX} y2={H - PAD} stroke={GOLD} strokeWidth={0.5} strokeDasharray="2,2" opacity={0.5} />
      )}
      <defs>
        <linearGradient id="payoffGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={maxPl > 0 ? UP : DOWN} stopOpacity={0.3} />
          <stop offset="100%" stopColor={maxPl > 0 ? UP : DOWN} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={profitFillD} fill="url(#payoffGrad)" />
      <path d={pathD} fill="none" stroke={UP} strokeWidth={1.5} />
      {zeroY != null && (
        <text x={W - PAD + 2} y={zeroY + 3} fill={MUTED} fontSize={10} fontFamily="monospace">0</text>
      )}
    </svg>
  );
}

function PortfolioImpactCard({ cost, side, isOption, quantity }: {
  cost: number | null;
  side: OrderSide;
  isOption: boolean;
  quantity: number;
}) {
  const accountSize = useTerminalStore(s => s.accountSize);
  if (!cost || !accountSize) return null;

  const impact = side === "BUY" ? -cost : cost;
  const newBP = accountSize + impact;
  const concentrationPct = Math.abs(cost) / accountSize * 100;
  const marginImpact = isOption ? Math.abs(cost) * 0.2 : Math.abs(cost) * 0.5;

  return (
    <div className="overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <TrendingUp className="w-3.5 h-3.5" style={{ color: GOLD }} />
        <span className="font-mono text-[11px] font-bold tracking-[0.12em]" style={{ color: GOLD }}>AFTER THIS TRADE</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-2.5">
        <div className="flex justify-between">
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>Buying Power</span>
          <span className="font-mono text-[12px] font-bold" style={{ color: newBP < 0 ? DOWN : TEXT }}>
            {fmtCompact(newBP)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>Margin Req</span>
          <span className="font-mono text-[12px]" style={{ color: TEXT }}>
            {fmtCompact(marginImpact)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>Concentration</span>
          <span className="font-mono text-[12px]" style={{ color: concentrationPct > 10 ? DOWN : concentrationPct > 5 ? GOLD : TEXT }}>
            {concentrationPct.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>Net Liq</span>
          <span className="font-mono text-[12px]" style={{ color: TEXT }}>
            {fmtCompact(accountSize)}
          </span>
        </div>
      </div>
    </div>
  );
}

function AiCoPilotPanel({ side, symbol, limitPrice, bid, ask, quantity, isOption }: {
  side: OrderSide;
  symbol: string;
  limitPrice: number;
  bid: number | null;
  ask: number | null;
  quantity: number;
  isOption: boolean;
}) {
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const suggestions = useMemo(() => {
    const tips: { text: string; type: "info" | "warn" | "tip" }[] = [];

    if (mid != null && limitPrice > 0) {
      if (side === "BUY" && limitPrice > mid * 1.01) {
        tips.push({ text: `Lower limit to mid ${fmt(mid)} for better fill (+${((limitPrice - mid) * quantity * (isOption ? 100 : 1)).toFixed(0)} savings)`, type: "tip" });
      } else if (side === "SELL" && limitPrice < mid * 0.99) {
        tips.push({ text: `Raise limit to mid ${fmt(mid)} for better fill`, type: "tip" });
      }
    }

    if (bid != null && ask != null) {
      const spread = ask - bid;
      const spreadPct = bid > 0 ? (spread / bid) * 100 : 0;
      if (spreadPct > 3) {
        tips.push({ text: `Wide spread (${spreadPct.toFixed(1)}%) — use limit orders, avoid market`, type: "warn" });
      }
      if (mid != null && side === "BUY") {
        const fillProb = limitPrice >= ask ? 99 : limitPrice >= mid ? 78 : limitPrice >= bid ? 45 : 15;
        tips.push({ text: `Fill probability at $${limitPrice.toFixed(2)}: ~${fillProb}%`, type: "info" });
      }
    }

    if (tips.length === 0) {
      tips.push({ text: `${side} ${quantity} ${isOption ? "contract" : "share"}${quantity > 1 ? "s" : ""} of ${symbol} — looks reasonable`, type: "info" });
    }

    return tips;
  }, [side, symbol, limitPrice, bid, ask, quantity, isOption, mid]);

  return (
    <div className="overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <Sparkles className="w-3.5 h-3.5" style={{ color: GOLD }} />
        <span className="font-mono text-[11px] font-bold tracking-[0.12em]" style={{ color: GOLD }}>AI CO-PILOT</span>
      </div>
      <div className="px-4 py-2.5 space-y-2">
        {suggestions.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{
              background: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : UP
            }} />
            <span className="font-mono text-[11px] leading-snug" style={{
              color: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : TEXT
            }}>{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderTicket({ isOpen, onClose, initialSide, optionSymbol, optionInstruction, strategyLegs, strategyNetPrice, strategyIsCredit, isCloseOrder }: OrderTicketProps) {
  const symbol = useTerminalStore((s) => s.symbol);
  const { data: quote } = useQuote(symbol);
  const pulseData = useMarketPulseStore((s) => s.pulseData);
  const preTradeEnabled = useTerminalStore((s) => s.preTradeEnabled);
  const preTradeBlockOnRed = useTerminalStore((s) => s.preTradeBlockOnRed);
  const preTradeMinRR = useTerminalStore((s) => s.preTradeMinRR);
  const preTradeMaxPositionPct = useTerminalStore((s) => s.preTradeMaxPositionPct);
  const preTradeMinDTE = useTerminalStore((s) => s.preTradeMinDTE);
  const accountSize = useTerminalStore((s) => s.accountSize);
  const stratMinPoP = useTerminalStore((s) => s.stratMinPoP);

  const [side, setSide] = useState<OrderSide>(initialSide ?? "BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [trailOffset, setTrailOffset] = useState("");
  const [duration, setDuration] = useState<Duration>("DAY");
  const [extendedHours, setExtendedHours] = useState(false);
  const [stage, setStage] = useState<ConfirmStage>("form");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accountHash, setAccountHash] = useState<string | null>(null);
  const [showOrderType, setShowOrderType] = useState(false);
  const [showTifDropdown, setShowTifDropdown] = useState(false);
  const [priceLocked, setPriceLocked] = useState(false);
  const [showBalances, setShowBalances] = useState(false);
  const [balancesHidden, setBalancesHidden] = useState(false);
  const [posEffect, setPosEffect] = useState<PositionEffect>("AUTO");
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const isMultiLeg = !!strategyLegs && strategyLegs.length >= 1;
  const isOption = !!optionSymbol || isMultiLeg;
  const displaySymbol = isMultiLeg ? `${symbol} Strategy (${strategyLegs!.length} legs)` : optionSymbol ?? symbol;

  const spreadPrices = useMemo(() => {
    if (!isMultiLeg || !strategyLegs || strategyLegs.length === 0) return null;
    let spreadBid = 0;
    let spreadAsk = 0;
    for (const leg of strategyLegs) {
      const isSell = leg.instruction.startsWith("SELL");
      if (isSell) {
        spreadBid += leg.bid ?? 0;
        spreadAsk += leg.ask ?? 0;
      } else {
        spreadBid -= leg.ask ?? 0;
        spreadAsk -= leg.bid ?? 0;
      }
    }
    if (strategyIsCredit) {
      spreadBid = Math.abs(spreadBid);
      spreadAsk = Math.abs(spreadAsk);
      if (spreadBid > spreadAsk) {
        const tmp = spreadBid;
        spreadBid = spreadAsk;
        spreadAsk = tmp;
      }
    }
    const spreadMid = (spreadBid + spreadAsk) / 2;
    return { spreadBid, spreadMid, spreadAsk };
  }, [isMultiLeg, strategyLegs, strategyIsCredit]);

  useEffect(() => {
    if (!isOpen) return;
    setSide(initialSide ?? "BUY");
    setOrderType("LIMIT");
    setQuantity(1);
    setLimitPrice(isMultiLeg && strategyNetPrice != null ? strategyNetPrice.toFixed(2) : "");
    setStopPrice("");
    setTrailOffset("");
    setDuration("DAY");
    setExtendedHours(false);
    setStage("form");
    setOrderId(null);
    setErrorMsg("");
    setShowOrderType(false);
    setShowTifDropdown(false);
    setPriceLocked(false);
    setShowBalances(false);
    setPosEffect("AUTO");
  }, [isOpen, initialSide, isMultiLeg, strategyNetPrice]);

  useEffect(() => {
    if (!isOpen) return;
    fetchWithAuth("/api/portfolio/account-hash")
      .then((r) => r.json())
      .then((d) => { if (d.hashValue) setAccountHash(d.hashValue); })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || priceLocked || limitPrice) return;
    if (isMultiLeg) return;
    if (isCloseOrder && strategyNetPrice != null && strategyNetPrice > 0) {
      setLimitPrice(strategyNetPrice.toFixed(2));
      return;
    }
    if (quote?.ask != null) {
      const mid = quote.bid != null && quote.ask != null ? ((quote.bid + quote.ask) / 2) : quote.ask;
      setLimitPrice(mid.toFixed(2));
    }
  }, [isOpen, quote?.ask, quote?.bid, isMultiLeg, isCloseOrder, strategyNetPrice]);

  const needsLimit = orderType === "LIMIT" || orderType === "STOP_LIMIT";
  const needsStop = orderType === "STOP" || orderType === "STOP_LIMIT";
  const needsTrail = orderType === "TRAILING_STOP";

  const estimatedCost = useMemo(() => {
    if (isMultiLeg) {
      const price = parseFloat(limitPrice) || strategyNetPrice;
      if (!price) return null;
      return price * quantity * 100;
    }
    const price =
      orderType === "MARKET"
        ? (side === "BUY" ? quote?.ask : quote?.bid) ?? quote?.last
        : needsLimit
          ? parseFloat(limitPrice) || null
          : needsStop
            ? parseFloat(stopPrice) || null
            : quote?.last;
    if (!price) return null;
    const multiplier = isOption ? 100 : 1;
    return price * quantity * multiplier;
  }, [orderType, side, quote?.ask, quote?.bid, quote?.last, limitPrice, stopPrice, quantity, needsLimit, needsStop, isOption, isMultiLeg, strategyNetPrice]);

  const optionMarkEstimate = isCloseOrder && isOption && !isMultiLeg && strategyNetPrice != null && strategyNetPrice > 0 ? strategyNetPrice : null;
  const effectiveBid = isMultiLeg && spreadPrices
    ? spreadPrices.spreadBid
    : optionMarkEstimate != null ? optionMarkEstimate * 0.97 : quote?.bid ?? null;
  const effectiveAsk = isMultiLeg && spreadPrices
    ? spreadPrices.spreadAsk
    : optionMarkEstimate != null ? optionMarkEstimate * 1.03 : quote?.ask ?? null;
  const midPrice = effectiveBid != null && effectiveAsk != null ? (effectiveBid + effectiveAsk) / 2 : null;

  const riskChecks = useMemo(() => {
    if (!preTradeEnabled) return [];
    let spreadMaxRisk: number | null = null;
    if (isMultiLeg && strategyLegs && strategyLegs.length >= 2) {
      const strikes = strategyLegs.map(l => l.strike).sort((a, b) => a - b);
      const strikeWidth = strikes[strikes.length - 1] - strikes[0];
      const netCredit = parseFloat(limitPrice) || strategyNetPrice || 0;
      spreadMaxRisk = (strikeWidth - netCredit) * 100;
      if (spreadMaxRisk < 0) spreadMaxRisk = 0;
    }
    const allChecks = runPreTradeChecks({
      side, quantity,
      limitPrice: parseFloat(limitPrice) || null,
      bid: isMultiLeg && spreadPrices ? spreadPrices.spreadBid : (effectiveBid ?? null),
      ask: isMultiLeg && spreadPrices ? spreadPrices.spreadAsk : (effectiveAsk ?? null),
      last: quote?.last ?? null,
      regime: pulseData?.structuralRegime?.label ?? null,
      sessionBias: pulseData?.sessionBias?.label ?? null,
      preTradeMinRR, preTradeMaxPositionPct, preTradeMinDTE, accountSize, stratMinPoP, isOption,
      spreadMaxRisk,
    });
    if (isCloseOrder) {
      return allChecks.filter(c => !["pulse", "rr", "size"].includes(c.id));
    }
    return allChecks;
  }, [side, quantity, limitPrice, effectiveBid, effectiveAsk, quote?.last, pulseData, preTradeMinRR, preTradeMaxPositionPct, preTradeMinDTE, accountSize, stratMinPoP, isOption, preTradeEnabled, isMultiLeg, strategyLegs, strategyNetPrice, spreadPrices, isCloseOrder]);

  const overallRisk = useMemo(() => getOverallLevel(riskChecks), [riskChecks]);
  const riskSummary = useMemo(() => getRiskSummary(riskChecks, side, overallRisk), [riskChecks, side, overallRisk]);
  const blockedByRisk = preTradeEnabled && preTradeBlockOnRed && overallRisk === "RED";

  const isValid = useMemo(() => {
    if (quantity <= 0) return false;
    if (!accountHash) return false;
    if (blockedByRisk) return false;
    if (isMultiLeg) return !!limitPrice && parseFloat(limitPrice) > 0;
    if (needsLimit && (!limitPrice || parseFloat(limitPrice) <= 0)) return false;
    if (needsStop && (!stopPrice || parseFloat(stopPrice) <= 0)) return false;
    if (needsTrail && (!trailOffset || parseFloat(trailOffset) <= 0)) return false;
    return true;
  }, [quantity, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset, accountHash, blockedByRisk, isMultiLeg]);

  const buildSchwabOrder = useCallback(() => {
    if (isMultiLeg && strategyLegs) {
      const parsed = parseFloat(limitPrice || "0");
      const o: Record<string, unknown> = {
        orderType: strategyIsCredit ? "NET_CREDIT" : "NET_DEBIT",
        session: extendedHours ? "SEAMLESS" : "NORMAL",
        duration,
        complexOrderStrategyType: "NONE",
        orderStrategyType: "SINGLE",
        orderLegCollection: strategyLegs.map(leg => ({
          instruction: leg.instruction,
          quantity: leg.quantity * quantity,
          instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
        })),
      };
      if (parsed > 0) o.price = parsed;
      return o;
    }
    const order: Record<string, unknown> = {
      orderType,
      session: extendedHours ? "SEAMLESS" : "NORMAL",
      duration,
      orderStrategyType: "SINGLE",
      orderLegCollection: [{
        instruction: isOption ? (optionInstruction ?? (side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_CLOSE")) : side,
        quantity,
        instrument: { symbol: optionSymbol ?? symbol, assetType: isOption ? "OPTION" : "EQUITY" },
      }],
    };
    if (needsLimit) order.price = parseFloat(limitPrice || "0");
    if (needsStop) order.stopPrice = parseFloat(stopPrice || "0");
    if (needsTrail) {
      order.stopPriceLinkBasis = "LAST";
      order.stopPriceLinkType = "VALUE";
      order.stopPriceOffset = parseFloat(trailOffset || "0");
    }
    return order;
  }, [orderType, extendedHours, duration, side, quantity, symbol, optionSymbol, isOption, isMultiLeg, strategyLegs, strategyIsCredit, optionInstruction, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset]);

  const handleSubmit = useCallback(async () => {
    if (!accountHash) return;
    setStage("submitting");
    try {
      const order = buildSchwabOrder();

      let strategistParsed: any = null;
      try {
        const raw = useTerminalStore.getState().strategistResult;
        if (raw) strategistParsed = JSON.parse(raw);
      } catch {}

      const journalContext: Record<string, unknown> = {
        symbol,
        strategyType: strategistParsed?.criteria?.strategyType ?? (isMultiLeg ? "SPREAD" : isOption ? "SINGLE_OPTION" : "EQUITY"),
        direction: side,
        pulseComposite: pulseData?.compositeScore ?? null,
        pulseConfidence: pulseData?.confidenceScore ?? null,
        pulseBias: pulseData?.sessionBias?.label ?? null,
        scannerScore: strategistParsed?.tickerData?.ivr ?? null,
        tradingMode: strategistParsed?.mode != null ? parseInt(strategistParsed.mode) : null,
        tradingModeLabel: strategistParsed?.modeReason ?? null,
        eventConflicts: strategistParsed?.criteria?.eventConflicts ?? null,
        ivr: strategistParsed?.tickerData?.ivr ?? null,
        entryPrice: parseFloat(limitPrice) || null,
        isCredit: isMultiLeg ? (strategyIsCredit ?? false) : false,
        maxLoss: (() => {
          if (!isMultiLeg || !strategyLegs || strategyLegs.length < 2) return null;
          const strikes = strategyLegs.map(l => l.strike).sort((a, b) => a - b);
          const width = strikes[strikes.length - 1] - strikes[0];
          const credit = parseFloat(limitPrice) || 0;
          if (strategyIsCredit) return (width - credit) * 100 * (parseInt(String(quantity)) || 1);
          return credit * 100 * (parseInt(String(quantity)) || 1);
        })(),
        maxGain: (() => {
          if (!isMultiLeg || !strategyLegs || strategyLegs.length < 2) return null;
          const strikes = strategyLegs.map(l => l.strike).sort((a, b) => a - b);
          const width = strikes[strikes.length - 1] - strikes[0];
          const credit = parseFloat(limitPrice) || 0;
          if (strategyIsCredit) return credit * 100 * (parseInt(String(quantity)) || 1);
          return (width - credit) * 100 * (parseInt(String(quantity)) || 1);
        })(),
        thesis: strategistParsed?.narrative ?? null,
        legs: strategyLegs ? strategyLegs.map(l => ({
          symbol: l.schwabSymbol,
          instruction: l.instruction,
          quantity: l.quantity ?? parseInt(String(quantity)) ?? 1,
          strike: l.strike,
          putCall: l.optionType,
          assetType: "OPTION",
          expiration: l.expiration,
        })) : null,
        quantity: parseInt(String(quantity)) || null,
      };

      const res = await fetchWithAuth("/api/portfolio/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHash, order, journalContext }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.message || data.error || "Order rejected");
        setStage("error");
        return;
      }
      setOrderId(data.orderId ?? "—");
      setStage("success");
    } catch (err: any) {
      setErrorMsg(err.message || "Network error");
      setStage("error");
    }
  }, [accountHash, buildSchwabOrder, symbol, side, pulseData, limitPrice, isMultiLeg, strategyIsCredit, strategyLegs, quantity, isOption]);

  const setMidPrice = useCallback(() => {
    if (isMultiLeg && spreadPrices) {
      setLimitPrice(spreadPrices.spreadMid.toFixed(2));
      return;
    }
    if (quote?.bid != null && quote?.ask != null) {
      setLimitPrice(((quote.bid + quote.ask) / 2).toFixed(2));
    }
  }, [quote?.bid, quote?.ask, isMultiLeg, spreadPrices]);

  const setNatPrice = useCallback(() => {
    if (isMultiLeg && spreadPrices) {
      setLimitPrice(strategyIsCredit ? spreadPrices.spreadBid.toFixed(2) : spreadPrices.spreadAsk.toFixed(2));
      return;
    }
    if (side === "BUY" && quote?.ask != null) setLimitPrice(quote.ask.toFixed(2));
    else if (side === "SELL" && quote?.bid != null) setLimitPrice(quote.bid.toFixed(2));
  }, [side, quote?.ask, quote?.bid, isMultiLeg, spreadPrices, strategyIsCredit]);

  const sliderValue = useMemo(() => {
    if (effectiveBid == null || effectiveAsk == null) return 50;
    const lp = parseFloat(limitPrice);
    if (!lp) return 50;
    const range = effectiveAsk - effectiveBid;
    if (range <= 0) return 50;
    return Math.max(0, Math.min(100, ((lp - effectiveBid) / range) * 100));
  }, [limitPrice, effectiveBid, effectiveAsk]);

  if (!isOpen) return null;

  const isBuy = side === "BUY";
  const sideColor = isBuy ? UP : DOWN;
  const changePct = quote?.changePct;
  const changeColor = (changePct ?? 0) >= 0 ? UP : DOWN;
  const quoteAny = quote as Record<string, unknown> | null;
  const dayHigh = (quoteAny?.highPrice ?? quoteAny?.high) as number | undefined;
  const dayLow = (quoteAny?.lowPrice ?? quoteAny?.low) as number | undefined;
  const volume = (quoteAny?.totalVolume ?? quoteAny?.volume) as number | undefined;

  return (
    <div className="fixed inset-0 z-[210] flex flex-col" style={{ background: "#0a0a0a" }}>

      <header className="shrink-0 flex items-center h-11 px-4" style={{ background: BG2, borderBottom: `1px solid ${BORDER}` }}>
        <button onClick={onClose} className="font-mono text-[13px] font-medium" style={{ color: GOLD }}>
          ← Back
        </button>
        <div className="flex-1 text-center min-w-0">
          <div className="flex items-center justify-center gap-2">
            {isCloseOrder ? (
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: "#f23645", color: "#fff", letterSpacing: "0.08em" }}>
                CLOSE
              </span>
            ) : (
              <span className="font-mono text-[13px] font-bold" style={{ color: sideColor }}>{side}</span>
            )}
            <span className="font-mono text-[14px] font-bold tracking-wide" style={{ color: WHITE }}>{symbol}</span>
            {!isCloseOrder && (
              <>
                <span className="font-mono text-[13px] font-semibold" style={{ color: changeColor }}>
                  {fmt(quote?.last)}
                </span>
                {changePct != null && (
                  <span className="font-mono text-[11px]" style={{ color: changeColor }}>
                    {changePct >= 0 ? "+" : ""}{fmt(changePct)}%
                  </span>
                )}
              </>
            )}
          </div>
          {isOption && !isMultiLeg && optionSymbol && (
            <p className="font-mono text-[10px] truncate" style={{ color: isCloseOrder ? "#f23645" : MUTED }}>
              {isCloseOrder ? `${optionInstruction?.replace(/_/g, " ")} · ` : ""}{optionSymbol}
            </p>
          )}
          {isCloseOrder && isMultiLeg && strategyLegs && (
            <p className="font-mono text-[10px]" style={{ color: "#f23645" }}>
              CLOSE {strategyLegs.length}-LEG SPREAD
            </p>
          )}
        </div>
        <button className="p-1.5" style={{ color: MUTED }}>
          <Settings2 className="w-4 h-4" />
        </button>
      </header>

      {isCloseOrder && (
        <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ background: "#1a0a0a", borderBottom: `1px solid #f2364530` }}>
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#f23645" }} />
          <span className="font-mono text-[11px]" style={{ color: "#f23645cc" }}>
            Closing existing position — risk checks for opening trades do not apply
          </span>
        </div>
      )}

      {stage === "form" || stage === "review" ? (
        <div className="flex-1 overflow-y-auto pb-28">

          <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto" style={{ borderBottom: `1px solid ${BORDER}`, background: BG2 }}>
            {[
              { label: "Vol", value: volume != null ? fmtCompact(volume) : "—" },
              { label: "Range", value: dayLow != null && dayHigh != null ? `${fmt(dayLow)}-${fmt(dayHigh)}` : "—" },
              { label: "Bid", value: fmt(quote?.bid), color: UP },
              { label: "Ask", value: fmt(quote?.ask), color: DOWN },
              { label: "Sprd", value: quote?.bid != null && quote?.ask != null ? fmt(quote.ask - quote.bid) : "—" },
            ].map((m, i) => (
              <div key={i} className="flex items-center gap-1 shrink-0">
                <span className="font-mono text-[10px]" style={{ color: MUTED }}>{m.label}</span>
                <span className="font-mono text-[12px] font-medium" style={{ color: m.color || TEXT }}>{m.value}</span>
                {i < 4 && <span className="font-mono text-[10px] mx-0.5" style={{ color: BORDER2 }}>|</span>}
              </div>
            ))}
          </div>

          {preTradeEnabled && riskChecks.length > 0 && (
            <div style={{ background: "#0d0d0f", borderBottom: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <Shield className="w-4 h-4" style={{ color: levelColor(overallRisk) }} />
                <span className="font-mono text-[12px] font-bold tracking-[0.12em]" style={{ color: WHITE }}>PRE-TRADE RISK CHECK</span>
                <div className="flex-1" />
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded" style={{
                  color: overallRisk === "GREEN" ? "#000" : overallRisk === "YELLOW" ? "#000" : "#fff",
                  background: levelColor(overallRisk),
                }}>
                  {overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}
                </span>
              </div>
              <div className="w-full h-[2px]" style={{ background: levelColor(overallRisk) }} />
              <div className="px-4 py-2">
                {riskChecks.map(c => (
                  <div key={c.id} className="flex items-center py-[5px]" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <RiskIcon level={c.level} />
                    <span className="font-mono text-[12px] font-medium ml-2.5" style={{ color: TEXT, width: 120, flexShrink: 0 }}>{c.label}</span>
                    <span className="font-mono text-[11px] flex-1 text-right" style={{ color: levelColor(c.level) }}>{c.detail}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2" style={{ borderTop: `1px solid ${BORDER}`, background: `${levelColor(overallRisk)}08` }}>
                <p className="font-mono text-[11px] leading-relaxed" style={{ color: levelColor(overallRisk) }}>
                  {riskSummary}
                </p>
              </div>
            </div>
          )}

          <div className="px-4 pt-3 space-y-3">

            {isMultiLeg && strategyLegs ? (
              <div className="overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                <div className="px-3 py-1.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${BORDER}`, background: "#0d0d0f" }}>
                  <span className="font-mono text-[10px] font-bold tracking-[0.12em]" style={{ color: GOLD }}>STRATEGY LEGS</span>
                  <span className="font-mono text-[10px]" style={{ color: MUTED }}>{strategyLegs.length} legs</span>
                </div>
                {strategyLegs.map((leg, i) => {
                  const isBuyLeg = leg.instruction.startsWith("BUY");
                  const dirColor = isBuyLeg ? UP : DOWN;
                  const dirShort = isBuyLeg
                    ? (leg.instruction === "BUY_TO_OPEN" ? "BTO" : "BTC")
                    : (leg.instruction === "SELL_TO_OPEN" ? "STO" : "STC");
                  const qtySign = isBuyLeg ? "+" : "-";
                  return (
                    <div key={i} className="flex items-center px-3" style={{ height: 32, borderBottom: `1px solid ${BORDER}` }}>
                      <span className="font-mono text-[11px] font-bold" style={{ color: dirColor, width: 36 }}>{dirShort}</span>
                      <span className="font-mono text-[12px] font-bold" style={{ color: dirColor, width: 30 }}>{qtySign}{leg.quantity}</span>
                      <span className="font-mono text-[12px] font-bold flex-1" style={{ color: TEXT }}>
                        {leg.strike} {leg.optionType === "CALL" ? "C" : "P"}
                      </span>
                      <div className="flex items-center gap-1 font-mono text-[11px]">
                        {leg.bid != null && <span style={{ color: UP }}>{leg.bid.toFixed(2)}</span>}
                        {leg.bid != null && leg.ask != null && <span style={{ color: DIM }}>/</span>}
                        {leg.ask != null && <span style={{ color: DOWN }}>{leg.ask.toFixed(2)}</span>}
                      </div>
                    </div>
                  );
                })}
                <div className="px-3 py-1.5 flex justify-between" style={{ background: `${strategyIsCredit ? UP : DOWN}08` }}>
                  <span className="font-mono text-[11px]" style={{ color: MUTED }}>Net {strategyIsCredit ? "Credit" : "Debit"}</span>
                  <span className="font-mono text-[13px] font-bold" style={{ color: strategyIsCredit ? UP : DOWN }}>
                    ${strategyNetPrice?.toFixed(2) ?? "—"} / spread
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex overflow-hidden h-10" style={{ border: `1px solid ${BORDER2}` }}>
                {(["BUY", "SELL"] as OrderSide[]).map((s) => {
                  const active = side === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      className="flex-1 font-mono font-bold text-[13px] tracking-wider transition-all duration-150"
                      style={{
                        background: active ? (s === "BUY" ? "rgba(0,209,102,0.15)" : "rgba(242,54,69,0.15)") : "transparent",
                        color: active ? (s === "BUY" ? UP : DOWN) : DIM,
                        borderBottom: `2px solid ${active ? (s === "BUY" ? UP : DOWN) : "transparent"}`,
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            )}

            {!isMultiLeg && (
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <button
                    onClick={() => { setShowOrderType(!showOrderType); setShowTifDropdown(false); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 font-mono text-[13px] transition-colors"
                    style={{ background: FIELD, border: `1px solid ${BORDER2}`, color: TEXT }}
                  >
                    <span style={{ color: MUTED }} className="text-[10px] mr-1.5">Type</span>
                    {ORDER_TYPES.find((t) => t.value === orderType)?.short}
                    <ChevronDown className="w-3.5 h-3.5 ml-1" style={{ color: DIM }} />
                  </button>
                  {showOrderType && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-10 overflow-hidden shadow-xl" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                      {ORDER_TYPES.map((t) => (
                        <button
                          key={t.value}
                          onClick={() => { setOrderType(t.value); setShowOrderType(false); }}
                          className="w-full text-left px-3 py-2.5 font-mono text-[13px] transition-colors"
                          style={{
                            color: orderType === t.value ? GOLD : "#a1a1aa",
                            background: orderType === t.value ? GOLD_DIM : "transparent",
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 relative">
                  <button
                    onClick={() => { setShowTifDropdown(!showTifDropdown); setShowOrderType(false); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 font-mono text-[13px] transition-colors"
                    style={{ background: FIELD, border: `1px solid ${BORDER2}`, color: TEXT }}
                  >
                    <span style={{ color: MUTED }} className="text-[10px] mr-1.5">TIF</span>
                    {DURATIONS.find((d) => d.value === duration)?.label}
                    <ChevronDown className="w-3.5 h-3.5 ml-1" style={{ color: DIM }} />
                  </button>
                  {showTifDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-10 overflow-hidden shadow-xl" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                      {DURATIONS.map((d) => (
                        <button
                          key={d.value}
                          onClick={() => { setDuration(d.value); setShowTifDropdown(false); }}
                          className="w-full text-left px-3 py-2.5 font-mono text-[13px] transition-colors"
                          style={{
                            color: duration === d.value ? GOLD : "#a1a1aa",
                            background: duration === d.value ? GOLD_DIM : "transparent",
                          }}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {(needsLimit || isMultiLeg) && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-mono text-[10px] tracking-wider" style={{ color: MUTED }}>
                    {isMultiLeg ? (strategyIsCredit ? "NET CREDIT PRICE" : "NET DEBIT PRICE") : "LIMIT PRICE"}
                  </label>
                  <button onClick={() => setPriceLocked(!priceLocked)} className="p-0.5" style={{ color: priceLocked ? GOLD : DIM }}>
                    {priceLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                </div>
                <div className="flex items-center overflow-hidden" style={{ background: FIELD, border: `1px solid ${priceLocked ? "rgba(251,191,36,0.3)" : BORDER2}` }}>
                  <span className="pl-3 font-mono text-[12px]" style={{ color: DIM }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={limitPrice}
                    onChange={(e) => { if (!priceLocked) setLimitPrice(e.target.value); }}
                    placeholder="0.00"
                    className="flex-1 px-1.5 py-2 font-mono text-[14px] font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: priceLocked ? GOLD : WHITE }}
                    readOnly={priceLocked}
                  />
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      onClick={() => { if (!priceLocked && effectiveBid != null) setLimitPrice(effectiveBid.toFixed(2)); }}
                      className="px-2 py-1 rounded font-mono text-[10px] font-bold transition-colors"
                      style={{ color: UP, background: "rgba(0,209,102,0.08)", opacity: priceLocked ? 0.4 : 1 }}
                      disabled={priceLocked}
                    >
                      BID
                    </button>
                    <button
                      onClick={() => { if (!priceLocked) setMidPrice(); }}
                      className="px-2 py-1 rounded font-mono text-[10px] font-bold transition-colors"
                      style={{ color: GOLD, background: GOLD_DIM, opacity: priceLocked ? 0.4 : 1 }}
                      disabled={priceLocked}
                    >
                      MID
                    </button>
                    <button
                      onClick={() => { if (!priceLocked) setNatPrice(); }}
                      className="px-2 py-1 rounded font-mono text-[10px] font-bold transition-colors"
                      style={{ color: DOWN, background: "rgba(242,54,69,0.08)", opacity: priceLocked ? 0.4 : 1 }}
                      disabled={priceLocked}
                    >
                      NAT
                    </button>
                  </div>
                </div>

                {effectiveBid != null && effectiveAsk != null && (
                  <div className="mt-1.5 px-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px]" style={{ color: UP }}>Bid</span>
                      <div className="flex-1 relative h-3">
                        <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: BORDER2 }}>
                          <div className="absolute inset-0 rounded-full" style={{
                            background: `linear-gradient(90deg, ${UP}30, ${GOLD}40, ${DOWN}30)`,
                          }} />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={sliderValue}
                          onChange={(e) => {
                            if (priceLocked) return;
                            const pct = parseInt(e.target.value) / 100;
                            const price = effectiveBid + (effectiveAsk - effectiveBid) * pct;
                            setLimitPrice(price.toFixed(2));
                          }}
                          className="absolute inset-0 w-full opacity-0 cursor-pointer"
                          style={{ height: 12 }}
                        />
                        <div
                          className="absolute top-0 w-2.5 h-3 rounded-sm"
                          style={{
                            background: GOLD,
                            left: `calc(${sliderValue}% - 5px)`,
                            boxShadow: `0 0 6px ${GOLD}60`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10px]" style={{ color: DOWN }}>Ask</span>
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="font-mono text-[10px]" style={{ color: UP }}>{fmt(effectiveBid)}</span>
                      {midPrice != null && <span className="font-mono text-[10px]" style={{ color: GOLD }}>Mid {fmt(midPrice)}</span>}
                      <span className="font-mono text-[10px]" style={{ color: DOWN }}>{fmt(effectiveAsk)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isMultiLeg && needsStop && (
              <div>
                <label className="font-mono text-[10px] tracking-wider block mb-1" style={{ color: MUTED }}>STOP PRICE</label>
                <div className="flex items-center overflow-hidden" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                  <span className="pl-3 font-mono text-[12px]" style={{ color: DIM }}>$</span>
                  <input
                    type="number" inputMode="decimal" step="0.01" value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)} placeholder="0.00"
                    className="flex-1 px-1.5 py-2 font-mono text-[14px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: WHITE }}
                  />
                </div>
              </div>
            )}

            {!isMultiLeg && needsTrail && (
              <div>
                <label className="font-mono text-[10px] tracking-wider block mb-1" style={{ color: MUTED }}>TRAIL AMOUNT ($)</label>
                <div className="flex items-center overflow-hidden" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                  <span className="pl-3 font-mono text-[12px]" style={{ color: DIM }}>$</span>
                  <input
                    type="number" inputMode="decimal" step="0.01" value={trailOffset}
                    onChange={(e) => setTrailOffset(e.target.value)} placeholder="0.00"
                    className="flex-1 px-1.5 py-2 font-mono text-[14px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: WHITE }}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="font-mono text-[10px] tracking-wider block mb-1" style={{ color: MUTED }}>
                {isMultiLeg ? "QUANTITY (SPREADS)" : `QUANTITY ${isOption ? "(CONTRACTS)" : "(SHARES)"}`}
              </label>
              <div className="flex items-center overflow-hidden h-11" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-4 h-full transition-colors active:text-white" style={{ color: "#a1a1aa" }}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  ref={qtyInputRef}
                  type="number"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= 0) setQuantity(v);
                  }}
                  className="flex-1 text-center font-mono text-[16px] font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  style={{ color: WHITE, minWidth: 0 }}
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-4 h-full transition-colors active:text-white" style={{ color: "#a1a1aa" }}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-1.5 mt-1.5">
                {[1, 5, 10, 25, 50, 100].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(q)}
                    className="flex-1 py-1.5 font-mono text-[11px] font-medium transition-colors"
                    style={{
                      color: quantity === q ? GOLD : DIM,
                      background: quantity === q ? GOLD_DIM : CARD,
                      border: `1px solid ${quantity === q ? "rgba(251,191,36,0.3)" : BORDER2}`,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div className="px-3 py-2" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                <span className="font-mono text-[10px] block mb-0.5" style={{ color: MUTED }}>Effect</span>
                <button onClick={() => setPosEffect(posEffect === "OPENING" ? "CLOSING" : posEffect === "CLOSING" ? "AUTO" : "OPENING")} className="font-mono text-[12px] font-medium" style={{ color: TEXT }}>
                  {posEffect === "AUTO" ? "Auto" : posEffect === "OPENING" ? "Open" : "Close"}
                </button>
              </div>
              <div className="px-3 py-2" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                <span className="font-mono text-[10px] block mb-0.5" style={{ color: MUTED }}>Exchange</span>
                <span className="font-mono text-[12px] font-medium" style={{ color: TEXT }}>BEST</span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                <div>
                  <span className="font-mono text-[10px] block mb-0.5" style={{ color: MUTED }}>Ext Hrs</span>
                  <span className="font-mono text-[12px] font-medium" style={{ color: extendedHours ? GOLD : TEXT }}>
                    {extendedHours ? "On" : "Off"}
                  </span>
                </div>
                <button
                  onClick={() => setExtendedHours(!extendedHours)}
                  className="relative w-8 h-4 rounded-full transition-colors duration-200"
                  style={{ background: extendedHours ? GOLD : BORDER2 }}
                >
                  <div
                    className="absolute top-0.5 w-3 h-3 rounded-full transition-transform duration-200"
                    style={{
                      background: extendedHours ? BG : DIM,
                      transform: extendedHours ? "translateX(16px)" : "translateX(2px)",
                    }}
                  />
                </button>
              </div>
            </div>

            {estimatedCost != null && (
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: `${sideColor}08`, border: `1px solid ${sideColor}20` }}>
                <span className="font-mono text-[12px]" style={{ color: MUTED }}>
                  Est. {isMultiLeg ? (strategyIsCredit ? "Credit" : "Cost") : isBuy ? "Cost" : "Credit"}
                </span>
                <span className="font-mono text-[16px] font-bold" style={{ color: WHITE }}>
                  {fmtCurrency(Math.abs(estimatedCost))}
                </span>
              </div>
            )}

            <MiniPayoffChart
              legs={strategyLegs}
              isMultiLeg={isMultiLeg}
              side={side}
              quantity={quantity}
              limitPrice={parseFloat(limitPrice) || 0}
              isOption={isOption}
              last={quote?.last ?? 0}
            />

            <PortfolioImpactCard
              cost={estimatedCost}
              side={side}
              isOption={isOption}
              quantity={quantity}
            />

            <AiCoPilotPanel
              side={side}
              symbol={symbol}
              limitPrice={parseFloat(limitPrice) || 0}
              bid={quote?.bid ?? null}
              ask={quote?.ask ?? null}
              quantity={quantity}
              isOption={isOption}
            />

            {showBalances && (
              <div className="overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <span className="font-mono text-[11px] font-bold tracking-[0.12em]" style={{ color: GOLD }}>ACCOUNT BALANCES</span>
                  <button onClick={() => setBalancesHidden(!balancesHidden)} className="p-0.5" style={{ color: MUTED }}>
                    {balancesHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-2.5">
                  {[
                    { label: "Net Liq", value: balancesHidden ? "****" : fmtCurrency(accountSize) },
                    { label: "Buying Power", value: balancesHidden ? "****" : fmtCurrency(accountSize) },
                    { label: "Day P&L", value: balancesHidden ? "****" : "$0.00" },
                    { label: "Margin Used", value: balancesHidden ? "****" : "$0.00" },
                  ].map((b, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="font-mono text-[11px]" style={{ color: MUTED }}>{b.label}</span>
                      <span className="font-mono text-[12px] font-medium" style={{ color: TEXT }}>{b.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setShowBalances(!showBalances)}
              className="w-full flex items-center justify-center gap-1 py-1.5"
              style={{ color: MUTED }}
            >
              <span className="font-mono text-[11px]">{showBalances ? "Hide" : "Show"} Balances</span>
              <ChevronDown className="w-3.5 h-3.5" style={{ transform: showBalances ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
            </button>

          </div>
        </div>
      ) : stage === "submitting" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: GOLD }} />
          <p className="font-mono text-[13px]" style={{ color: "#a1a1aa" }}>Submitting order...</p>
        </div>
      ) : stage === "success" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <CheckCircle2 className="w-14 h-14" style={{ color: UP }} />
          <p className="font-mono text-[16px] font-bold" style={{ color: WHITE }}>Order Placed</p>
          <p className="font-mono text-[12px] text-center" style={{ color: MUTED }}>
            {side} {quantity} {isOption ? "contract(s)" : "share(s)"} of {displaySymbol}
          </p>
          {orderId && (
            <p className="font-mono text-[11px]" style={{ color: DIM }}>Order ID: {orderId}</p>
          )}
          <button
            onClick={onClose}
            className="mt-4 w-full max-w-xs py-3 font-mono text-[13px] font-bold tracking-wider transition-colors"
            style={{ background: FIELD, color: TEXT, border: `1px solid ${BORDER2}` }}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <AlertTriangle className="w-14 h-14" style={{ color: DOWN }} />
          <p className="font-mono text-[16px] font-bold" style={{ color: WHITE }}>Order Failed</p>
          <p className="font-mono text-[12px] text-center max-w-sm" style={{ color: DOWN }}>{errorMsg}</p>
          <div className="flex gap-3 mt-4 w-full max-w-xs">
            <button
              onClick={() => setStage("form")}
              className="flex-1 py-3 font-mono text-[13px] font-bold tracking-wider"
              style={{ background: FIELD, color: TEXT, border: `1px solid ${BORDER2}` }}
            >
              Edit Order
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 font-mono text-[13px] font-bold tracking-wider"
              style={{ background: FIELD, color: MUTED, border: `1px solid ${BORDER2}` }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {stage === "form" && (
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-8 pt-3" style={{ background: `linear-gradient(transparent, #0a0a0a 30%)` }}>
          {blockedByRisk && (
            <div className="mb-2 px-3 py-2 flex items-center gap-2" style={{ background: "rgba(242,54,69,0.08)", border: `1px solid rgba(242,54,69,0.3)` }}>
              <ShieldX className="w-4 h-4 shrink-0" style={{ color: DOWN }} />
              <span className="font-mono text-[12px] font-medium" style={{ color: DOWN }}>Risk check failed — review blocked</span>
            </div>
          )}
          {!blockedByRisk && overallRisk === "YELLOW" && preTradeEnabled && (
            <div className="mb-2 px-3 py-2 flex items-center gap-2" style={{ background: "rgba(251,191,36,0.06)", border: `1px solid rgba(251,191,36,0.2)` }}>
              <ShieldAlert className="w-4 h-4 shrink-0" style={{ color: GOLD }} />
              <span className="font-mono text-[12px] font-medium" style={{ color: GOLD }}>Proceed with caution — risk warnings active</span>
            </div>
          )}
          <button
            onClick={() => setStage("review")}
            disabled={!isValid}
            className="w-full py-3.5 font-mono text-[14px] font-bold tracking-[0.15em] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{
              background: isValid ? (isBuy ? UP : DOWN) : BORDER2,
              color: isValid ? "#fff" : DIM,
            }}
          >
            {isCloseOrder && isMultiLeg ? "REVIEW SPREAD CLOSE" : isCloseOrder ? "REVIEW CLOSE ORDER" : isMultiLeg ? "REVIEW STRATEGY ORDER" : `REVIEW ${side} ORDER`}
          </button>
        </div>
      )}

      {stage === "review" && (
        <div className="fixed inset-0 z-[220] flex flex-col" style={{ background: "#0a0a0a" }}>
          <div
            className="w-full h-full flex flex-col p-5 space-y-3 overflow-y-auto animate-in fade-in duration-200"
            style={{ background: CARD }}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-mono font-bold text-[14px] tracking-wider" style={{ color: WHITE }}>{isCloseOrder ? "Confirm Close" : "Confirm Order"}</h3>
              <button onClick={() => setStage("form")} className="p-1" style={{ color: MUTED }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 p-3" style={{ background: "#0a0a0c", border: `1px solid ${BORDER}` }}>
              {isMultiLeg && strategyLegs ? (
                <>
                  <div className="flex justify-between mb-1">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>{isCloseOrder ? "Close" : "Strategy"}</span>
                    <span className="font-mono text-[11px] font-bold" style={{ color: isCloseOrder ? DOWN : GOLD }}>
                      {isCloseOrder ? `CLOSE ${strategyLegs.length}-LEG` : `${strategyLegs.length}-Leg ${strategyIsCredit ? "Credit" : "Debit"}`}
                    </span>
                  </div>
                  {strategyLegs.map((leg, i) => {
                    const isBuyLeg = leg.instruction.startsWith("BUY");
                    const dirColor = isBuyLeg ? UP : DOWN;
                    const dirShort = isBuyLeg
                      ? (leg.instruction === "BUY_TO_OPEN" ? "BTO" : "BTC")
                      : (leg.instruction === "SELL_TO_OPEN" ? "STO" : "STC");
                    const qtySign = isBuyLeg ? "+" : "-";
                    return (
                      <div key={i} className="flex items-center" style={{ height: 22 }}>
                        <span className="font-mono text-[11px] font-bold" style={{ color: dirColor, width: 32 }}>{dirShort}</span>
                        <span className="font-mono text-[11px] font-bold" style={{ color: dirColor, width: 26 }}>{qtySign}{leg.quantity * quantity}</span>
                        <span className="font-mono text-[11px] flex-1" style={{ color: TEXT }}>
                          {leg.strike} {leg.optionType === "CALL" ? "C" : "P"}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between mt-1">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Net Price</span>
                    <span className="font-mono text-[12px]" style={{ color: TEXT }}>${limitPrice}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Action</span>
                    <span className="font-mono text-[12px] font-bold" style={{ color: sideColor }}>
                      {isOption ? (optionInstruction ?? (side === "BUY" ? "BUY TO OPEN" : "SELL TO CLOSE")) : side}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Symbol</span>
                    <span className="font-mono text-[12px]" style={{ color: TEXT }}>{displaySymbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Quantity</span>
                    <span className="font-mono text-[12px]" style={{ color: TEXT }}>{quantity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Order Type</span>
                    <span className="font-mono text-[12px]" style={{ color: TEXT }}>{ORDER_TYPES.find((t) => t.value === orderType)?.label}</span>
                  </div>
                  {needsLimit && (
                    <div className="flex justify-between">
                      <span className="font-mono text-[10px]" style={{ color: MUTED }}>Limit Price</span>
                      <span className="font-mono text-[12px]" style={{ color: TEXT }}>${limitPrice}</span>
                    </div>
                  )}
                  {needsStop && (
                    <div className="flex justify-between">
                      <span className="font-mono text-[10px]" style={{ color: MUTED }}>Stop Price</span>
                      <span className="font-mono text-[12px]" style={{ color: TEXT }}>${stopPrice}</span>
                    </div>
                  )}
                  {needsTrail && (
                    <div className="flex justify-between">
                      <span className="font-mono text-[10px]" style={{ color: MUTED }}>Trail Amount</span>
                      <span className="font-mono text-[12px]" style={{ color: TEXT }}>${trailOffset}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between">
                <span className="font-mono text-[10px]" style={{ color: MUTED }}>Duration</span>
                <span className="font-mono text-[12px]" style={{ color: TEXT }}>{DURATIONS.find((d) => d.value === duration)?.label}{extendedHours ? " + Ext" : ""}</span>
              </div>
              <div className="border-t my-1.5" style={{ borderColor: BORDER }} />
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: "#a1a1aa" }}>Est. {isMultiLeg ? (strategyIsCredit ? "Credit" : "Cost") : side === "BUY" ? "Cost" : "Credit"}</span>
                <span className="font-mono text-[15px] font-bold" style={{ color: WHITE }}>
                  {estimatedCost != null ? fmtCurrency(Math.abs(estimatedCost)) : "—"}
                </span>
              </div>
            </div>

            <div className="p-3 flex items-start gap-2" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GOLD }} />
              <p className="font-mono text-[11px] leading-relaxed" style={{ color: GOLD }}>
                This will place a live order with Schwab. Verify all details before confirming.
              </p>
            </div>

            <div className="flex-1" />

            <div className="flex gap-3 pt-1 pb-4 shrink-0">
              <button
                onClick={() => setStage("form")}
                className="flex-1 py-3 font-mono text-[12px] font-bold tracking-wider"
                style={{ background: FIELD, color: "#a1a1aa", border: `1px solid ${BORDER2}` }}
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                className="flex-[2] py-3 font-mono text-[13px] font-bold tracking-wider active:scale-[0.98] transition-transform"
                style={{
                  background: `linear-gradient(180deg, ${isBuy ? UP : DOWN} 0%, ${isBuy ? "#00a854" : "#cc2d3a"} 100%)`,
                  color: "#fff",
                  boxShadow: `0 4px 20px ${isBuy ? "rgba(0,209,102,0.3)" : "rgba(242,54,69,0.3)"}`,
                }}
              >
                {isCloseOrder && isMultiLeg ? "Confirm Close" : isCloseOrder ? "Confirm Close" : isMultiLeg ? "Confirm Strategy" : `Confirm ${side}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
