import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  X, Minus, Plus, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  ShieldX, Lock, Unlock,
  Sparkles, ArrowLeft,
} from "lucide-react";

type OrderSide = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | "TRAILING_STOP" | "TRAILING_STOP_LIMIT" | "MARKET_ON_CLOSE" | "LIMIT_ON_CLOSE";
type Duration = "DAY" | "GOOD_TILL_CANCEL" | "FILL_OR_KILL" | "SEAMLESS" | "GOOD_TILL_CANCEL_EXT" | "AM" | "PM";
type ConfirmStage = "form" | "review" | "submitting" | "success" | "error";
type RiskLevel = "GREEN" | "YELLOW" | "RED";
type PositionEffect = "OPENING" | "CLOSING" | "AUTO";
type TicketMode = "options" | "stock";

const ORDER_TYPES: { value: OrderType; label: string; short: string }[] = [
  { value: "MARKET", label: "Market", short: "MKT" },
  { value: "LIMIT", label: "Limit", short: "LMT" },
  { value: "STOP", label: "Stop", short: "STP" },
  { value: "STOP_LIMIT", label: "Stop Limit", short: "STP LMT" },
  { value: "TRAILING_STOP", label: "Trail Stop", short: "TRAIL" },
  { value: "TRAILING_STOP_LIMIT", label: "Trail Stop Limit", short: "TRAIL LMT" },
  { value: "MARKET_ON_CLOSE", label: "MOC", short: "MOC" },
  { value: "LIMIT_ON_CLOSE", label: "LOC", short: "LOC" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "GOOD_TILL_CANCEL", label: "GTC" },
  { value: "FILL_OR_KILL", label: "FOK" },
  { value: "SEAMLESS", label: "EXT" },
  { value: "GOOD_TILL_CANCEL_EXT", label: "GTC+EXT" },
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

const GOLD = "#f5a623";
const GOLD_DIM = "rgba(245,166,35,0.08)";
const UP = "#2ecc71";
const DOWN = "#ff4b5c";
const BG = "#050607";
const CARD = "#101215";
const _CARD_SOFT = "#14161a";
const FIELD = "rgba(10,12,16,0.95)";
const BORDER = "#23262c";
const _BORDER2 = "#23262c";
const MUTED = "#7d8494";
const DIM = "#7d8494";
const TEXT = "#b8bcc8";
const WHITE = "#f7f8fa";
const DIVIDER = "#1c1f26";
const R_CARD = 14;
const CARD_GRAD = "linear-gradient(145deg, #111319, #080a0f)";
const CTA_GRAD = "linear-gradient(135deg, #f5a623, #ffce73)";
const SYS_FONT = "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif";

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
  } else if (isOption) {
    checks.push({ id: "pop", label: "Prob. of Profit", level: "GREEN", detail: "No delta data" });
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
  } else if (isOption) {
    checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: "No IV data" });
  }

  if (isOption && dte != null) {
    if (dte < preTradeMinDTE) {
      checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "RED", detail: `${dte} DTE < ${preTradeMinDTE}-day minimum` });
    } else if (dte < preTradeMinDTE * 2) {
      checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "YELLOW", detail: `${dte} DTE — approaching gamma risk zone` });
    } else {
      checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "GREEN", detail: `${dte} DTE — within safe range` });
    }
  } else if (isOption) {
    checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "GREEN", detail: "No DTE data" });
  }

  return checks;
}

