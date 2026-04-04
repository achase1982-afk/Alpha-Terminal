import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { X, Minus, Plus, Loader2, CheckCircle2, AlertTriangle, ChevronDown, Shield, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

type OrderSide = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | "TRAILING_STOP";
type Duration = "DAY" | "GOOD_TILL_CANCEL" | "FILL_OR_KILL";
type ConfirmStage = "form" | "review" | "submitting" | "success" | "error";
type RiskLevel = "GREEN" | "YELLOW" | "RED";

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "MARKET", label: "Market" },
  { value: "LIMIT", label: "Limit" },
  { value: "STOP", label: "Stop" },
  { value: "STOP_LIMIT", label: "Stop Limit" },
  { value: "TRAILING_STOP", label: "Trail Stop" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "GOOD_TILL_CANCEL", label: "GTC" },
  { value: "FILL_OR_KILL", label: "FOK" },
];

const GOLD = "#FFB800";
const UP = "#00d166";
const DOWN = "#f23645";
const BG = "#0a0a0a";
const CARD = "#141416";
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

  const price = limitPrice ?? last ?? 0;
  const maxRisk = accountSize * (preTradeMaxPositionPct / 100);
  const positionRisk = price * quantity * (isOption ? 100 : 1);
  if (positionRisk > 0 && maxRisk > 0) {
    if (positionRisk <= maxRisk) {
      checks.push({ id: "size", label: "Position Size", level: "GREEN", detail: `${fmtCurrency(positionRisk)} <= ${fmtCurrency(maxRisk)} max` });
    } else if (positionRisk <= maxRisk * 1.5) {
      checks.push({ id: "size", label: "Position Size", level: "YELLOW", detail: `${fmtCurrency(positionRisk)} near ${fmtCurrency(maxRisk)} max` });
    } else {
      checks.push({ id: "size", label: "Position Size", level: "RED", detail: `${fmtCurrency(positionRisk)} > ${fmtCurrency(maxRisk)} max` });
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
}

export function OrderTicket({ isOpen, onClose, initialSide, optionSymbol, optionInstruction, strategyLegs, strategyNetPrice, strategyIsCredit }: OrderTicketProps) {
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
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const isMultiLeg = !!strategyLegs && strategyLegs.length >= 1;
  const isOption = !!optionSymbol || isMultiLeg;
  const displaySymbol = isMultiLeg ? `${symbol} Strategy (${strategyLegs!.length} legs)` : optionSymbol ?? symbol;

  useEffect(() => {
    if (!isOpen) return;
    setSide(initialSide ?? "BUY");
    setOrderType("LIMIT");
    setQuantity(isMultiLeg ? 1 : 1);
    setLimitPrice(isMultiLeg && strategyNetPrice != null ? strategyNetPrice.toFixed(2) : "");
    setStopPrice("");
    setTrailOffset("");
    setDuration("DAY");
    setExtendedHours(false);
    setStage("form");
    setOrderId(null);
    setErrorMsg("");
    setShowOrderType(false);
  }, [isOpen, initialSide, isMultiLeg, strategyNetPrice]);

  useEffect(() => {
    if (!isOpen) return;
    fetchWithAuth("/api/portfolio/account-hash")
      .then((r) => r.json())
      .then((d) => { if (d.hashValue) setAccountHash(d.hashValue); })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && quote?.ask != null && !limitPrice) {
      setLimitPrice(quote.ask.toFixed(2));
    }
  }, [isOpen, quote?.ask]);

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

  const riskChecks = useMemo(() => {
    if (!preTradeEnabled) return [];
    return runPreTradeChecks({
      side,
      quantity,
      limitPrice: parseFloat(limitPrice) || null,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      last: quote?.last ?? null,
      regime: pulseData?.structuralRegime?.label ?? null,
      sessionBias: pulseData?.sessionBias?.label ?? null,
      preTradeMinRR,
      preTradeMaxPositionPct,
      preTradeMinDTE,
      accountSize,
      stratMinPoP,
      isOption,
    });
  }, [side, quantity, limitPrice, quote?.bid, quote?.ask, quote?.last, pulseData, preTradeMinRR, preTradeMaxPositionPct, preTradeMinDTE, accountSize, stratMinPoP, isOption, preTradeEnabled]);

  const overallRisk = useMemo(() => getOverallLevel(riskChecks), [riskChecks]);
  const riskSummary = useMemo(() => getRiskSummary(riskChecks, side, overallRisk), [riskChecks, side, overallRisk]);
  const blockedByRisk = preTradeEnabled && preTradeBlockOnRed && overallRisk === "RED";

  const isValid = useMemo(() => {
    if (quantity <= 0) return false;
    if (!accountHash) return false;
    if (blockedByRisk) return false;
    if (isMultiLeg) {
      return !!limitPrice && parseFloat(limitPrice) > 0;
    }
    if (needsLimit && (!limitPrice || parseFloat(limitPrice) <= 0)) return false;
    if (needsStop && (!stopPrice || parseFloat(stopPrice) <= 0)) return false;
    if (needsTrail && (!trailOffset || parseFloat(trailOffset) <= 0)) return false;
    return true;
  }, [quantity, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset, accountHash, blockedByRisk, isMultiLeg]);

  const buildSchwabOrder = useCallback(() => {
    if (isMultiLeg && strategyLegs) {
      const order: Record<string, unknown> = {
        orderType: strategyIsCredit ? "NET_CREDIT" : "NET_DEBIT",
        session: extendedHours ? "SEAMLESS" : "NORMAL",
        duration: duration,
        price: limitPrice,
        complexOrderStrategyType: "NONE",
        orderStrategyType: "SINGLE",
        orderLegCollection: strategyLegs.map(leg => ({
          instruction: leg.instruction,
          quantity: leg.quantity * quantity,
          instrument: {
            symbol: leg.schwabSymbol,
            assetType: "OPTION",
          },
        })),
      };
      return order;
    }
    const order: Record<string, unknown> = {
      orderType: orderType,
      session: extendedHours ? "SEAMLESS" : "NORMAL",
      duration: duration,
      orderStrategyType: "SINGLE",
      orderLegCollection: [
        {
          instruction: isOption ? (optionInstruction ?? (side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_CLOSE")) : side,
          quantity: quantity,
          instrument: {
            symbol: isMultiLeg ? symbol : (optionSymbol ?? symbol),
            assetType: isOption ? "OPTION" : "EQUITY",
          },
        },
      ],
    };
    if (needsLimit) order.price = limitPrice;
    if (needsStop) order.stopPrice = stopPrice;
    if (needsTrail) {
      order.stopPriceLinkBasis = "LAST";
      order.stopPriceLinkType = "VALUE";
      order.stopPriceOffset = trailOffset;
    }
    return order;
  }, [orderType, extendedHours, duration, side, quantity, symbol, optionSymbol, isOption, isMultiLeg, strategyLegs, strategyIsCredit, optionInstruction, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset]);

  const handleSubmit = useCallback(async () => {
    if (!accountHash) return;
    setStage("submitting");
    try {
      const order = buildSchwabOrder();
      const res = await fetchWithAuth("/api/portfolio/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHash, order }),
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
  }, [accountHash, buildSchwabOrder]);

  if (!isOpen) return null;

  const isBuy = side === "BUY";
  const sideColor = isBuy ? UP : DOWN;
  const changePct = quote?.changePct;
  const changeColor = (changePct ?? 0) >= 0 ? UP : DOWN;

  return (
    <div className="fixed inset-0 z-[210] flex flex-col" style={{ background: BG }}>

      <header className="shrink-0 flex items-center h-12 px-4 border-b" style={{ borderColor: BORDER, background: "#111113" }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-[15px] tracking-wide" style={{ color: WHITE }}>{symbol}</span>
            <span className="font-mono text-[13px]" style={{ color: changeColor }}>
              {fmt(quote?.last)} {changePct != null ? `${changePct >= 0 ? "+" : ""}${fmt(changePct)}%` : ""}
            </span>
          </div>
          {isOption && (
            <p className="font-mono text-[10px] truncate" style={{ color: MUTED }}>{optionSymbol}</p>
          )}
        </div>
        <span className="font-mono font-bold text-[11px] tracking-widest mr-4" style={{ color: MUTED }}>ORDER TICKET</span>
        <button onClick={onClose} className="p-2 -mr-2 rounded-lg transition-colors active:text-white" style={{ color: MUTED }}>
          <X className="w-5 h-5" />
        </button>
      </header>

      {stage === "form" || stage === "review" ? (
        <div className="flex-1 overflow-y-auto pb-32">
          <div className="p-4 space-y-5">

            {isMultiLeg && strategyLegs ? (
              <div className="rounded-xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                <div className="px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <span className="font-mono text-[11px] font-bold tracking-wider" style={{ color: GOLD }}>STRATEGY LEGS</span>
                </div>
                <div className="px-4 py-2 space-y-1.5">
                  {strategyLegs.map((leg, i) => (
                    <div key={i} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold" style={{ color: leg.instruction.startsWith("BUY") ? UP : DOWN }}>
                          {leg.instruction.replace(/_/g, " ")}
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: TEXT }}>
                          {leg.quantity}x {leg.strike} {leg.optionType}
                        </span>
                      </div>
                      <div className="flex gap-2 font-mono text-[9px]" style={{ color: MUTED }}>
                        {leg.bid != null && <span>B:{leg.bid.toFixed(2)}</span>}
                        {leg.ask != null && <span>A:{leg.ask.toFixed(2)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 flex justify-between" style={{ borderTop: `1px solid ${BORDER}`, background: `${strategyIsCredit ? UP : DOWN}08` }}>
                  <span className="font-mono text-[11px]" style={{ color: MUTED }}>Net {strategyIsCredit ? "Credit" : "Debit"}</span>
                  <span className="font-mono text-[13px] font-bold" style={{ color: strategyIsCredit ? UP : DOWN }}>
                    ${strategyNetPrice?.toFixed(2) ?? "—"} per spread
                  </span>
                </div>
              </div>
            ) : (
            <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER2}` }}>
              {(["BUY", "SELL"] as OrderSide[]).map((s) => {
                const active = side === s;
                const bg = active
                  ? s === "BUY" ? "rgba(0,209,102,0.15)" : "rgba(242,54,69,0.15)"
                  : "transparent";
                const clr = active
                  ? s === "BUY" ? UP : DOWN
                  : DIM;
                const bdr = active
                  ? s === "BUY" ? UP : DOWN
                  : "transparent";
                return (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className="flex-1 py-3.5 font-mono font-bold text-[14px] tracking-wider transition-all duration-150"
                    style={{ background: bg, color: clr, borderBottom: `2px solid ${bdr}` }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            )}

            {!isMultiLeg && (<div>
              <label className="font-mono text-[11px] tracking-wider block mb-1.5" style={{ color: MUTED }}>ORDER TYPE</label>
              <button
                onClick={() => setShowOrderType(!showOrderType)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl font-mono text-[13px] transition-colors"
                style={{ background: "#1a1a1e", border: `1px solid ${BORDER2}`, color: TEXT }}
              >
                {ORDER_TYPES.find((t) => t.value === orderType)?.label}
                <ChevronDown className="w-4 h-4" style={{ color: DIM }} />
              </button>
              {showOrderType && (
                <div className="mt-1 rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: `1px solid ${BORDER2}` }}>
                  {ORDER_TYPES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => { setOrderType(t.value); setShowOrderType(false); }}
                      className="w-full text-left px-4 py-2.5 font-mono text-[13px] transition-colors"
                      style={{
                        color: orderType === t.value ? GOLD : "#a1a1aa",
                        background: orderType === t.value ? "rgba(255,184,0,0.06)" : "transparent",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>)}

            {isMultiLeg && (
              <div>
                <label className="font-mono text-[11px] tracking-wider block mb-1.5" style={{ color: MUTED }}>
                  {strategyIsCredit ? "NET CREDIT PRICE" : "NET DEBIT PRICE"}
                </label>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: `1px solid ${BORDER2}` }}>
                  <span className="pl-4 font-mono text-[13px]" style={{ color: DIM }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-2 py-3 font-mono text-[15px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: WHITE }}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="font-mono text-[11px] tracking-wider block mb-1.5" style={{ color: MUTED }}>
                {isMultiLeg ? "QUANTITY (SPREADS)" : `QUANTITY ${isOption ? "(CONTRACTS)" : "(SHARES)"}`}
              </label>
              <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: `1px solid ${BORDER2}` }}>
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-4 py-3 transition-colors active:text-white" style={{ color: "#a1a1aa" }}
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
                  className="flex-1 text-center font-mono text-[18px] font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  style={{ color: WHITE, minWidth: 0 }}
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-4 py-3 transition-colors active:text-white" style={{ color: "#a1a1aa" }}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                {[1, 5, 10, 25, 50, 100].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(q)}
                    className="flex-1 py-1.5 rounded-lg font-mono text-[11px] font-medium transition-colors"
                    style={{
                      color: quantity === q ? GOLD : DIM,
                      background: quantity === q ? "rgba(255,184,0,0.08)" : CARD,
                      border: `1px solid ${quantity === q ? "rgba(255,184,0,0.3)" : BORDER2}`,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {!isMultiLeg && needsLimit && (
              <div>
                <label className="font-mono text-[11px] tracking-wider block mb-1.5" style={{ color: MUTED }}>LIMIT PRICE</label>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: `1px solid ${BORDER2}` }}>
                  <span className="pl-4 font-mono text-[13px]" style={{ color: DIM }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-2 py-3 font-mono text-[15px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: WHITE }}
                  />
                  <div className="flex flex-col gap-0.5 pr-2">
                    <button
                      onClick={() => { if (quote?.bid != null) setLimitPrice(quote.bid.toFixed(2)); }}
                      className="px-2 py-1 rounded font-mono text-[10px] font-bold transition-colors"
                      style={{ color: UP, background: "rgba(0,209,102,0.08)" }}
                    >
                      BID {fmt(quote?.bid)}
                    </button>
                    <button
                      onClick={() => { if (quote?.ask != null) setLimitPrice(quote.ask.toFixed(2)); }}
                      className="px-2 py-1 rounded font-mono text-[10px] font-bold transition-colors"
                      style={{ color: DOWN, background: "rgba(242,54,69,0.08)" }}
                    >
                      ASK {fmt(quote?.ask)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!isMultiLeg && needsStop && (
              <div>
                <label className="font-mono text-[11px] tracking-wider block mb-1.5" style={{ color: MUTED }}>STOP PRICE</label>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: `1px solid ${BORDER2}` }}>
                  <span className="pl-4 font-mono text-[13px]" style={{ color: DIM }}>$</span>
                  <input
                    type="number" inputMode="decimal" step="0.01" value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)} placeholder="0.00"
                    className="flex-1 px-2 py-3 font-mono text-[15px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: WHITE }}
                  />
                </div>
              </div>
            )}

            {!isMultiLeg && needsTrail && (
              <div>
                <label className="font-mono text-[11px] tracking-wider block mb-1.5" style={{ color: MUTED }}>TRAIL AMOUNT ($)</label>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: `1px solid ${BORDER2}` }}>
                  <span className="pl-4 font-mono text-[13px]" style={{ color: DIM }}>$</span>
                  <input
                    type="number" inputMode="decimal" step="0.01" value={trailOffset}
                    onChange={(e) => setTrailOffset(e.target.value)} placeholder="0.00"
                    className="flex-1 px-2 py-3 font-mono text-[15px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: WHITE }}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="font-mono text-[11px] tracking-wider block mb-1.5" style={{ color: MUTED }}>TIME IN FORCE</label>
              <div className="flex gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className="flex-1 py-2.5 rounded-xl font-mono text-[12px] font-bold tracking-wider transition-all duration-150"
                    style={{
                      color: duration === d.value ? GOLD : MUTED,
                      background: duration === d.value ? "rgba(255,184,0,0.08)" : "#1a1a1e",
                      border: `1px solid ${duration === d.value ? "rgba(255,184,0,0.3)" : BORDER2}`,
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="font-mono text-[12px]" style={{ color: "#a1a1aa" }}>Extended Hours</span>
              <button
                onClick={() => setExtendedHours(!extendedHours)}
                className="relative w-11 h-6 rounded-full transition-colors duration-200"
                style={{ background: extendedHours ? GOLD : BORDER2 }}
              >
                <div
                  className="absolute top-0.5 w-5 h-5 rounded-full transition-transform duration-200"
                  style={{
                    background: extendedHours ? BG : DIM,
                    transform: extendedHours ? "translateX(22px)" : "translateX(2px)",
                  }}
                />
              </button>
            </div>

            {preTradeEnabled && riskChecks.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" style={{ color: GOLD }} />
                    <span className="font-mono text-[11px] font-bold tracking-wider" style={{ color: GOLD }}>PRE-TRADE RISK CHECK</span>
                  </div>
                  <span className="font-mono text-[9px]" style={{ color: DIM }}>LIVE</span>
                </div>

                <div className="w-full h-1" style={{ background: levelColor(overallRisk) }} />

                <div className="px-4 py-2 space-y-1.5">
                  {riskChecks.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 py-1">
                      <RiskIcon level={c.level} />
                      <span className="font-mono text-[11px] font-medium" style={{ color: TEXT, minWidth: 90 }}>{c.label}</span>
                      <span className="font-mono text-[10px] flex-1 text-right truncate" style={{ color: levelColor(c.level) }}>{c.detail}</span>
                    </div>
                  ))}
                </div>

                <div className="px-4 py-3" style={{ borderTop: `1px solid ${BORDER}`, background: `${levelColor(overallRisk)}08` }}>
                  <p className="font-mono text-[10px] leading-relaxed" style={{ color: levelColor(overallRisk) }}>
                    {overallRisk === "RED" ? "\u{1F534}" : overallRisk === "YELLOW" ? "\u{1F7E1}" : "\u{1F7E2}"} {riskSummary}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-xl p-4 space-y-2" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Side</span>
                <span className="font-mono text-[12px] font-bold" style={{ color: sideColor }}>{side}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Symbol</span>
                <span className="font-mono text-[12px]" style={{ color: TEXT }}>{displaySymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Qty</span>
                <span className="font-mono text-[12px]" style={{ color: TEXT }}>{quantity} {isOption ? "contracts" : "shares"}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Type</span>
                <span className="font-mono text-[12px]" style={{ color: TEXT }}>{ORDER_TYPES.find((t) => t.value === orderType)?.label}</span>
              </div>
              {needsLimit && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px]" style={{ color: MUTED }}>Limit</span>
                  <span className="font-mono text-[12px]" style={{ color: TEXT }}>${limitPrice || "—"}</span>
                </div>
              )}
              {needsStop && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px]" style={{ color: MUTED }}>Stop</span>
                  <span className="font-mono text-[12px]" style={{ color: TEXT }}>${stopPrice || "—"}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Duration</span>
                <span className="font-mono text-[12px]" style={{ color: TEXT }}>{DURATIONS.find((d) => d.value === duration)?.label}</span>
              </div>
              {extendedHours && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px]" style={{ color: MUTED }}>Session</span>
                  <span className="font-mono text-[12px]" style={{ color: GOLD }}>Extended</span>
                </div>
              )}
              <div className="border-t my-2" style={{ borderColor: BORDER }} />
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Est. {side === "BUY" ? "Cost" : "Credit"}</span>
                <span className="font-mono text-[14px] font-bold" style={{ color: WHITE }}>
                  {estimatedCost != null ? fmtCurrency(estimatedCost) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Bid / Ask</span>
                <span className="font-mono text-[12px]" style={{ color: "#a1a1aa" }}>
                  {fmt(quote?.bid)} / {fmt(quote?.ask)}
                </span>
              </div>
            </div>
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
            className="mt-4 w-full max-w-xs py-3 rounded-xl font-mono text-[13px] font-bold tracking-wider transition-colors"
            style={{ background: "#1a1a1e", color: TEXT, border: `1px solid ${BORDER2}` }}
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
              className="flex-1 py-3 rounded-xl font-mono text-[13px] font-bold tracking-wider"
              style={{ background: "#1a1a1e", color: TEXT, border: `1px solid ${BORDER2}` }}
            >
              Edit Order
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-mono text-[13px] font-bold tracking-wider"
              style={{ background: "#1a1a1e", color: MUTED, border: `1px solid ${BORDER2}` }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {(stage === "form") && (
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-8" style={{ background: `linear-gradient(transparent, ${BG} 20%)` }}>
          {blockedByRisk && (
            <div className="mb-2 rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: "rgba(242,54,69,0.08)", border: `1px solid rgba(242,54,69,0.2)` }}>
              <ShieldX className="w-4 h-4 shrink-0" style={{ color: DOWN }} />
              <span className="font-mono text-[10px]" style={{ color: DOWN }}>Risk check failed — review blocked</span>
            </div>
          )}
          {!blockedByRisk && overallRisk === "YELLOW" && preTradeEnabled && (
            <div className="mb-2 rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: "rgba(255,184,0,0.06)", border: `1px solid rgba(255,184,0,0.15)` }}>
              <ShieldAlert className="w-4 h-4 shrink-0" style={{ color: GOLD }} />
              <span className="font-mono text-[10px]" style={{ color: GOLD }}>Proceed with caution — risk warnings active</span>
            </div>
          )}
          <button
            onClick={() => setStage("review")}
            disabled={!isValid}
            className="w-full py-4 rounded-xl font-mono text-[14px] font-bold tracking-wider transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{
              background: isValid
                ? `linear-gradient(180deg, ${isBuy ? UP : DOWN} 0%, ${isBuy ? "#00a854" : "#cc2d3a"} 100%)`
                : BORDER2,
              color: isValid ? "#fff" : DIM,
              boxShadow: isValid ? `0 4px 20px ${isBuy ? "rgba(0,209,102,0.3)" : "rgba(242,54,69,0.3)"}` : "none",
            }}
          >
            {isMultiLeg ? "Review Strategy Order" : `Review ${side} Order`}
          </button>
        </div>
      )}

      {stage === "review" && (
        <div className="fixed inset-0 z-[220] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div
            className="w-full max-w-lg rounded-t-2xl p-6 space-y-4 animate-in slide-in-from-bottom duration-300"
            style={{ background: CARD, border: `1px solid ${BORDER2}`, borderBottom: "none" }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-mono font-bold text-[15px] tracking-wider" style={{ color: WHITE }}>Confirm Order</h3>
              <button onClick={() => setStage("form")} className="p-1" style={{ color: MUTED }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 rounded-xl p-4" style={{ background: "#0a0a0c", border: `1px solid ${BORDER}` }}>
              {isMultiLeg && strategyLegs ? (
                <>
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: MUTED }}>Type</span>
                    <span className="font-mono text-[13px] font-bold" style={{ color: GOLD }}>Multi-Leg Strategy</span>
                  </div>
                  {strategyLegs.map((leg, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="font-mono text-[10px]" style={{ color: leg.instruction.startsWith("BUY") ? UP : DOWN }}>
                        {leg.instruction.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-[11px]" style={{ color: TEXT }}>
                        {leg.quantity * quantity}x {leg.strike} {leg.optionType}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: MUTED }}>Price Type</span>
                    <span className="font-mono text-[13px]" style={{ color: TEXT }}>{strategyIsCredit ? "Net Credit" : "Net Debit"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: MUTED }}>Net Price</span>
                    <span className="font-mono text-[13px]" style={{ color: TEXT }}>${limitPrice}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: MUTED }}>Action</span>
                    <span className="font-mono text-[13px] font-bold" style={{ color: sideColor }}>
                      {isOption ? (optionInstruction ?? (side === "BUY" ? "BUY TO OPEN" : "SELL TO CLOSE")) : side}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: MUTED }}>Symbol</span>
                    <span className="font-mono text-[13px]" style={{ color: TEXT }}>{displaySymbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: MUTED }}>Quantity</span>
                    <span className="font-mono text-[13px]" style={{ color: TEXT }}>{quantity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: MUTED }}>Order Type</span>
                    <span className="font-mono text-[13px]" style={{ color: TEXT }}>{ORDER_TYPES.find((t) => t.value === orderType)?.label}</span>
                  </div>
                  {needsLimit && (
                    <div className="flex justify-between">
                      <span className="font-mono text-[11px]" style={{ color: MUTED }}>Limit Price</span>
                      <span className="font-mono text-[13px]" style={{ color: TEXT }}>${limitPrice}</span>
                    </div>
                  )}
                  {needsStop && (
                    <div className="flex justify-between">
                      <span className="font-mono text-[11px]" style={{ color: MUTED }}>Stop Price</span>
                      <span className="font-mono text-[13px]" style={{ color: TEXT }}>${stopPrice}</span>
                    </div>
                  )}
                  {needsTrail && (
                    <div className="flex justify-between">
                      <span className="font-mono text-[11px]" style={{ color: MUTED }}>Trail Amount</span>
                      <span className="font-mono text-[13px]" style={{ color: TEXT }}>${trailOffset}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between">
                <span className="font-mono text-[11px]" style={{ color: MUTED }}>Duration</span>
                <span className="font-mono text-[13px]" style={{ color: TEXT }}>{DURATIONS.find((d) => d.value === duration)?.label}{extendedHours ? " + Ext Hours" : ""}</span>
              </div>
              <div className="border-t my-2" style={{ borderColor: BORDER }} />
              <div className="flex justify-between">
                <span className="font-mono text-[12px]" style={{ color: "#a1a1aa" }}>Est. {isMultiLeg ? (strategyIsCredit ? "Credit" : "Cost") : side === "BUY" ? "Cost" : "Credit"}</span>
                <span className="font-mono text-[16px] font-bold" style={{ color: WHITE }}>
                  {estimatedCost != null ? fmtCurrency(estimatedCost) : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.15)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GOLD }} />
              <p className="font-mono text-[10px] leading-relaxed" style={{ color: GOLD }}>
                This will place a live order with Schwab. Please verify all details before confirming.
              </p>
            </div>

            <div className="flex gap-3 pt-2 pb-4">
              <button
                onClick={() => setStage("form")}
                className="flex-1 py-3.5 rounded-xl font-mono text-[13px] font-bold tracking-wider"
                style={{ background: "#1a1a1e", color: "#a1a1aa", border: `1px solid ${BORDER2}` }}
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                className="flex-[2] py-3.5 rounded-xl font-mono text-[14px] font-bold tracking-wider active:scale-[0.98] transition-transform"
                style={{
                  background: `linear-gradient(180deg, ${isBuy ? UP : DOWN} 0%, ${isBuy ? "#00a854" : "#cc2d3a"} 100%)`,
                  color: "#fff",
                  boxShadow: `0 4px 20px ${isBuy ? "rgba(0,209,102,0.3)" : "rgba(242,54,69,0.3)"}`,
                }}
              >
                {isMultiLeg ? "Confirm Strategy" : `Confirm ${side}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