function getOverallLevel(checks: RiskCheck[]): RiskLevel {
  if (checks.some(c => c.level === "RED")) return "RED";
  if (checks.some(c => c.level === "YELLOW")) return "YELLOW";
  return "GREEN";
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
  onSwitchToStock?: () => void;
  onSwitchToOptions?: () => void;
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
    <div className="overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: R_CARD }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <Sparkles className="w-3.5 h-3.5" style={{ color: GOLD }} />
        <span className="text-[12px] uppercase tracking-[0.06em]" style={{ color: TEXT }}>AI co-pilot</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {suggestions.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{
              background: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : UP
            }} />
            <span className="text-[12px] leading-snug" style={{
              color: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : TEXT
            }}>{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderTicket({ isOpen, onClose, initialSide, optionSymbol, optionInstruction, strategyLegs, strategyNetPrice, strategyIsCredit, isCloseOrder, onSwitchToStock, onSwitchToOptions }: OrderTicketProps) {
  const symbol = useTerminalStore((s) => s.symbol);
  const { data: quote } = useQuote(symbol);
  const pulseData = useMarketPulseStore((s) => s.pulseData);
  const preTradeEnabled = useTerminalStore((s) => s.preTradeEnabled);
  const _preTradeBlockOnRed = useTerminalStore((s) => s.preTradeBlockOnRed);
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
  const [posEffect, setPosEffect] = useState<PositionEffect>("AUTO");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [instruction, setInstruction] = useState<"NONE" | "ALL_OR_NONE" | "DO_NOT_REDUCE">("NONE");
  const [exchange, setExchange] = useState<"BEST" | "NYSE" | "NASDAQ" | "ARCA" | "BATS">("BEST");
  const [taxLotMethod, setTaxLotMethod] = useState<"DEFAULT" | "FIFO" | "LIFO" | "HIGH_COST" | "LOW_COST" | "SPEC_ID">("DEFAULT");
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const isMultiLeg = !!strategyLegs && strategyLegs.length >= 1;
  const isOption = !!optionSymbol || isMultiLeg;
  const displaySymbol = isMultiLeg ? `${symbol} Strategy (${strategyLegs!.length} legs)` : optionSymbol ?? symbol;

  const ticketMode: TicketMode = isOption ? "options" : "stock";

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
    setPosEffect("AUTO");
  }, [isOpen, initialSide, isMultiLeg, strategyNetPrice]);

  const [balances, setBalances] = useState<{ buyingPower: number | null; cashBalance: number | null; liquidationValue: number | null }>({ buyingPower: null, cashBalance: null, liquidationValue: null });

  useEffect(() => {
    if (!isOpen) return;
    fetchWithAuth("/api/portfolio/account-hash")
      .then((r) => r.json())
      .then((d) => { if (d.hashValue) setAccountHash(d.hashValue); })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !accountHash) return;
    fetchWithAuth("/api/portfolio/accounts")
      .then(r => r.json())
      .then((accts: any[]) => {
        if (Array.isArray(accts) && accts.length > 0) {
          const bal = accts[0]?.balances ?? {};
          setBalances({
            buyingPower: bal.buyingPower ?? null,
            cashBalance: bal.cashBalance ?? null,
            liquidationValue: bal.liquidationValue ?? null,
          });
        }
      })
      .catch(() => {});
  }, [isOpen, accountHash]);

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

  const needsLimit = orderType === "LIMIT" || orderType === "STOP_LIMIT" || orderType === "TRAILING_STOP_LIMIT" || orderType === "LIMIT_ON_CLOSE";
  const needsStop = orderType === "STOP" || orderType === "STOP_LIMIT" || orderType === "TRAILING_STOP_LIMIT";
  const needsTrail = orderType === "TRAILING_STOP" || orderType === "TRAILING_STOP_LIMIT";

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

  const isValid = useMemo(() => {
    if (quantity <= 0) return false;
    if (!accountHash) return false;
    if (isMultiLeg && orderType !== "MARKET") return !!limitPrice && parseFloat(limitPrice) > 0;
    if (isMultiLeg && orderType === "MARKET") return true;
    if (needsLimit && (!limitPrice || parseFloat(limitPrice) <= 0)) return false;
    if (needsStop && (!stopPrice || parseFloat(stopPrice) <= 0)) return false;
    if (needsTrail && (!trailOffset || parseFloat(trailOffset) <= 0)) return false;
    return true;
  }, [quantity, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset, accountHash, isMultiLeg]);

  const buildSchwabOrder = useCallback(() => {
    const isSeamless = extendedHours || duration === "SEAMLESS" || duration === "GOOD_TILL_CANCEL_EXT";
    const session = isSeamless ? "SEAMLESS" : "NORMAL";

    if (isMultiLeg && strategyLegs) {
      const parsed = parseFloat(limitPrice || "0");
      const isTrueMultiLeg = strategyLegs.length >= 2;
      if (isTrueMultiLeg) {
        // SEAMLESS session does not allow MARKET orders — force a limit price using spread mid if needed
        const seamlessFallbackPrice = isSeamless && parsed <= 0 && spreadPrices ? spreadPrices.spreadMid : null;
        const resolvedPrice = parsed > 0 ? parsed : (seamlessFallbackPrice ?? 0);
        const useMarket = !isSeamless && (orderType === "MARKET" || resolvedPrice <= 0);
        // Determine credit vs debit from actual current leg prices (sell legs contribute positive, buy legs negative)
        const netDirection = strategyLegs.reduce((acc, leg) => {
          const isSell = leg.instruction.startsWith("SELL");
          const mid = ((leg.bid ?? 0) + (leg.ask ?? 0)) / 2;
          return acc + (isSell ? mid : -mid);
        }, 0);
        const creditOrDebit = netDirection >= 0 ? "CREDIT" : "DEBIT";
        // Schwab requires orderType LIMIT + price + creditOrDebit for complex non-market orders
        const resolvedType = useMarket ? "MARKET" : "LIMIT";
        const o: Record<string, unknown> = {
          orderType: resolvedType,
          session,
          duration,
          complexOrderStrategyType: "NONE",
          orderStrategyType: "SINGLE",
          orderLegCollection: strategyLegs.map(leg => ({
            instruction: leg.instruction,
            quantity: leg.quantity * quantity,
            instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
          })),
        };
        if (!useMarket) {
          if (resolvedPrice > 0) o.price = resolvedPrice;
          o.creditOrDebit = creditOrDebit;
        }
        return o;
      }
      const singleLeg = strategyLegs[0];
      const seamlessFallbackPriceSingle = isSeamless && parsed <= 0 && spreadPrices ? spreadPrices.spreadMid : null;
      const resolvedSinglePrice = parsed > 0 ? parsed : (seamlessFallbackPriceSingle ?? 0);
      const singleUseMarket = !isSeamless && (orderType === "MARKET" || resolvedSinglePrice <= 0);
      const o: Record<string, unknown> = {
        orderType: singleUseMarket ? "MARKET" : "LIMIT",
        session,
        duration,
        orderStrategyType: "SINGLE",
        orderLegCollection: [{
          instruction: singleLeg.instruction,
          quantity: singleLeg.quantity * quantity,
          instrument: { symbol: singleLeg.schwabSymbol, assetType: "OPTION" },
        }],
      };
      if (!singleUseMarket && resolvedSinglePrice > 0) o.price = resolvedSinglePrice;
      return o;
    }

    // Single-leg: SEAMLESS session requires LIMIT — fall back to mid price if MARKET selected
    const singleMid = quote?.bid != null && quote?.ask != null ? (quote.bid + quote.ask) / 2 : (quote?.ask ?? quote?.last ?? 0);
    const resolvedOrderType = isSeamless && orderType === "MARKET" ? "LIMIT" : orderType;
    const resolvedLimitPrice = isSeamless && orderType === "MARKET" && !limitPrice
      ? singleMid.toFixed(2)
      : limitPrice;
    const resolvedNeedsLimit = resolvedOrderType === "LIMIT" || needsLimit;

    const order: Record<string, unknown> = {
      orderType: resolvedOrderType,
      session,
      duration,
      orderStrategyType: "SINGLE",
      orderLegCollection: [{
        instruction: isOption ? (optionInstruction ?? (side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_CLOSE")) : side,
        quantity,
        instrument: { symbol: optionSymbol ?? symbol, assetType: isOption ? "OPTION" : "EQUITY" },
      }],
    };
    if (resolvedNeedsLimit) order.price = parseFloat(resolvedLimitPrice || "0");
    if (needsStop) order.stopPrice = parseFloat(stopPrice || "0");
    if (needsTrail) {
      order.stopPriceLinkBasis = "LAST";
      order.stopPriceLinkType = "VALUE";
      order.stopPriceOffset = parseFloat(trailOffset || "0");
    }
    if (instruction !== "NONE") order.specialInstruction = instruction;
    if (exchange !== "BEST") order.requestedDestination = exchange;
    if (taxLotMethod !== "DEFAULT") order.taxLotMethod = taxLotMethod;
    return order;
  }, [orderType, extendedHours, duration, side, quantity, symbol, optionSymbol, isOption, isMultiLeg, strategyLegs, strategyIsCredit, isCloseOrder, optionInstruction, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset, instruction, exchange, taxLotMethod, spreadPrices, quote]);

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

  const handleToggleMode = useCallback((target: TicketMode) => {
    if (target === ticketMode) return;
    if (target === "stock" && onSwitchToStock) {
      onSwitchToStock();
    } else if (target === "options" && onSwitchToOptions) {
      onSwitchToOptions();
    }
  }, [ticketMode, onSwitchToStock, onSwitchToOptions]);

  if (!isOpen) return null;

  const isBuy = side === "BUY";
  const sideColor = isBuy ? UP : DOWN;
  const changePct = quote?.changePct;
  const changeColor = (changePct ?? 0) >= 0 ? UP : DOWN;
  const quoteAny = quote as Record<string, unknown> | null;
  const dayHigh = (quoteAny?.highPrice ?? quoteAny?.high) as number | undefined;
  const dayLow = (quoteAny?.lowPrice ?? quoteAny?.low) as number | undefined;
  const volume = (quoteAny?.totalVolume ?? quoteAny?.volume) as number | undefined;

  const canToggle = !isMultiLeg;

  const S = ticketMode === "options" ? {
    body: 15, label: 14, section: 16, price: 18, heading: 17, badge: 15, detail: 15, tiny: 13,
  } : {
    body: 14, label: 13, section: 15, price: 17, heading: 16, badge: 14, detail: 14, tiny: 12,
  };

  return (
    <div className="fixed inset-0 z-[210] flex flex-col" style={{ background: `radial-gradient(circle at top, #141821 0%, ${BG} 55%)`, fontFamily: SYS_FONT, fontWeight: 300 }}>

      <header className="shrink-0 flex items-center justify-between px-3 py-1.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex items-center justify-center transition-colors active:opacity-70"
            style={{ width: 26, height: 26, borderRadius: 999, border: `1px solid ${BORDER}`, color: TEXT }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div>
            <div style={{ fontSize: S.label, color: MUTED }}>
              {isOption ? "Options" : "Stock"} · {symbol}
              {isCloseOrder && <span className="ml-1.5 font-medium px-1.5 py-0.5" style={{ fontSize: S.tiny, background: `${DOWN}18`, color: DOWN, borderRadius: 999, border: `1px solid ${DOWN}40` }}>CLOSE</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canToggle ? (
            <div className="inline-flex p-0.5" style={{ borderRadius: 999, border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.15)" }}>
              <button
                onClick={() => handleToggleMode("options")}
                className="px-2.5 py-0.5 transition-all"
                style={{ fontSize: S.badge, borderRadius: 999, background: ticketMode === "options" ? `${GOLD}22` : "transparent", color: ticketMode === "options" ? GOLD : MUTED, fontWeight: ticketMode === "options" ? 500 : 300 }}
              >Options</button>
              <button
                onClick={() => handleToggleMode("stock")}
                className="px-2.5 py-0.5 transition-all"
                style={{ fontSize: S.badge, borderRadius: 999, background: ticketMode === "stock" ? `${GOLD}22` : "transparent", color: ticketMode === "stock" ? GOLD : MUTED, fontWeight: ticketMode === "stock" ? 500 : 300 }}
              >Stock</button>
            </div>
          ) : (
            <span style={{ fontSize: S.label, color: MUTED }}>
              {strategyLegs!.length}-leg {strategyIsCredit ? "credit" : "debit"}
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center transition-colors active:opacity-70"
            style={{ width: 26, height: 26, borderRadius: 999, border: `1px solid ${BORDER}`, color: TEXT }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {isCloseOrder && (
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0" style={{ background: `${DOWN}08`, borderBottom: `1px solid ${DOWN}20` }}>
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOWN }} />
          <span style={{ fontSize: S.label, color: `${DOWN}cc` }}>
            Closing existing position — risk checks for opening trades do not apply
          </span>
        </div>
      )}

      {stage === "form" || stage === "review" ? (
        <div className="flex-1 overflow-y-auto pb-4">

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 10px 10px" }}>

            {/* TICKER HEADER CARD — unified design */}
            <div style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}`, padding: "8px 10px" }}>
              <div className="flex justify-between items-center">
                <div>
                  <span className="tracking-[0.08em] font-semibold" style={{ fontSize: 18, color: GOLD }}>{symbol}</span>
                  {displaySymbol !== symbol && <div style={{ fontSize: S.label, color: MUTED }}>{displaySymbol}</div>}
                </div>
                <div className="text-right">
                  <div style={{ fontSize: 18, color: WHITE, fontWeight: 500 }}>{fmt(quote?.last)}</div>
                  <div style={{ fontSize: S.badge, color: changeColor, fontWeight: 500 }}>
                    {changePct != null ? `${changePct >= 0 ? "+" : ""}${fmt(changePct)}%` : ""}
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center mt-1" style={{ fontSize: S.tiny, color: TEXT }}>
                <div className="flex items-center gap-1.5">
                  <span className="uppercase tracking-[0.08em]" style={{ color: MUTED }}>{isOption ? "OPTIONS" : "STOCK"}</span>
                  {dayLow != null && dayHigh != null && <span>Range {fmt(dayLow)} – {fmt(dayHigh)}</span>}
                </div>
                <span className="px-1.5 py-0.5" style={{ borderRadius: 16, border: `1px solid ${BORDER}`, color: TEXT, fontSize: S.tiny }}>
                  {volume != null ? `Vol ${fmtCompact(volume)}` : "—"}
                </span>
              </div>
            </div>

            {isMultiLeg && strategyLegs ? (
              <>
                {/* MULTI-LEG OPTIONS: Legs card */}
                <div style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}`, padding: "8px 10px" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="uppercase tracking-[0.06em]" style={{ fontSize: S.section, color: TEXT }}>Legs</span>
                    <span style={{ fontSize: S.label, color: MUTED }}>{strategyLegs.length} legs</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                  {strategyLegs.map((leg, i) => {
                    const isBuyLeg = leg.instruction.startsWith("BUY");
                    const dirColor = isBuyLeg ? UP : DOWN;
                    const isOpenLeg = leg.instruction.includes("OPEN");
                    const dirLabel = isOpenLeg ? "OPEN" : "CLOSE";
                    const qtySign = isBuyLeg ? "+" : "-";
                    return (
                      <div key={i} className="flex justify-between items-center px-2 py-1" style={{ borderRadius: 10, background: "rgba(255,255,255,0.01)", border: `1px solid ${BORDER}70` }}>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5" style={{ fontSize: S.body }}>
                            <span className="uppercase tracking-[0.09em]" style={{ fontSize: S.label, color: dirColor }}>{dirLabel}</span>
                            <span style={{ color: WHITE }}>{qtySign}{leg.quantity} · {leg.strike} {leg.optionType === "CALL" ? "Call" : "Put"}</span>
                          </div>
                          <span style={{ fontSize: S.label, color: TEXT }}>{isBuyLeg ? "Buy" : "Sell"} leg</span>
                        </div>
                        <div className="text-right" style={{ fontSize: S.label, color: TEXT }}>
                          {leg.bid != null && <span>Bid {leg.bid.toFixed(2)}</span>}
                          {leg.bid != null && leg.ask != null && <span> / </span>}
                          {leg.ask != null && <span>Ask {leg.ask.toFixed(2)}</span>}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  <div className="flex justify-between items-center pt-1 mt-1" style={{ fontSize: S.label, borderTop: `1px dashed ${DIVIDER}` }}>
                    <span style={{ color: TEXT }}>Net {strategyIsCredit ? "Credit" : "Debit"}</span>
                    <span style={{ fontSize: S.price, color: strategyIsCredit ? UP : DOWN }}>
                      ${strategyNetPrice?.toFixed(2) ?? "—"} / spread
                    </span>
                  </div>
                </div>

                {/* Net price input */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label style={{ fontSize: S.label, color: MUTED }}>
                      {strategyIsCredit ? "Net credit price" : "Net debit price"}
                    </label>
                    <button onClick={() => setPriceLocked(!priceLocked)} className="p-0.5" style={{ color: priceLocked ? GOLD : DIM }}>
                      {priceLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5" style={{ background: FIELD, border: `1px solid ${priceLocked ? `${GOLD}4d` : BORDER}`, height: 30, borderRadius: 9, padding: "0 10px" }}>
                    <input type="number" inputMode="decimal" step="0.01" value={limitPrice}
                      onChange={(e) => { if (!priceLocked) setLimitPrice(e.target.value); }} placeholder="0.00"
                      className="flex-1 bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      style={{ fontSize: S.price, color: priceLocked ? GOLD : WHITE, border: "none", fontFamily: SYS_FONT }}
                      readOnly={priceLocked}
                    />
                    <span style={{ fontSize: S.label, color: MUTED }}>USD</span>
                  </div>
                  <div className="flex justify-between mt-1" style={{ fontSize: S.tiny, color: TEXT }}>
                    <button onClick={() => { if (!priceLocked && effectiveBid != null) setLimitPrice(effectiveBid.toFixed(2)); }} disabled={priceLocked} className="px-1.5 py-0.5" style={{ borderRadius: 999, border: sliderValue < 20 ? `1px solid ${GOLD}bf` : "1px solid transparent", color: sliderValue < 20 ? GOLD : TEXT, background: sliderValue < 20 ? GOLD_DIM : "transparent", opacity: priceLocked ? 0.4 : 1 }}>Bid {effectiveBid != null ? fmt(effectiveBid) : "—"}</button>
                    <button onClick={() => { if (!priceLocked) setMidPrice(); }} disabled={priceLocked} className="px-1.5 py-0.5" style={{ borderRadius: 999, border: sliderValue >= 40 && sliderValue <= 60 ? `1px solid ${GOLD}bf` : "1px solid transparent", color: sliderValue >= 40 && sliderValue <= 60 ? GOLD : TEXT, background: sliderValue >= 40 && sliderValue <= 60 ? GOLD_DIM : "transparent", opacity: priceLocked ? 0.4 : 1 }}>Mid {midPrice != null ? fmt(midPrice) : "—"}</button>
                    <button onClick={() => { if (!priceLocked) setNatPrice(); }} disabled={priceLocked} className="px-1.5 py-0.5" style={{ borderRadius: 999, border: sliderValue > 80 ? `1px solid ${GOLD}bf` : "1px solid transparent", color: sliderValue > 80 ? GOLD : TEXT, background: sliderValue > 80 ? GOLD_DIM : "transparent", opacity: priceLocked ? 0.4 : 1 }}>Ask {effectiveAsk != null ? fmt(effectiveAsk) : "—"}</button>
                  </div>
                </div>

                {/* Quantity */}
                <div className="flex items-center justify-between">
                  <div>
                    <div style={{ fontSize: S.label, color: MUTED }}>Quantity</div>
                    <div style={{ fontSize: S.body, color: TEXT }}>
                      Spreads · {estimatedCost != null ? `≈ ${fmtCurrency(Math.abs(estimatedCost))} notional` : ""}
                    </div>
                  </div>
                  <div className="inline-flex items-center" style={{ borderRadius: 20, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
                    <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="flex items-center justify-center" style={{ width: 28, height: 26, color: TEXT, background: "transparent", border: "none" }} aria-label="Decrease quantity">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input ref={qtyInputRef} type="number" inputMode="numeric" value={quantity}
                      onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) setQuantity(v); }}
                      className="text-center bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      style={{ fontSize: S.heading, color: WHITE, minWidth: 32, width: 32, border: "none", fontFamily: SYS_FONT }}
                    />
                    <button onClick={() => setQuantity(quantity + 1)} className="flex items-center justify-center" style={{ width: 28, height: 26, color: TEXT, background: "transparent", border: "none" }} aria-label="Increase quantity">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Cost summary */}
                <div className="flex justify-between flex-wrap gap-1 pt-1" style={{ fontSize: S.label, borderTop: `1px dashed ${DIVIDER}`, color: TEXT }}>
                  {estimatedCost != null && <span>{strategyIsCredit ? "Credit" : "Total cost"} {fmtCurrency(Math.abs(estimatedCost))}</span>}
                  <span>BP after trade {fmtCurrency(Math.max(0, (accountSize || 0) - Math.abs(estimatedCost ?? 0)))}</span>
                </div>
              </>
            ) : (
              /* =========== STOCK / SINGLE-OPTION FORM =========== */
              <div style={{ padding: "0" }}>
                {/* SIDE TOGGLE — prominent green/red */}
                <div className="flex items-center justify-between" style={{ fontSize: S.section, color: TEXT }}>
                  <span className="uppercase tracking-[0.06em]">Side</span>
                </div>
                <div className="inline-flex mt-1.5" style={{ borderRadius: 999, overflow: "hidden", border: `1px solid ${BORDER}` }}>
                  {(["BUY", "SELL"] as OrderSide[]).map((s) => {
                    const active = side === s;
                    const btnBg = active ? (s === "BUY" ? UP : DOWN) : "transparent";
                    const btnColor = active ? WHITE : MUTED;
                    return (
                      <button key={s} onClick={() => setSide(s)} className="px-4 py-1 transition-all"
                        style={{ fontSize: S.body, borderRadius: 0, border: "none", color: btnColor, background: btnBg, fontWeight: active ? 600 : 300 }}>
                        {s === "BUY" ? "Buy" : "Sell"}
                      </button>
                    );
                  })}
                </div>

                {/* Quantity */}
                <div className="mt-2 flex flex-col gap-0.5" style={{ fontSize: S.body }}>
                  <span style={{ fontSize: S.label, color: MUTED }}>Quantity</span>
                  <div className="flex items-center justify-between">
                    <div style={{ fontSize: S.body, color: TEXT }}>{isOption ? "Contracts" : "Shares"}</div>
                    <div className="inline-flex items-center" style={{ borderRadius: 999, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
                      <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="flex items-center justify-center" style={{ width: 28, height: 26, color: TEXT, background: "transparent", border: "none" }} aria-label="Decrease quantity">
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input ref={qtyInputRef} type="number" inputMode="numeric" value={quantity}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) setQuantity(v); }}
                        className="text-center bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ fontSize: S.heading, color: WHITE, minWidth: 32, width: 32, border: "none", fontFamily: SYS_FONT }}
                      />
                      <button onClick={() => setQuantity(quantity + 1)} className="flex items-center justify-center" style={{ width: 28, height: 26, color: TEXT, background: "transparent", border: "none" }} aria-label="Increase quantity">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {estimatedCost != null && <div style={{ fontSize: S.label, color: MUTED }}>≈ {fmtCurrency(Math.abs(estimatedCost))}</div>}
                </div>

                {/* Order type / TIF */}
                <div className="mt-2 grid grid-cols-2 gap-2" style={{ fontSize: S.body }}>
                  <div className="flex flex-col gap-0.5 relative">
                    <span style={{ fontSize: S.label, color: MUTED }}>Order type</span>
                    <button onClick={() => { setShowOrderType(!showOrderType); setShowTifDropdown(false); }}
                      className="flex items-center justify-between px-2"
                      style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${BORDER}`, color: WHITE, height: 30, borderRadius: 8, fontSize: S.body }}>
                      <span>{ORDER_TYPES.find((t) => t.value === orderType)?.label}</span>
                      <span style={{ fontSize: S.label, color: MUTED }}>▾</span>
                    </button>
                    {showOrderType && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-10 overflow-hidden shadow-xl" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 9 }}>
                        {ORDER_TYPES.map((t) => (
                          <button key={t.value} onClick={() => { setOrderType(t.value); setShowOrderType(false); }}
                            className="w-full text-left px-2.5 py-1.5 transition-colors"
                            style={{ fontSize: S.body, color: orderType === t.value ? GOLD : TEXT, background: orderType === t.value ? GOLD_DIM : "transparent" }}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 relative">
                    <span style={{ fontSize: S.label, color: MUTED }}>Time in force</span>
                    <button onClick={() => { setShowTifDropdown(!showTifDropdown); setShowOrderType(false); }}
                      className="flex items-center justify-between px-2"
                      style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${BORDER}`, color: WHITE, height: 30, borderRadius: 8, fontSize: S.body }}>
                      <span>{DURATIONS.find((d) => d.value === duration)?.label}</span>
                      <span style={{ fontSize: S.label, color: MUTED }}>▾</span>
                    </button>
                    {showTifDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-10 overflow-hidden shadow-xl" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 9 }}>
                        {DURATIONS.map((d) => (
                          <button key={d.value} onClick={() => { setDuration(d.value); setShowTifDropdown(false); }}
                            className="w-full text-left px-2.5 py-1.5 transition-colors"
                            style={{ fontSize: S.body, color: duration === d.value ? GOLD : TEXT, background: duration === d.value ? GOLD_DIM : "transparent" }}>
                            {d.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Limit price */}
                {needsLimit && (
                  <div className="mt-2 flex flex-col gap-0.5" style={{ fontSize: S.body }}>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: S.label, color: MUTED }}>Limit price</span>
                      <button onClick={() => setPriceLocked(!priceLocked)} className="p-0.5" style={{ color: priceLocked ? GOLD : DIM }}>
                        {priceLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                    </div>
                    <div className="flex items-center" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${priceLocked ? `${GOLD}4d` : BORDER}`, height: 30, borderRadius: 8, padding: "0 8px" }}>
                      <input type="number" inputMode="decimal" step="0.01" value={limitPrice}
                        onChange={(e) => { if (!priceLocked) setLimitPrice(e.target.value); }} placeholder="0.00"
                        className="flex-1 bg-transparent outline-none text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ fontSize: S.price, color: priceLocked ? GOLD : WHITE, border: "none", fontFamily: SYS_FONT }}
                        readOnly={priceLocked}
                      />
                      <span className="ml-2" style={{ fontSize: S.label, color: MUTED }}>USD</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between" style={{ fontSize: S.tiny, color: TEXT }}>
                      <button onClick={() => { if (!priceLocked && effectiveBid != null) setLimitPrice(effectiveBid.toFixed(2)); }} disabled={priceLocked} className="px-2 py-0.5"
                        style={{ borderRadius: 999, border: sliderValue < 20 ? `1px solid ${GOLD}bf` : "1px solid transparent", color: sliderValue < 20 ? GOLD : TEXT, background: sliderValue < 20 ? GOLD_DIM : "transparent", opacity: priceLocked ? 0.4 : 1 }}>
                        Bid {effectiveBid != null ? fmt(effectiveBid) : "—"}
                      </button>
                      <button onClick={() => { if (!priceLocked) setMidPrice(); }} disabled={priceLocked} className="px-2 py-0.5"
                        style={{ borderRadius: 999, border: sliderValue >= 40 && sliderValue <= 60 ? `1px solid ${GOLD}bf` : "1px solid transparent", color: sliderValue >= 40 && sliderValue <= 60 ? GOLD : TEXT, background: sliderValue >= 40 && sliderValue <= 60 ? GOLD_DIM : "transparent", opacity: priceLocked ? 0.4 : 1 }}>
                        Mid {midPrice != null ? fmt(midPrice) : "—"}
                      </button>
                      <button onClick={() => { if (!priceLocked) setNatPrice(); }} disabled={priceLocked} className="px-2 py-0.5"
                        style={{ borderRadius: 999, border: sliderValue > 80 ? `1px solid ${GOLD}bf` : "1px solid transparent", color: sliderValue > 80 ? GOLD : TEXT, background: sliderValue > 80 ? GOLD_DIM : "transparent", opacity: priceLocked ? 0.4 : 1 }}>
                        Ask {effectiveAsk != null ? fmt(effectiveAsk) : "—"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Stop price */}
                {needsStop && (
                  <div className="mt-2 flex flex-col gap-0.5" style={{ fontSize: S.body }}>
                    <span style={{ fontSize: S.label, color: MUTED }}>Stop price</span>
                    <div className="flex items-center" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${BORDER}`, height: 30, borderRadius: 8, padding: "0 8px" }}>
                      <input type="number" inputMode="decimal" step="0.01" value={stopPrice}
                        onChange={(e) => setStopPrice(e.target.value)} placeholder="0.00"
                        className="flex-1 bg-transparent outline-none text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ fontSize: S.price, color: WHITE, border: "none", fontFamily: SYS_FONT }}
                      />
                      <span className="ml-2" style={{ fontSize: S.label, color: MUTED }}>USD</span>
                    </div>
                  </div>
                )}

                {/* Trail amount */}
                {needsTrail && (
                  <div className="mt-2 flex flex-col gap-0.5" style={{ fontSize: S.body }}>
                    <span style={{ fontSize: S.label, color: MUTED }}>Trail amount</span>
                    <div className="flex items-center" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${BORDER}`, height: 30, borderRadius: 8, padding: "0 8px" }}>
                      <input type="number" inputMode="decimal" step="0.01" value={trailOffset}
                        onChange={(e) => setTrailOffset(e.target.value)} placeholder="0.00"
                        className="flex-1 bg-transparent outline-none text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ fontSize: S.price, color: WHITE, border: "none", fontFamily: SYS_FONT }}
                      />
                      <span className="ml-2" style={{ fontSize: S.label, color: MUTED }}>USD</span>
                    </div>
                  </div>
                )}

                {/* Notional / Fees / BP row */}
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 pt-1.5" style={{ fontSize: S.label, borderTop: `1px dashed ${DIVIDER}`, color: TEXT }}>
                  {estimatedCost != null && <span>Notional {fmtCurrency(Math.abs(estimatedCost))}</span>}
                  <span>Est. fees —</span>
                  <span>BP after trade {fmtCurrency(Math.max(0, (accountSize || 0) - Math.abs(estimatedCost ?? 0)))}</span>
                </div>
              </div>
            )}

            {/* ADVANCED SETTINGS */}
            <button
              className="w-full flex items-center justify-between px-3 py-1"
              onClick={() => setAdvancedOpen(v => !v)}
              style={{ color: TEXT, borderRadius: 8, fontSize: S.body }}
            >
              <span className="flex items-center gap-1.5">
                {advancedOpen ? <ChevronUp className="w-3 h-3" style={{ color: MUTED }} /> : <ChevronDown className="w-3 h-3" style={{ color: MUTED }} />}
                Advanced settings
              </span>
            </button>
            {advancedOpen && (
              <div className="space-y-0">
                <div className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                  <span style={{ fontSize: S.body, color: TEXT }}>Effect</span>
                  <button onClick={() => setPosEffect(posEffect === "OPENING" ? "CLOSING" : posEffect === "CLOSING" ? "AUTO" : "OPENING")} style={{ fontSize: S.body, color: WHITE, background: "none", border: "none", padding: 0 }}>
                    {posEffect === "AUTO" ? "Auto" : posEffect === "OPENING" ? "To Open" : "To Close"}
                  </button>
                </div>
                <div className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                  <span style={{ fontSize: S.body, color: TEXT }}>Instruction</span>
                  <button onClick={() => setInstruction(instruction === "NONE" ? "ALL_OR_NONE" : instruction === "ALL_OR_NONE" ? "DO_NOT_REDUCE" : "NONE")} style={{ fontSize: S.body, color: WHITE, background: "none", border: "none", padding: 0 }}>
                    {instruction === "NONE" ? "None" : instruction === "ALL_OR_NONE" ? "AON" : "DNR"}
                  </button>
                </div>
                <div className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                  <span style={{ fontSize: S.body, color: TEXT }}>Exchange</span>
                  <button onClick={() => setExchange(exchange === "BEST" ? "NYSE" : exchange === "NYSE" ? "NASDAQ" : exchange === "NASDAQ" ? "ARCA" : exchange === "ARCA" ? "BATS" : "BEST")} style={{ fontSize: S.body, color: WHITE, background: "none", border: "none", padding: 0 }}>
                    {exchange}
                  </button>
                </div>
                <div className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                  <span style={{ fontSize: S.body, color: TEXT }}>Tax Lot Method</span>
                  <button onClick={() => setTaxLotMethod(taxLotMethod === "DEFAULT" ? "FIFO" : taxLotMethod === "FIFO" ? "LIFO" : taxLotMethod === "LIFO" ? "HIGH_COST" : taxLotMethod === "HIGH_COST" ? "LOW_COST" : taxLotMethod === "LOW_COST" ? "SPEC_ID" : "DEFAULT")} style={{ fontSize: S.body, color: WHITE, background: "none", border: "none", padding: 0 }}>
                    {taxLotMethod === "DEFAULT" ? "Default" : taxLotMethod === "SPEC_ID" ? "Spec ID" : taxLotMethod.replace("_", " ")}
                  </button>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span style={{ fontSize: S.body, color: TEXT }}>Ext Hours</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setExtendedHours(!extendedHours); }}
                    className="relative w-9 h-5 rounded-full transition-colors duration-200"
                    style={{ background: extendedHours ? GOLD : BORDER, border: "none" }}
                  >
                    <div className="absolute top-0.5 w-4 h-4 rounded-full transition-transform duration-200" style={{ background: extendedHours ? BG : DIM, transform: extendedHours ? "translateX(16px)" : "translateX(2px)" }} />
                  </button>
                </div>
              </div>
            )}

            {/* RISK & INSIGHTS CARD */}
            <div style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}`, padding: "8px 10px" }}>
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-[0.06em]" style={{ fontSize: S.section, color: TEXT }}>Risk & insights</span>
                {preTradeEnabled && riskChecks.length > 0 && (
                  <span className="px-2 py-0.5" style={{
                    fontSize: S.badge,
                    borderRadius: 16, border: `1px solid ${overallRisk === "GREEN" ? `${UP}66` : overallRisk === "YELLOW" ? `${GOLD}66` : `${DOWN}80`}`,
                    color: levelColor(overallRisk),
                    background: overallRisk === "GREEN" ? `${UP}0a` : overallRisk === "YELLOW" ? `${GOLD}0a` : `${DOWN}0a`,
                  }}>
                    Pre-trade risk · {overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}
                  </span>
                )}
              </div>

              {(() => {
                const spreadPct = quote?.bid != null && quote?.ask != null && quote.bid > 0
                  ? (((quote.ask - quote.bid) / quote.bid) * 100).toFixed(1) + "%"
                  : "—";
                return (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pt-1" style={{ fontSize: S.label, borderTop: `1px dashed ${DIVIDER}`, color: TEXT }}>
                    <span>Order vs account size</span>
                    <span>Spread {spreadPct}</span>
                  </div>
                );
              })()}

              <button
                onClick={() => setRiskOpen(!riskOpen)}
                className="w-full flex items-center justify-between mt-1 pt-1"
                style={{ fontSize: S.body, borderTop: `1px dashed ${DIVIDER}`, color: TEXT, background: "none", border: "none", cursor: "pointer", padding: 0, paddingTop: 4 }}
              >
                <span>{riskOpen ? "Hide details" : "View full risk details"}</span>
                <span style={{ color: MUTED, fontSize: S.label }}>{riskOpen ? "▴" : "▾"}</span>
              </button>

              {riskOpen && (
                <>
                  {preTradeEnabled && riskChecks.length > 0 && (
                    <div className="mt-1 space-y-1" style={{ fontSize: S.body }}>
                      {riskChecks.map(c => (
                        <div key={c.id} className="flex gap-2">
                          <span className="mt-1 h-2 w-2 rounded-full shrink-0" style={{ background: levelColor(c.level) }} />
                          <div>
                            <div style={{ color: TEXT }}>{c.label}</div>
                            <div style={{ fontSize: S.detail, color: MUTED }}>{c.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <AiCoPilotPanel
                    side={side}
                    symbol={symbol}
                    limitPrice={parseFloat(limitPrice) || 0}
                    bid={quote?.bid ?? null}
                    ask={quote?.ask ?? null}
                    quantity={quantity}
                    isOption={isOption}
                  />
                </>
              )}
            </div>

            {/* ORDER DESCRIPTION CARD */}
            <div style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}`, padding: "8px 10px" }}>
              <div className="mb-0.5" style={{ fontSize: S.section, color: TEXT }}>Order Description</div>
              <div className="leading-relaxed" style={{ fontSize: S.heading, color: WHITE }}>
                {(() => {
                  const action = isMultiLeg
                    ? `${strategyIsCredit ? "SELL" : "BUY"} ${strategyLegs!.length}-leg strategy`
                    : `${side} ${quantity} ${isOption ? "contract" : "share"}${quantity > 1 ? "s" : ""}`;
                  const sym = isMultiLeg ? symbol : displaySymbol;
                  const priceStr = needsLimit && limitPrice ? ` at ${limitPrice} Limit` : needsStop && stopPrice ? ` at ${stopPrice} Stop` : needsTrail && trailOffset ? ` Trail ${trailOffset}` : orderType === "MARKET" ? " at Market" : "";
                  const dur = DURATIONS.find(d => d.value === duration)?.label ?? duration;
                  return `${action} ${sym}${priceStr}, ${dur}${extendedHours ? " + Ext" : ""}`;
                })()}
              </div>
            </div>

            {/* BALANCES CARD */}
            <div style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}`, padding: "8px 10px" }}>
              <div className="flex items-center justify-between mb-1">
                <span style={{ fontSize: S.section, color: TEXT }}>Balances</span>
              </div>
              <div className="space-y-0">
                {(() => {
                  const bp = balances.buyingPower ?? accountSize ?? 0;
                  const rows = [
                    { label: "Buying Power", value: fmtCurrency(bp) },
                    { label: "BP After Trade", value: fmtCurrency(Math.max(0, bp - Math.abs(estimatedCost ?? 0))) },
                    ...(balances.cashBalance != null ? [{ label: "Cash Balance", value: fmtCurrency(balances.cashBalance) }] : []),
                    ...(balances.liquidationValue != null ? [{ label: "Liquidation Value", value: fmtCurrency(balances.liquidationValue) }] : []),
                  ];
                  return rows.map((row, i) => (
                    <div key={i} className="flex items-center justify-between py-1" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${DIVIDER}` : "none" }}>
                      <span style={{ fontSize: S.body, color: TEXT }}>{row.label}</span>
                      <span style={{ fontSize: S.heading, color: WHITE }}>{row.value}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

          </div>
        </div>
      ) : stage === "submitting" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: GOLD }} />
          <p style={{ fontSize: 16, color: TEXT }}>Submitting order…</p>
        </div>
      ) : stage === "success" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: "50%", background: `${UP}12`, border: `1px solid ${UP}40` }}>
            <CheckCircle2 className="w-8 h-8" style={{ color: UP }} />
          </div>
          <p style={{ fontSize: 16, color: WHITE }}>Order placed</p>
          <p className="text-center" style={{ fontSize: S.heading, color: TEXT }}>
            {side === "BUY" ? "Bought" : "Sold"} {quantity} {isOption ? "contract" : "share"}{quantity > 1 ? "s" : ""} of {displaySymbol}
          </p>
          {orderId && (
            <p style={{ fontSize: S.label, color: MUTED }}>Order ID: {orderId}</p>
          )}
          <button
            onClick={onClose}
            className="mt-4 w-full max-w-xs transition-colors"
            style={{ fontSize: 16, height: 42, borderRadius: 999, background: CTA_GRAD, color: BG, border: "none", fontFamily: SYS_FONT }}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: "50%", background: `${DOWN}12`, border: `1px solid ${DOWN}40` }}>
            <AlertTriangle className="w-8 h-8" style={{ color: DOWN }} />
          </div>
          <p style={{ fontSize: 16, color: WHITE }}>Order failed</p>
          <p className="text-center max-w-sm" style={{ fontSize: S.heading, color: DOWN }}>{errorMsg}</p>
          <div className="flex gap-2 mt-4 w-full max-w-xs">
            <button
              onClick={() => setStage("form")}
              className="flex-1"
              style={{ fontSize: S.heading, height: 40, borderRadius: 999, background: "transparent", color: TEXT, border: `1px solid ${BORDER}` }}
            >
              Edit order
            </button>
            <button
              onClick={onClose}
              className="flex-1"
              style={{ fontSize: S.heading, height: 40, borderRadius: 999, background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* CTA BAR — ALWAYS ACTIVE (never disabled by risk) */}
      {stage === "form" && (
        <div className="shrink-0 px-3 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 20px), 20px)", background: BG, borderTop: `1px solid ${BORDER}`, zIndex: 215 }}>
          <div className="flex justify-between flex-wrap gap-1 mb-1" style={{ fontSize: S.label, color: TEXT }}>
            <span>{isBuy ? "Buy" : "Sell"} {quantity} {isMultiLeg ? "spread" : isOption ? "contract" : "share"}{quantity > 1 ? "s" : ""} · {needsLimit || isMultiLeg ? `Limit ${limitPrice || "—"}` : ORDER_TYPES.find(t => t.value === orderType)?.label}</span>
            {estimatedCost != null && <span>{isMultiLeg ? (strategyIsCredit ? "Credit" : "Cost") : "Notional"} {fmtCurrency(Math.abs(estimatedCost))}</span>}
            {preTradeEnabled && <span>Risk: {overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}</span>}
          </div>
          <button
            onClick={() => setStage("review")}
            className="w-full tracking-[0.06em] uppercase transition-all duration-150 active:scale-[0.98]"
            style={{
              fontSize: 17,
              height: 48,
              borderRadius: 999,
              border: "none",
              background: CTA_GRAD,
              color: BG,
              fontWeight: 500,
              fontFamily: SYS_FONT,
            }}
          >
            {isCloseOrder ? "Review close order" : isMultiLeg ? "Review options order" : `Review ${side.toLowerCase()} order`}
          </button>
        </div>
      )}

      {/* REVIEW MODAL */}
      {stage === "review" && (
        <div className="fixed inset-0 z-[220] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div
            className="w-full max-w-lg p-4 space-y-2.5 animate-in slide-in-from-bottom duration-300"
            style={{ background: BG, borderRadius: "20px 20px 0 0", border: `1px solid ${BORDER}`, borderBottom: "none" }}
          >
            <div className="flex items-center justify-between">
              <h3 style={{ fontSize: 16, color: WHITE }}>{isCloseOrder ? "Confirm close" : "Confirm order"}</h3>
              <button onClick={() => setStage("form")} className="w-7 h-7 flex items-center justify-center" style={{ borderRadius: "50%", border: `1px solid ${BORDER}`, background: "transparent", color: MUTED }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1 p-3" style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}` }}>
              {isMultiLeg && strategyLegs ? (
                <>
                  <div className="flex justify-between mb-1">
                    <span style={{ fontSize: S.label, color: MUTED }}>{isCloseOrder ? "Close" : "Strategy"}</span>
                    <span style={{ fontSize: S.body, color: isCloseOrder ? DOWN : GOLD }}>
                      {isCloseOrder ? `Close ${strategyLegs.length}-leg` : `${strategyLegs.length}-Leg ${strategyIsCredit ? "Credit" : "Debit"}`}
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
                      <div key={i} className="flex items-center" style={{ fontSize: S.body, height: 20 }}>
                        <span style={{ color: dirColor, width: 32 }}>{dirShort}</span>
                        <span style={{ color: dirColor, width: 26 }}>{qtySign}{leg.quantity * quantity}</span>
                        <span className="flex-1" style={{ color: TEXT }}>
                          {leg.strike} {leg.optionType === "CALL" ? "Call" : "Put"}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between mt-1 pt-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                    <span style={{ fontSize: S.label, color: MUTED }}>Net price</span>
                    <span style={{ fontSize: S.heading, color: WHITE }}>${limitPrice}</span>
                  </div>
                </>
              ) : (
                <>
                  {[
                    { label: "Action", value: isOption ? (optionInstruction ?? (side === "BUY" ? "BUY TO OPEN" : "SELL TO CLOSE")) : side, color: sideColor },
                    { label: "Symbol", value: displaySymbol },
                    { label: "Quantity", value: String(quantity) },
                    { label: "Order type", value: ORDER_TYPES.find((t) => t.value === orderType)?.label },
                  ].map((row, i) => (
                    <div key={i} className="flex justify-between" style={{ fontSize: S.body }}>
                      <span style={{ color: MUTED }}>{row.label}</span>
                      <span style={{ color: row.color || WHITE }}>{row.value}</span>
                    </div>
                  ))}
                  {needsLimit && (
                    <div className="flex justify-between" style={{ fontSize: S.body }}>
                      <span style={{ color: MUTED }}>Limit price</span>
                      <span style={{ color: WHITE }}>${limitPrice}</span>
                    </div>
                  )}
                  {needsStop && (
                    <div className="flex justify-between" style={{ fontSize: S.body }}>
                      <span style={{ color: MUTED }}>Stop price</span>
                      <span style={{ color: WHITE }}>${stopPrice}</span>
                    </div>
                  )}
                  {needsTrail && (
                    <div className="flex justify-between" style={{ fontSize: S.body }}>
                      <span style={{ color: MUTED }}>Trail amount</span>
                      <span style={{ color: WHITE }}>${trailOffset}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between" style={{ fontSize: S.body }}>
                <span style={{ color: MUTED }}>Duration</span>
                <span style={{ color: WHITE }}>{DURATIONS.find((d) => d.value === duration)?.label}{extendedHours ? " + Ext" : ""}</span>
              </div>
              <div className="pt-1 mt-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                <div className="flex justify-between">
                  <span style={{ fontSize: S.body, color: TEXT }}>Est. {isMultiLeg ? (strategyIsCredit ? "credit" : "cost") : side === "BUY" ? "cost" : "credit"}</span>
                  <span style={{ fontSize: S.price, color: WHITE }}>
                    {estimatedCost != null ? fmtCurrency(Math.abs(estimatedCost)) : "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-3 py-1.5 flex items-start gap-2" style={{ background: `${GOLD}08`, borderRadius: 10, border: `1px solid ${GOLD}1a` }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: GOLD }} />
              <p className="leading-relaxed" style={{ fontSize: S.label, color: `${GOLD}cc` }}>
                This will place a live order with Schwab. Verify all details before confirming.
              </p>
            </div>

            <div className="flex gap-2 pt-1 pb-4">
              <button onClick={() => setStage("form")} className="flex-1" style={{ fontSize: S.heading, height: 40, background: "transparent", color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 999 }}>Back</button>
              <button
                onClick={handleSubmit}
                className="flex-[2] tracking-[0.04em] active:scale-[0.98] transition-transform"
                style={{
                  fontSize: 16,
                  height: 42,
                  borderRadius: 999,
                  border: "none",
                  background: CTA_GRAD,
                  color: BG,
                  fontFamily: SYS_FONT,
                }}
              >
                {isCloseOrder ? "Confirm close" : isMultiLeg ? "Confirm strategy" : `Confirm ${side.toLowerCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
