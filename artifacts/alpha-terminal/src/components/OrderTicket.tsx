import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { fetchWithAuth, humanizeFailedApiBody } from "@/lib/fetchWithAuth";
import { startStrategistPolling } from "@/lib/strategistPoller";
import { computeStrategyEconomics } from "@/lib/strategyCalculator";
import { useGetOptionChain } from "@workspace/api-client-react";
import {
  X, Minus, Plus, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  ShieldX, Lock, Unlock,
  Sparkles, ArrowLeft,
} from "lucide-react";

type OrderSide = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | "TRAILING_STOP" | "TRAILING_STOP_LIMIT" | "MARKET_ON_CLOSE" | "LIMIT_ON_CLOSE" | "WALK_LIMIT";
type Duration = "DAY" | "GOOD_TILL_CANCEL" | "FILL_OR_KILL" | "SEAMLESS" | "GOOD_TILL_CANCEL_EXT" | "AM" | "PM";
type ConfirmStage = "form" | "review" | "submitting" | "success" | "error";
type RiskLevel = "GREEN" | "YELLOW" | "RED";
type PositionEffect = "OPENING" | "CLOSING" | "AUTO";
type TicketMode = "options" | "stock";

// An option leg added on top of an equity (stock) ticket.
type MixedOptionLeg = {
  id: string;
  optionType: "CALL" | "PUT" | null;
  expiration: string | null; // YYYY-MM-DD
  strike: number | null;
  side: "BUY" | "SELL";
  quantity: number;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  limitPrice: string;
};

const STOCK_ORDER_TYPES: { value: OrderType; label: string; short: string }[] = [
  { value: "MARKET", label: "Market", short: "MKT" },
  { value: "LIMIT", label: "Limit", short: "LMT" },
  { value: "STOP", label: "Stop", short: "STP" },
  { value: "STOP_LIMIT", label: "Stop Limit", short: "STP LMT" },
  { value: "TRAILING_STOP", label: "Trail Stop", short: "TRAIL" },
  { value: "TRAILING_STOP_LIMIT", label: "Trail Stop Limit", short: "TRAIL LMT" },
  { value: "MARKET_ON_CLOSE", label: "MOC", short: "MOC" },
  { value: "LIMIT_ON_CLOSE", label: "LOC", short: "LOC" },
];

const OPTION_ORDER_TYPES: { value: OrderType; label: string; short: string }[] = [
  { value: "MARKET", label: "Market", short: "MKT" },
  { value: "LIMIT", label: "Limit", short: "LMT" },
  { value: "STOP", label: "Stop", short: "STP" },
  { value: "STOP_LIMIT", label: "Stop Limit", short: "STP LMT" },
  { value: "TRAILING_STOP", label: "Trail Stop", short: "TRAIL" },
  { value: "TRAILING_STOP_LIMIT", label: "Trail Stop Limit", short: "TRAIL LMT" },
  { value: "WALK_LIMIT", label: "Walk Limit", short: "WALK" },
];

const STOCK_DURATIONS: { value: Duration; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "GOOD_TILL_CANCEL", label: "GTC" },
  { value: "FILL_OR_KILL", label: "FOK" },
  { value: "SEAMLESS", label: "EXT" },
  { value: "GOOD_TILL_CANCEL_EXT", label: "GTC+EXT" },
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

const OPTION_DURATIONS: { value: Duration; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "GOOD_TILL_CANCEL", label: "GTC" },
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
  // Fired after a successful "Send to Strategist" dispatch. Terminal uses
  // this to navigate to the AI > Strategist sub-tab so the user can watch
  // the live trade-validation debate.
  onSendToStrategist?: (ticker?: string) => void;
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
        <span className="text-[10px] uppercase tracking-[0.06em]" style={{ color: TEXT }}>AI co-pilot</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {suggestions.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{
              background: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : UP
            }} />
            <span className="text-[10px] leading-snug" style={{
              color: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : TEXT
            }}>{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderTicket({ isOpen, onClose, initialSide, optionSymbol, optionInstruction, strategyLegs, strategyNetPrice, strategyIsCredit, isCloseOrder, onSwitchToStock, onSwitchToOptions, onSendToStrategist }: OrderTicketProps) {
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
  const accessToken = useTerminalStore((s) => s.accessToken);

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
  const [riskCollapsed, setRiskCollapsed] = useState(true);
  const [instruction, setInstruction] = useState<"NONE" | "ALL_OR_NONE" | "DO_NOT_REDUCE">("NONE");
  const [exchange, setExchange] = useState<"BEST" | "NYSE" | "NASDAQ" | "ARCA" | "BATS">("BEST");
  const [taxLotMethod, setTaxLotMethod] = useState<"DEFAULT" | "FIFO" | "LIFO" | "HIGH_COST" | "LOW_COST" | "SPEC_ID">("DEFAULT");
  // Send-to-Strategist mode: when "strategist", the CTA dispatches a
  // trade-validation debate instead of opening the review modal.
  const [sendMode, setSendMode] = useState<"order" | "strategist">("order");
  const [thesisText, setThesisText] = useState("");
  const [rollingShort, setRollingShort] = useState(false);
  const [strategistDispatchInFlight, setStrategistDispatchInFlight] = useState(false);
  // Mixed equity + option legs (only on stock tickets)
  const [extraOptionLegs, setExtraOptionLegs] = useState<MixedOptionLeg[]>([]);
  const [chainFetchEnabled, setChainFetchEnabled] = useState(false);
  // Quantity display string so the user can clear and retype freely
  const [qtyDisplay, setQtyDisplay] = useState("1");
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const isMultiLeg = !!strategyLegs && strategyLegs.length >= 1;
  const isOption = !!optionSymbol || isMultiLeg;
  const displaySymbol = isMultiLeg ? `${symbol} Strategy (${strategyLegs!.length} legs)` : optionSymbol ?? symbol;

  const ticketMode: TicketMode = isOption ? "options" : "stock";
  const ORDER_TYPES = isOption ? OPTION_ORDER_TYPES : STOCK_ORDER_TYPES;
  const DURATIONS = isOption ? OPTION_DURATIONS : STOCK_DURATIONS;

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
    spreadBid = Math.abs(spreadBid);
    spreadAsk = Math.abs(spreadAsk);
    if (spreadBid > spreadAsk) {
      const tmp = spreadBid;
      spreadBid = spreadAsk;
      spreadAsk = tmp;
    }
    const spreadMid = (spreadBid + spreadAsk) / 2;
    if (spreadMid <= 0) return { spreadBid: 0.01, spreadMid: 0.01, spreadAsk: 0.01 };
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
    setSendMode("order");
    setThesisText("");
    setRollingShort(false);
    setStrategistDispatchInFlight(false);
    setExtraOptionLegs([]);
    setChainFetchEnabled(false);
    setQtyDisplay("1");
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

  // ── Options chain for mixed equity+option legs ───────────────────────────
  const { data: extraChainData, isLoading: extraChainLoading } = useGetOptionChain(
    { symbol, contractType: "ALL", strikeCount: 100 },
    { query: { enabled: !isMultiLeg && !isOption && chainFetchEnabled && !!accessToken, staleTime: 60_000, gcTime: 5 * 60_000 } }
  );

  const chainExpirations = useMemo<string[]>(() => {
    if (!extraChainData) return [];
    type C = { expiration?: string };
    const all = [...((extraChainData.calls ?? []) as C[]), ...((extraChainData.puts ?? []) as C[])];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const c of all) {
      if (c.expiration && !seen.has(c.expiration)) { seen.add(c.expiration); result.push(c.expiration); }
    }
    return result.sort();
  }, [extraChainData]);

  const getExtraChainDTE = (exp: string): number => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(exp + "T00:00:00"); d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.ceil((d.getTime() - today.getTime()) / 86400000));
  };

  const formatExpLabel = (exp: string): string => {
    const d = new Date(exp + "T00:00:00");
    const mon = d.toLocaleString("en-US", { month: "short" });
    return `${mon} ${d.getDate()} · ${getExtraChainDTE(exp)} DTE`;
  };

  const getStrikesForMixedLeg = (leg: MixedOptionLeg): number[] => {
    if (!extraChainData || !leg.optionType || !leg.expiration) return [];
    type C = { expiration?: string; strike?: number };
    const contracts = (leg.optionType === "CALL" ? (extraChainData.calls ?? []) : (extraChainData.puts ?? [])) as C[];
    return contracts.filter(c => c.expiration === leg.expiration).map(c => c.strike!).filter(Boolean).sort((a, b) => a - b);
  };

  const getContractForMixedLeg = (leg: MixedOptionLeg) => {
    if (!extraChainData || !leg.optionType || !leg.expiration || !leg.strike) return null;
    type C = { expiration?: string; strike?: number; bid?: number; ask?: number; delta?: number };
    const contracts = (leg.optionType === "CALL" ? (extraChainData.calls ?? []) : (extraChainData.puts ?? [])) as C[];
    return contracts.find(c => c.expiration === leg.expiration && c.strike === leg.strike) ?? null;
  };

  const needsLimit = orderType === "LIMIT" || orderType === "STOP_LIMIT" || orderType === "TRAILING_STOP_LIMIT" || orderType === "LIMIT_ON_CLOSE" || orderType === "WALK_LIMIT";
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

  // Net debit when extra option legs are added to a stock ticket
  const mixedNetDebit = useMemo(() => {
    const stockCost = estimatedCost ?? 0;
    const optCost = extraOptionLegs.reduce((sum, leg) => {
      if (leg.strike === null) return sum;
      const mid = leg.bid != null && leg.ask != null ? (leg.bid + leg.ask) / 2 : parseFloat(leg.limitPrice) || 0;
      return sum + ((leg.side === "BUY" ? 1 : -1) * mid * leg.quantity * 100);
    }, 0);
    return stockCost + optCost;
  }, [estimatedCost, extraOptionLegs]);

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
        // Determine net direction from actual current leg prices (sell legs contribute positive, buy legs negative)
        const netDirection = strategyLegs.reduce((acc, leg) => {
          const isSell = leg.instruction.startsWith("SELL");
          const mid = ((leg.bid ?? 0) + (leg.ask ?? 0)) / 2;
          return acc + (isSell ? mid : -mid);
        }, 0);
        // Schwab multi-leg orderType: NET_CREDIT when net is positive, NET_DEBIT when negative
        const spreadOrderType = useMarket ? "MARKET" : (netDirection >= 0 ? "NET_CREDIT" : "NET_DEBIT");
        // Auto-detect complexOrderStrategyType from leg symbols
        // OCC symbol format: TICKER(6) + YYMMDD(6) + C/P(1) + STRIKE(8) — C/P is always at index 12
        const getSymParts = (sym: string) => ({ date: sym.substring(6, 12), cp: sym.charAt(12) });
        let complexType = "CUSTOM";
        if (strategyLegs.length === 2) {
          const p0 = getSymParts(strategyLegs[0].schwabSymbol);
          const p1 = getSymParts(strategyLegs[1].schwabSymbol);
          if (p0.date === p1.date && p0.cp === p1.cp) complexType = "VERTICAL";
          else if (p0.date === p1.date && p0.cp !== p1.cp) complexType = "STRANGLE";
        } else if (strategyLegs.length === 4) {
          const cps = strategyLegs.map(l => getSymParts(l.schwabSymbol).cp);
          if (cps.filter(c => c === "C").length === 2 && cps.filter(c => c === "P").length === 2) complexType = "IRON_CONDOR";
        }
        const o: Record<string, unknown> = {
          orderType: spreadOrderType,
          session,
          duration,
          complexOrderStrategyType: complexType,
          orderStrategyType: "SINGLE",
          orderLegCollection: strategyLegs.map(leg => ({
            instruction: leg.instruction,
            quantity: leg.quantity * quantity,
            instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
          })),
        };
        if (!useMarket && resolvedPrice > 0) o.price = resolvedPrice;
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
    const resolvedNeedsLimit = resolvedOrderType === "LIMIT" || resolvedOrderType === "WALK_LIMIT" || needsLimit;

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
          const credit = parseFloat(limitPrice) || 0;
          const qty = parseInt(String(quantity)) || 1;
          return computeStrategyEconomics({ legs: strategyLegs, netPrice: credit, quantity: qty, isCredit: strategyIsCredit }).maxRisk;
        })(),
        maxGain: (() => {
          if (!isMultiLeg || !strategyLegs || strategyLegs.length < 2) return null;
          const credit = parseFloat(limitPrice) || 0;
          const qty = parseInt(String(quantity)) || 1;
          return computeStrategyEconomics({ legs: strategyLegs, netPrice: credit, quantity: qty, isCredit: strategyIsCredit }).maxProfit;
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

  // ── Send-to-Strategist (trade validation) ────────────────────────────────
  // Rolling-short eligibility: a multi-leg ticket with at least one short leg
  // whose expiration is BEFORE at least one long leg's expiration. Classic
  // calendar / diagonal shape. We surface a checkbox so the trader can flag
  // this intent explicitly to the strategist.
  const isRollingShortEligible = useMemo(() => {
    if (!isMultiLeg || !strategyLegs || strategyLegs.length < 2) return false;
    const shortLegs = strategyLegs.filter(l => l.instruction.startsWith("SELL") && !!l.expiration);
    const longLegs = strategyLegs.filter(l => l.instruction.startsWith("BUY") && !!l.expiration);
    if (shortLegs.length === 0 || longLegs.length === 0) return false;
    return shortLegs.some(s => longLegs.some(lg => s.expiration < lg.expiration));
  }, [isMultiLeg, strategyLegs]);

  // Reset rollingShort when it becomes ineligible (e.g. user switched ticket).
  useEffect(() => {
    if (!isRollingShortEligible && rollingShort) setRollingShort(false);
  }, [isRollingShortEligible, rollingShort]);

  const handleSendToStrategist = useCallback(async () => {
    if (strategistDispatchInFlight) return;
    setStrategistDispatchInFlight(true);
    const upperTicker = symbol.toUpperCase();
    const jobId = `vj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const mode: "opening" | "closing" = isCloseOrder ? "closing" : "opening";

    // Build the validation ticket payload. Mirrors api-server's
    // ValidationTicket type. We include best-effort economics so the
    // strategist can ground its analysis without a second round-trip.
    let estMaxRisk: number | null = null;
    let estMaxProfit: number | null = null;
    let breakeven: number | null = null;
    if (isMultiLeg && strategyLegs && strategyLegs.length >= 2) {
      const px = parseFloat(limitPrice) || 0;
      const econ = computeStrategyEconomics({ legs: strategyLegs, netPrice: px, quantity, isCredit: strategyIsCredit });
      estMaxRisk = econ.maxRisk;
      estMaxProfit = econ.maxProfit;
      if (econ.breakevens.length === 1) breakeven = econ.breakevens[0];
    } else if (!isOption) {
      const px = parseFloat(limitPrice) || quote?.last || 0;
      estMaxRisk = px * quantity;
    }

    const configuredExtraLegs = extraOptionLegs.filter(l => l.strike !== null);
    const hasMixedLegs = !isMultiLeg && !isOption && configuredExtraLegs.length > 0;

    const validationLegs = isMultiLeg && strategyLegs
      ? strategyLegs.map(l => ({
          instruction: l.instruction,
          strike: l.strike,
          optionType: (l.optionType?.toUpperCase() === "CALL" ? "CALL" : "PUT") as "CALL" | "PUT",
          expiration: l.expiration,
          quantity: l.quantity,
          bid: l.bid ?? null,
          ask: l.ask ?? null,
          delta: l.delta ?? null,
        }))
      : (isOption && optionSymbol
          ? [{
              instruction: optionInstruction ?? (side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_CLOSE"),
              quantity,
              bid: quote?.bid ?? null,
              ask: quote?.ask ?? null,
            }]
          : hasMixedLegs
            ? configuredExtraLegs.map(l => ({
                instruction: l.side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_OPEN",
                strike: l.strike!,
                optionType: l.optionType!,
                expiration: l.expiration!,
                quantity: l.quantity,
                bid: l.bid ?? null,
                ask: l.ask ?? null,
                delta: l.delta ?? null,
              }))
            : undefined);

    // When the order ticket carries a stock backbone with option legs added
    // (e.g. married put, covered call, collar, buy-write), the share leg is
    // a first-class part of the ticket. We surface it explicitly so the
    // strategist evaluates the COMBINED order, not just the option legs.
    const stockLeg = hasMixedLegs
      ? {
          instruction: side as "BUY" | "SELL",
          quantity,
          // Only carry an explicit limit price if the user actually entered
          // one for a LIMIT-style order. For MARKET orders we send null —
          // never inject `quote.last` as a pseudo-limit, which would mislead
          // the strategist into validating against a price the order won't
          // honor.
          limitPrice: orderType === "LIMIT" ? (parseFloat(limitPrice) || null) : null,
        }
      : null;

    // Look up any underlying-shares position the trader currently holds in
    // the same ticker so the strategist can see the *full* position context
    // (covered call, covered put, married/protective put, assignment-cover,
    // etc). Without this the bull/bear personas only see the option leg(s)
    // and miss the most important risk/coverage fact about the trade.
    const portfolioAccount = usePortfolioStreamStore.getState().account;
    const equityPos = (portfolioAccount?.positions ?? []).find((p: any) => {
      const at = (p?.assetType ?? "").toString().toUpperCase();
      const ul = (p?.underlyingSymbol ?? p?.symbol ?? "").toString().toUpperCase();
      return at === "EQUITY" && ul === upperTicker;
    });
    let underlyingShares: { side: "long" | "short"; quantity: number; averagePrice: number | null; marketValue: number | null } | null = null;
    if (equityPos) {
      const longQ = Number(equityPos.longQuantity ?? 0);
      const shortQ = Number(equityPos.shortQuantity ?? 0);
      if (longQ > 0) {
        underlyingShares = {
          side: "long",
          quantity: longQ,
          averagePrice: Number.isFinite(equityPos.averagePrice) ? Number(equityPos.averagePrice) : null,
          marketValue: Number.isFinite(equityPos.marketValue) ? Number(equityPos.marketValue) : null,
        };
      } else if (shortQ > 0) {
        underlyingShares = {
          side: "short",
          quantity: shortQ,
          averagePrice: Number.isFinite(equityPos.averagePrice) ? Number(equityPos.averagePrice) : null,
          marketValue: Number.isFinite(equityPos.marketValue) ? Number(equityPos.marketValue) : null,
        };
      }
    }

    const ticket = {
      ticker: upperTicker,
      isOption: isOption || hasMixedLegs,
      isMultiLeg: isMultiLeg || hasMixedLegs,
      mode,
      side,
      orderType,
      duration,
      quantity,
      limitPrice: parseFloat(limitPrice) || null,
      legs: validationLegs,
      // Prefer user-edited limit (the ticket they intend to send) over the
      // initial strategyNetPrice; fall back if no edit was made.
      netPrice: isMultiLeg
        ? (parseFloat(limitPrice) || strategyNetPrice || null)
        : null,
      isCredit: isMultiLeg ? (strategyIsCredit ?? null) : null,
      underlyingPrice: quote?.last ?? null,
      underlyingChangePct: quote?.changePct ?? null,
      estMaxRisk,
      estMaxProfit,
      breakeven,
      underlyingShares,
      stockLeg,
      // Frontend-only echoes for faithful reopen.
      optionSymbol: !isMultiLeg && isOption ? optionSymbol : undefined,
      optionInstruction: !isMultiLeg && isOption ? optionInstruction : undefined,
    };

    const validationMeta = {
      ticker: upperTicker,
      mode,
      ticket,
      thesis: thesisText.trim() || undefined,
      rollingShort: isRollingShortEligible && rollingShort,
    };

    // Register with the global jobs store so the Strategist tab can render
    // the live validation card immediately on navigation.
    useTerminalStore.getState().startStrategistJob(jobId, upperTicker, {
      kind: 'validation',
      validationMeta,
    });

    try {
      const res = await fetchWithAuth(`/api/strategist/validate-trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          ticket,
          thesis: validationMeta.thesis,
          rollingShort: validationMeta.rollingShort,
        }),
        keepalive: true,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "Failed to start validation");
        const friendly = humanizeFailedApiBody(res.status, errText);
        useTerminalStore.getState().errorStrategistJob(jobId, friendly);
        setErrorMsg(`Strategist dispatch failed: ${friendly.slice(0, 200)}`);
        setStrategistDispatchInFlight(false);
        return; // stay on the ticket so the user can retry / adjust
      }
      startStrategistPolling(jobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useTerminalStore.getState().errorStrategistJob(jobId, msg);
      setErrorMsg(`Strategist dispatch failed: ${msg.slice(0, 200)}`);
      setStrategistDispatchInFlight(false);
      return;
    }

    // Hand off to Terminal: switch to AI > Strategist sub-tab + close ticket.
    onSendToStrategist?.(upperTicker);
    setStrategistDispatchInFlight(false);
  }, [
    strategistDispatchInFlight, symbol, isCloseOrder, isMultiLeg, strategyLegs, limitPrice,
    strategyIsCredit, quantity, isOption, optionSymbol, optionInstruction, side, orderType,
    duration, strategyNetPrice, quote, thesisText, isRollingShortEligible, rollingShort,
    onSendToStrategist,
  ]);

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

            {/* TICKER HEADER — matching StrategyBuilder */}
            {isMultiLeg ? (
              <div className="flex items-center justify-between" style={{ background: CARD_GRAD, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "5px 10px" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold tracking-[0.06em]" style={{ color: GOLD }}>{symbol}</span>
                  <span className="text-[13px]" style={{ color: WHITE }}>{fmt(quote?.last)}</span>
                  <span className="text-[11px]" style={{ color: changeColor }}>
                    {changePct != null ? `${changePct >= 0 ? "+" : ""}${fmt(changePct)}%` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: MUTED }}>
                  {strategyLegs?.[0] && (() => {
                    const sym = strategyLegs[0].schwabSymbol ?? "";
                    if (sym.length >= 12) {
                      const yr = sym.substring(6, 8);
                      const mo = sym.substring(8, 10);
                      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                      const mIdx = parseInt(mo, 10) - 1;
                      return <span>{months[mIdx] ?? mo} 20{yr}</span>;
                    }
                    return null;
                  })()}
                  <span className="px-1.5 py-px" style={{ borderRadius: 10, border: `1px solid ${BORDER}`, color: TEXT, fontSize: 10 }}>
                    Schwab
                  </span>
                </div>
              </div>
            ) : (
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
            )}

            {/* FOR STRATEGIST REVIEW — top-of-form toggle + optional fields */}
            <div
              style={{
                background: CARD_GRAD,
                borderRadius: R_CARD,
                border: `1px solid ${sendMode === "strategist" ? "#5ad1c060" : BORDER}`,
                padding: "10px 12px",
              }}
            >
              <label className="flex items-center justify-between cursor-pointer">
                <span style={{ fontSize: 13, color: WHITE, fontWeight: 500 }}>
                  For Strategist Review
                </span>
                <span
                  onClick={() => setSendMode(sendMode === "strategist" ? "order" : "strategist")}
                  className="relative transition-all duration-200"
                  style={{
                    width: 44,
                    height: 26,
                    borderRadius: 999,
                    background: sendMode === "strategist" ? "#5ad1c0" : "#2a2a2a",
                    border: `1px solid ${sendMode === "strategist" ? "#5ad1c0" : BORDER}`,
                    flexShrink: 0,
                  }}
                >
                  <span
                    className="absolute top-1/2 transition-all duration-200"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: sendMode === "strategist" ? BG : "#888",
                      transform: `translate(${sendMode === "strategist" ? 20 : 2}px, -50%)`,
                    }}
                  />
                </span>
              </label>
              {sendMode === "strategist" && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={thesisText}
                    onChange={(e) => setThesisText(e.target.value)}
                    placeholder={isCloseOrder
                      ? "Why are you closing? (optional)"
                      : "Describe your strategy (optional)"}
                    rows={3}
                    maxLength={2000}
                    className="w-full px-3 py-2 resize-none"
                    style={{
                      background: FIELD,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 10,
                      color: WHITE,
                      fontSize: S.label,
                      fontFamily: SYS_FONT,
                      outline: "none",
                    }}
                  />
                  {isRollingShortEligible && (
                    <label
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                      style={{ background: FIELD, border: `1px solid ${BORDER}`, borderRadius: 10 }}
                    >
                      <input
                        type="checkbox"
                        checked={rollingShort}
                        onChange={(e) => setRollingShort(e.target.checked)}
                        style={{ accentColor: "#5ad1c0" }}
                      />
                      <span style={{ fontSize: S.label, color: TEXT }}>
                        Rolling short — short leg expires before long leg
                      </span>
                    </label>
                  )}
                </div>
              )}
            </div>

            {isMultiLeg && strategyLegs ? (
              <>
                {/* STRATEGY METRICS — 4-col grid matching StrategyBuilder */}
                {(() => {
                  const netPrice = parseFloat(limitPrice) || strategyNetPrice || 0;
                  const econ = computeStrategyEconomics({ legs: strategyLegs, netPrice, quantity, isCredit: strategyIsCredit });
                  const netAmt = netPrice * 100 * quantity;
                  const maxRisk = econ.maxRisk;
                  const maxGain = econ.maxProfit;
                  const rr = maxRisk > 0 ? `${(maxGain / maxRisk).toFixed(2)}:1` : "—";
                  const allCalls = strategyLegs.every(l => l.optionType === "CALL");
                  const allPuts = strategyLegs.every(l => l.optionType === "PUT");
                  const stratName = econ.isIronCondor
                    ? "Iron Condor"
                    : strategyLegs.length === 2
                      ? (allPuts ? (strategyIsCredit ? "Bull Put Spread" : "Bear Put Spread") : allCalls ? (strategyIsCredit ? "Bear Call Spread" : "Bull Call Spread") : "Vertical Spread")
                      : `${strategyLegs.length}-Leg Strategy`;
                  const breakevens: number[] = econ.breakevens;
                  const popLeg = strategyIsCredit
                    ? strategyLegs.find(l => l.instruction.startsWith("SELL"))
                    : strategyLegs.find(l => l.instruction.startsWith("BUY"));
                  const popPct = (popLeg?.delta != null)
                    ? Math.round((strategyIsCredit ? (1 - Math.abs(popLeg.delta)) : Math.abs(popLeg.delta)) * 100)
                    : null;
                  const bp = balances.buyingPower ?? accountSize ?? 0;
                  const bpChange = -econ.maxRisk;
                  return (
                    <div style={{ background: `linear-gradient(145deg, #14161a, #080a0f)`, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium" style={{ color: WHITE }}>{stratName}</span>
                          <span className="text-[11px]" style={{ color: TEXT }}>
                            {strategyLegs.length}-leg {strategyIsCredit ? "credit" : "debit"}
                          </span>
                        </div>
                        <span className="text-[10px] px-1.5 py-px" style={{ borderRadius: 999, border: `1px solid ${strategyIsCredit ? `${UP}66` : `${DOWN}66`}`, background: strategyIsCredit ? `${UP}0a` : `${DOWN}0a`, color: strategyIsCredit ? UP : DOWN }}>
                          {strategyIsCredit ? "Credit" : "Debit"}
                        </span>
                      </div>

                      <div className="mt-1 grid grid-cols-4 gap-x-2 pt-1 text-[11px]" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                        <div>
                          <div style={{ color: MUTED }}>Net {strategyIsCredit ? "credit" : "debit"}</div>
                          <div className="text-[13px]" style={{ color: WHITE }}>{fmtCurrency(netAmt)}</div>
                        </div>
                        <div>
                          <div style={{ color: MUTED }}>Max risk</div>
                          <div className="text-[13px]" style={{ color: WHITE }}>{fmtCurrency(maxRisk > 0 ? maxRisk : 0)}</div>
                        </div>
                        <div>
                          <div style={{ color: MUTED }}>POP</div>
                          <div className="text-[13px]" style={{ color: popPct != null ? WHITE : TEXT }}>{popPct != null ? `${popPct}%` : "—"}</div>
                        </div>
                        <div>
                          <div style={{ color: MUTED }}>R:R</div>
                          <div className="text-[13px]" style={{ color: WHITE }}>{rr}</div>
                        </div>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center justify-between gap-1 pt-1 text-[12px]" style={{ borderTop: `1px dashed ${DIVIDER}`, color: TEXT }}>
                        <span>Breakeven {breakevens.length > 0 ? breakevens.map(b => `$${b.toFixed(2)}`).join(" / ") : "—"}</span>
                        <span>Buying Power {bpChange >= 0 ? "" : "−"}{fmtCurrency(Math.abs(bpChange))}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* LEGS — matching StrategyBuilder format */}
                <div style={{ background: CARD_GRAD, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                  <div className="flex items-center justify-between text-[13px]" style={{ color: TEXT }}>
                    <span className="uppercase tracking-[0.06em]">Legs</span>
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                  {strategyLegs.map((leg, i) => {
                    const isBuyLeg = leg.instruction.startsWith("BUY");
                    const dirColor = isBuyLeg ? UP : DOWN;
                    const isOpenLeg = leg.instruction.includes("OPEN");
                    const roleLabel = isOpenLeg ? "OPEN" : "CLOSE";
                    const qtySign = isBuyLeg ? "+" : "-";
                    const mid = (leg.bid != null && leg.ask != null) ? (leg.bid + leg.ask) / 2 : null;
                    const expLabel = (() => {
                      const sym = leg.schwabSymbol ?? "";
                      if (sym.length >= 12) {
                        const yr = sym.substring(6, 8);
                        const mo = sym.substring(8, 10);
                        const dy = sym.substring(10, 12);
                        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        const mIdx = parseInt(mo, 10) - 1;
                        const dayNum = parseInt(dy, 10);
                        if (months[mIdx] && !Number.isNaN(dayNum)) {
                          return `${months[mIdx]} ${dayNum}, 20${yr}`;
                        }
                        return `${months[mIdx] ?? mo} 20${yr}`;
                      }
                      return "";
                    })();
                    return (
                      <div key={i}
                        className="flex items-center justify-between px-2 py-1"
                        style={{ borderRadius: 8, background: "rgba(255,255,255,0.01)", border: `1px solid ${BORDER}70` }}
                      >
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 text-[12px]">
                            <span className="text-[11px] tracking-[0.09em]" style={{ color: dirColor }}>{roleLabel}</span>
                            <span style={{ color: WHITE }}>{qtySign}{leg.quantity} · {leg.strike} {leg.optionType === "CALL" ? "Call" : "Put"}{expLabel ? ` · ${expLabel}` : ""}</span>
                          </div>
                          <div className="text-[12px]" style={{ color: TEXT }}>{isBuyLeg ? "Buy" : "Sell"} · {mid != null ? `Mark ${mid.toFixed(2)}` : "No data"}</div>
                        </div>
                        <div className="flex items-center gap-2 text-[12px]" style={{ color: TEXT }}>
                          <span>Bid {leg.bid?.toFixed(2) ?? "—"} / Ask {leg.ask?.toFixed(2) ?? "—"}</span>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>

                {/* ORDER — matching StrategyBuilder */}
                <div style={{ background: `linear-gradient(145deg, #14161a, #080a0f)`, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                  <div className="text-[13px] uppercase tracking-[0.06em] mb-1" style={{ color: TEXT }}>Order</div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="flex flex-col gap-px relative">
                      <span className="text-[11px]" style={{ color: MUTED }}>Order type</span>
                      <button onClick={() => { setShowOrderType(!showOrderType); setShowTifDropdown(false); }}
                        className="flex items-center justify-between px-2 text-[12px]"
                        style={{ height: 26, borderRadius: 7, border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.4)", color: WHITE }}>
                        <span>{ORDER_TYPES.find((t) => t.value === orderType)?.label ?? "Limit"}</span>
                        <span className="text-[10px]" style={{ color: MUTED }}>▾</span>
                      </button>
                      {showOrderType && (
                        <div className="absolute top-full left-0 right-0 mt-1 z-10 overflow-hidden shadow-xl" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 9 }}>
                          {ORDER_TYPES.map((t) => (
                            <button key={t.value} onClick={() => { setOrderType(t.value); setShowOrderType(false); }}
                              className="w-full text-left px-2.5 py-1.5 transition-colors text-[12px]"
                              style={{ color: orderType === t.value ? GOLD : TEXT, background: orderType === t.value ? GOLD_DIM : "transparent" }}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-px relative">
                      <span className="text-[11px]" style={{ color: MUTED }}>Time in force</span>
                      <button onClick={() => { setShowTifDropdown(!showTifDropdown); setShowOrderType(false); }}
                        className="flex items-center justify-between px-2 text-[12px]"
                        style={{ height: 26, borderRadius: 7, border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.4)", color: WHITE }}>
                        <span>{DURATIONS.find((d) => d.value === duration)?.label}</span>
                        <span className="text-[10px]" style={{ color: MUTED }}>▾</span>
                      </button>
                      {showTifDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-1 z-10 overflow-hidden shadow-xl" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 9 }}>
                          {DURATIONS.map((d) => (
                            <button key={d.value} onClick={() => { setDuration(d.value); setShowTifDropdown(false); }}
                              className="w-full text-left px-2.5 py-1.5 transition-colors text-[12px]"
                              style={{ color: duration === d.value ? GOLD : TEXT, background: duration === d.value ? GOLD_DIM : "transparent" }}>
                              {d.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 flex flex-col gap-px">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]" style={{ color: MUTED }}>Net {strategyIsCredit ? "credit" : "debit"} price</span>
                      <button onClick={() => setPriceLocked(!priceLocked)} className="p-0.5" style={{ color: priceLocked ? GOLD : DIM, background: "none", border: "none", cursor: "pointer" }} aria-label={priceLocked ? "Unlock price" : "Lock price"}>
                        {priceLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-1" style={{ height: 28, borderRadius: 7, border: `1px solid ${priceLocked ? `${GOLD}4d` : BORDER}`, background: "rgba(0,0,0,0.4)", padding: "0 8px" }}>
                      <input type="number" inputMode="decimal" step="0.01" value={limitPrice}
                        onChange={(e) => { if (!priceLocked) setLimitPrice(e.target.value); }} placeholder="0.00"
                        className="flex-1 text-[13px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-right"
                        style={{ color: priceLocked ? GOLD : WHITE, border: "none", fontFamily: SYS_FONT }}
                        readOnly={priceLocked}
                      />
                      <span className="text-[11px]" style={{ color: MUTED }}>USD</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px]" style={{ color: TEXT }}>
                      <button onClick={() => { if (!priceLocked && effectiveBid != null) setLimitPrice(effectiveBid.toFixed(2)); }} disabled={priceLocked} className="px-1.5 py-px"
                        style={{ borderRadius: 999, border: "1px solid transparent", opacity: priceLocked ? 0.4 : 1 }}>
                        Bid {effectiveBid != null ? fmt(effectiveBid) : "—"}
                      </button>
                      <button onClick={() => { if (!priceLocked) setMidPrice(); }} disabled={priceLocked} className="px-1.5 py-px"
                        style={{ borderRadius: 999, border: `1px solid ${GOLD}70`, background: `${GOLD}0a`, color: GOLD, opacity: priceLocked ? 0.4 : 1 }}>
                        Mid {midPrice != null ? fmt(midPrice) : "—"}
                      </button>
                      <button onClick={() => { if (!priceLocked) setNatPrice(); }} disabled={priceLocked} className="px-1.5 py-px"
                        style={{ borderRadius: 999, border: "1px solid transparent", opacity: priceLocked ? 0.4 : 1 }}>
                        Ask {effectiveAsk != null ? fmt(effectiveAsk) : "—"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <div>
                      <span className="text-[11px]" style={{ color: MUTED }}>Quantity</span>
                      <span className="ml-1 text-[11px]" style={{ color: TEXT }}>Spreads · 100sh/ct</span>
                    </div>
                    <div className="inline-flex items-center" style={{ borderRadius: 14, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
                      <button onClick={() => { const n = Math.max(1, quantity - 1); setQuantity(n); setQtyDisplay(String(n)); }} className="flex items-center justify-center transition-colors active:opacity-70" style={{ width: 24, height: 22, color: TEXT, background: "transparent", border: "none" }} aria-label="Decrease quantity">
                        <Minus className="w-3 h-3" />
                      </button>
                      <input ref={qtyInputRef} type="text" inputMode="numeric" value={qtyDisplay}
                        onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ""); setQtyDisplay(raw); const v = parseInt(raw); if (!isNaN(v) && v >= 1) setQuantity(v); }}
                        onBlur={() => { if (!qtyDisplay || parseInt(qtyDisplay) < 1) { setQtyDisplay(String(quantity)); } }}
                        className="text-center text-[12px] bg-transparent outline-none"
                        style={{ color: WHITE, minWidth: 26, width: 26, border: "none", fontFamily: SYS_FONT }}
                      />
                      <button onClick={() => { const n = quantity + 1; setQuantity(n); setQtyDisplay(String(n)); }} className="flex items-center justify-center transition-colors active:opacity-70" style={{ width: 24, height: 22, color: TEXT, background: "transparent", border: "none" }} aria-label="Increase quantity">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-1 pt-1 text-[11px]" style={{ borderTop: `1px dashed ${DIVIDER}`, color: MUTED }}>
                    <span>Total {strategyIsCredit ? "credit" : "cost"} {estimatedCost != null ? fmtCurrency(Math.abs(estimatedCost)) : "—"}</span>
                    <span>Max risk {(() => {
                      const netP = parseFloat(limitPrice) || strategyNetPrice || 0;
                      const econ = computeStrategyEconomics({ legs: strategyLegs, netPrice: netP, quantity, isCredit: strategyIsCredit });
                      return fmtCurrency(econ.maxRisk);
                    })()}</span>
                    <span>Fees $0.65/ct</span>
                  </div>
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
                      <button onClick={() => { const n = Math.max(1, quantity - 1); setQuantity(n); setQtyDisplay(String(n)); }} className="flex items-center justify-center" style={{ width: 28, height: 26, color: TEXT, background: "transparent", border: "none" }} aria-label="Decrease quantity">
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input ref={qtyInputRef} type="text" inputMode="numeric" value={qtyDisplay}
                        onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ""); setQtyDisplay(raw); const v = parseInt(raw); if (!isNaN(v) && v >= 1) setQuantity(v); }}
                        onBlur={() => { if (!qtyDisplay || parseInt(qtyDisplay) < 1) { setQtyDisplay(String(quantity)); } }}
                        className="text-center bg-transparent outline-none"
                        style={{ fontSize: S.heading, color: WHITE, minWidth: 32, width: 32, border: "none", fontFamily: SYS_FONT }}
                      />
                      <button onClick={() => { const n = quantity + 1; setQuantity(n); setQtyDisplay(String(n)); }} className="flex items-center justify-center" style={{ width: 28, height: 26, color: TEXT, background: "transparent", border: "none" }} aria-label="Increase quantity">
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

                {/* ── Mixed equity + option legs ──────────────────────────── */}
                {!isOption && (
                  <div className="mt-3" style={{ borderTop: `1px dashed ${DIVIDER}`, paddingTop: 8 }}>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: S.label, color: MUTED }}>Option legs</span>
                      <button
                        onClick={() => {
                          setChainFetchEnabled(true);
                          setExtraOptionLegs(prev => [...prev, { id: `leg_${Date.now()}`, optionType: null, expiration: null, strike: null, side: "BUY", quantity: 1, bid: null, ask: null, delta: null, limitPrice: "" }]);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5"
                        style={{ fontSize: S.tiny, color: GOLD, border: `1px solid ${GOLD}60`, background: GOLD_DIM, borderRadius: 999 }}
                      >
                        <Plus className="w-3 h-3" /> Add Option
                      </button>
                    </div>

                    {extraOptionLegs.map((leg, idx) => (
                      <div key={leg.id} className="mb-2 rounded-lg p-2" style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${BORDER}` }}>
                        {/* Leg header */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span style={{ fontSize: S.tiny, color: MUTED }}>Leg {idx + 1}</span>
                          <button onClick={() => setExtraOptionLegs(prev => prev.filter(l => l.id !== leg.id))} style={{ color: MUTED, background: "none", border: "none", cursor: "pointer", display: "flex" }}>
                            <X className="w-3 h-3" />
                          </button>
                        </div>

                        {/* BUY / SELL toggle */}
                        <div className="inline-flex mb-2" style={{ borderRadius: 999, overflow: "hidden", border: `1px solid ${BORDER}` }}>
                          {(["BUY", "SELL"] as const).map(s => (
                            <button key={s} onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, side: s } : l))}
                              className="px-3 py-0.5 transition-all"
                              style={{ fontSize: S.tiny, background: leg.side === s ? (s === "BUY" ? UP : DOWN) : "transparent", color: leg.side === s ? WHITE : MUTED, border: "none" }}>
                              {s}
                            </button>
                          ))}
                        </div>

                        {/* Step 1: Call or Put */}
                        {!leg.optionType ? (
                          <div className="flex gap-2">
                            {(["CALL", "PUT"] as const).map(t => (
                              <button key={t}
                                onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, optionType: t } : l))}
                                className="flex-1 py-1.5 rounded-lg transition-all"
                                style={{ fontSize: S.tiny, border: `1px solid ${BORDER}`, background: FIELD, color: TEXT }}>
                                {t}
                              </button>
                            ))}
                          </div>
                        ) : !leg.expiration ? (
                          /* Step 2: Expiration */
                          <div>
                            <div className="flex items-center gap-1 mb-1">
                              <button onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, optionType: null } : l))} style={{ color: MUTED, background: "none", border: "none", cursor: "pointer", display: "flex" }}>
                                <ArrowLeft className="w-3 h-3" />
                              </button>
                              <span style={{ fontSize: S.tiny, color: MUTED }}>{leg.optionType} · Pick expiration</span>
                            </div>
                            {extraChainLoading ? (
                              <div className="flex items-center gap-1" style={{ color: MUTED, fontSize: S.tiny }}>
                                <Loader2 className="w-3 h-3 animate-spin" /> Loading chain…
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1" style={{ maxHeight: 128, overflowY: "auto" }}>
                                {chainExpirations.map(exp => (
                                  <button key={exp}
                                    onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, expiration: exp } : l))}
                                    className="text-left px-2 py-1 rounded"
                                    style={{ fontSize: S.tiny, background: FIELD, border: `1px solid ${BORDER}`, color: TEXT }}>
                                    {formatExpLabel(exp)}
                                  </button>
                                ))}
                                {chainExpirations.length === 0 && <span style={{ fontSize: S.tiny, color: MUTED }}>No expirations available</span>}
                              </div>
                            )}
                          </div>
                        ) : !leg.strike ? (
                          /* Step 3: Strike */
                          <div>
                            <div className="flex items-center gap-1 mb-1">
                              <button onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, expiration: null } : l))} style={{ color: MUTED, background: "none", border: "none", cursor: "pointer", display: "flex" }}>
                                <ArrowLeft className="w-3 h-3" />
                              </button>
                              <span style={{ fontSize: S.tiny, color: MUTED }}>{leg.optionType} · {formatExpLabel(leg.expiration)} · Pick strike</span>
                            </div>
                            <div className="flex flex-col gap-1" style={{ maxHeight: 160, overflowY: "auto" }}>
                              {getStrikesForMixedLeg(leg).map(strike => (
                                <button key={strike}
                                  onClick={() => {
                                    const contract = getContractForMixedLeg({ ...leg, strike });
                                    const mid = contract?.bid != null && contract?.ask != null ? (contract.bid + contract.ask) / 2 : null;
                                    setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, strike, bid: contract?.bid ?? null, ask: contract?.ask ?? null, delta: contract?.delta ?? null, limitPrice: mid != null ? mid.toFixed(2) : "" } : l));
                                  }}
                                  className="text-left px-2 py-1 rounded"
                                  style={{ fontSize: S.tiny, background: FIELD, border: `1px solid ${BORDER}`, color: TEXT }}>
                                  ${strike}
                                </button>
                              ))}
                              {getStrikesForMixedLeg(leg).length === 0 && <span style={{ fontSize: S.tiny, color: MUTED }}>No strikes found</span>}
                            </div>
                          </div>
                        ) : (
                          /* Fully configured — summary row */
                          <div>
                            <div className="flex items-center gap-1 mb-1">
                              <button onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, strike: null, bid: null, ask: null, delta: null, limitPrice: "" } : l))} style={{ color: MUTED, background: "none", border: "none", cursor: "pointer", display: "flex" }}>
                                <ArrowLeft className="w-3 h-3" />
                              </button>
                              <span style={{ fontSize: S.tiny, color: WHITE, fontWeight: 600 }}>{leg.optionType} ${leg.strike} · {formatExpLabel(leg.expiration)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <div style={{ fontSize: S.tiny, color: MUTED }}>
                                {leg.bid != null && leg.ask != null && <span>Bid {fmt(leg.bid)} · Ask {fmt(leg.ask)}</span>}
                                {leg.delta != null && <span className="ml-2">Δ {leg.delta.toFixed(2)}</span>}
                              </div>
                              <div className="inline-flex items-center" style={{ borderRadius: 999, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
                                <button onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l))} style={{ width: 22, height: 20, color: TEXT, background: "transparent", border: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <Minus className="w-2.5 h-2.5" />
                                </button>
                                <input type="text" inputMode="numeric" value={leg.quantity}
                                  onChange={(e) => { const v = parseInt(e.target.value.replace(/[^0-9]/g, "")); if (!isNaN(v) && v >= 1) setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, quantity: v } : l)); }}
                                  className="text-center bg-transparent outline-none"
                                  style={{ fontSize: S.body, color: WHITE, minWidth: 24, width: 24, border: "none" }} />
                                <button onClick={() => setExtraOptionLegs(prev => prev.map(l => l.id === leg.id ? { ...l, quantity: l.quantity + 1 } : l))} style={{ width: 22, height: 20, color: TEXT, background: "transparent", border: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Net debit row */}
                    {extraOptionLegs.some(l => l.strike !== null) && (
                      <div className="mt-1 pt-1" style={{ borderTop: `1px dashed ${DIVIDER}`, fontSize: S.tiny, color: MUTED }}>
                        Net debit <span style={{ color: WHITE }}>{fmtCurrency(Math.abs(mixedNetDebit))}</span>
                        <span className="ml-2">({fmtCurrency(Math.abs(estimatedCost ?? 0))} shares + {fmtCurrency(Math.abs(mixedNetDebit - (estimatedCost ?? 0)))} options)</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ADVANCED SETTINGS — matching StrategyBuilder */}
            {isMultiLeg ? (
              <>
                <button
                  className="w-full flex items-center justify-between px-2 py-1 text-[11px]"
                  onClick={() => setAdvancedOpen(v => !v)}
                  style={{ color: TEXT, borderRadius: 6, background: "none", border: "none", cursor: "pointer" }}
                >
                  <span className="flex items-center gap-1">
                    {advancedOpen ? <ChevronUp className="w-2.5 h-2.5" style={{ color: MUTED }} /> : <ChevronDown className="w-2.5 h-2.5" style={{ color: MUTED }} />}
                    Advanced settings
                  </span>
                </button>
                {advancedOpen && (
                  <div className="grid grid-cols-3 gap-1">
                    <div className="px-2 py-1" style={{ background: FIELD, border: `1px solid ${BORDER}`, borderRadius: 7 }}>
                      <span className="text-[10px] block" style={{ color: MUTED }}>Exchange</span>
                      <span className="text-[12px]" style={{ color: WHITE }}>BEST</span>
                    </div>
                    <div className="px-2 py-1" style={{ background: FIELD, border: `1px solid ${BORDER}`, borderRadius: 7 }}>
                      <span className="text-[10px] block" style={{ color: MUTED }}>Duration</span>
                      <span className="text-[12px]" style={{ color: WHITE }}>{DURATIONS.find(d => d.value === duration)?.label ?? "DAY"}</span>
                    </div>
                    <div className="px-2 py-1 flex items-center justify-between" style={{ background: FIELD, border: `1px solid ${BORDER}`, borderRadius: 7 }}>
                      <div>
                        <span className="text-[10px] block" style={{ color: MUTED }}>Extended Hours</span>
                        <span className="text-[12px]" style={{ color: extendedHours ? GOLD : WHITE }}>{extendedHours ? "On" : "Off"}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setExtendedHours(!extendedHours); }}
                        className="relative w-7 h-3.5 rounded-full transition-colors duration-200"
                        style={{ background: extendedHours ? GOLD : BORDER, border: "none" }}
                      >
                        <div className="absolute top-0.5 w-2.5 h-2.5 rounded-full transition-transform duration-200" style={{ background: extendedHours ? BG : DIM, transform: extendedHours ? "translateX(14px)" : "translateX(2px)" }} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  className="w-full flex items-center justify-between px-3 py-1"
                  onClick={() => setAdvancedOpen(v => !v)}
                  style={{ color: TEXT, borderRadius: 8, fontSize: 14 }}
                >
                  <span className="flex items-center gap-1.5">
                    {advancedOpen ? <ChevronUp className="w-3 h-3" style={{ color: MUTED }} /> : <ChevronDown className="w-3 h-3" style={{ color: MUTED }} />}
                    Advanced settings
                  </span>
                </button>
                {advancedOpen && (
                  <div className="space-y-0 px-1">
                    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                      <span style={{ fontSize: 13, color: TEXT }}>Effect</span>
                      <button onClick={() => setPosEffect(posEffect === "OPENING" ? "CLOSING" : posEffect === "CLOSING" ? "AUTO" : "OPENING")} style={{ fontSize: 13, color: WHITE, background: "none", border: "none", padding: 0 }}>
                        {posEffect === "AUTO" ? "Auto" : posEffect === "OPENING" ? "To Open" : "To Close"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                      <span style={{ fontSize: 13, color: TEXT }}>Instruction</span>
                      <button onClick={() => setInstruction(instruction === "NONE" ? "ALL_OR_NONE" : instruction === "ALL_OR_NONE" ? "DO_NOT_REDUCE" : "NONE")} style={{ fontSize: 13, color: WHITE, background: "none", border: "none", padding: 0 }}>
                        {instruction === "NONE" ? "None" : instruction === "ALL_OR_NONE" ? "AON" : "DNR"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                      <span style={{ fontSize: 13, color: TEXT }}>Exchange</span>
                      <button onClick={() => setExchange(exchange === "BEST" ? "NYSE" : exchange === "NYSE" ? "NASDAQ" : exchange === "NASDAQ" ? "ARCA" : exchange === "ARCA" ? "BATS" : "BEST")} style={{ fontSize: 13, color: WHITE, background: "none", border: "none", padding: 0 }}>
                        {exchange}
                      </button>
                    </div>
                    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
                      <span style={{ fontSize: 13, color: TEXT }}>Tax Lot Method</span>
                      <button onClick={() => setTaxLotMethod(taxLotMethod === "DEFAULT" ? "FIFO" : taxLotMethod === "FIFO" ? "LIFO" : taxLotMethod === "LIFO" ? "HIGH_COST" : taxLotMethod === "HIGH_COST" ? "LOW_COST" : taxLotMethod === "LOW_COST" ? "SPEC_ID" : "DEFAULT")} style={{ fontSize: 13, color: WHITE, background: "none", border: "none", padding: 0 }}>
                        {taxLotMethod === "DEFAULT" ? "Default" : taxLotMethod === "SPEC_ID" ? "Spec ID" : taxLotMethod.replace("_", " ")}
                      </button>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <span style={{ fontSize: 13, color: TEXT }}>Ext Hours</span>
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
              </>
            )}

            {/* RISK OVERVIEW — separate collapsible section (independent of Advanced Settings) */}
            {isMultiLeg && strategyLegs ? (
              <div style={{ background: `linear-gradient(145deg, #14161a, #080a0f)`, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                <button
                  type="button"
                  onClick={() => setRiskCollapsed(v => !v)}
                  className="flex w-full items-center justify-between text-[13px]"
                  style={{ color: TEXT, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <span className="uppercase tracking-[0.06em]">Risk overview</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: MUTED }}>
                      {(() => {
                        const netP = parseFloat(limitPrice) || strategyNetPrice || 0;
                        const econ = computeStrategyEconomics({ legs: strategyLegs, netPrice: netP, quantity, isCredit: strategyIsCredit });
                        const mr = econ.maxRisk;
                        const popLeg = strategyIsCredit
                          ? strategyLegs.find(l => l.instruction.startsWith("SELL"))
                          : strategyLegs.find(l => l.instruction.startsWith("BUY"));
                        const popPct = (popLeg?.delta != null)
                          ? Math.round((strategyIsCredit ? (1 - Math.abs(popLeg.delta)) : Math.abs(popLeg.delta)) * 100)
                          : null;
                        return `Loss ${fmtCurrency(mr)} · POP ${popPct != null ? `${popPct}%` : "—"} · Margin ${fmtCurrency(mr)}`;
                      })()}
                    </span>
                    {preTradeEnabled && riskChecks.length > 0 && (
                      <span className="text-[10px] px-1.5 py-px" style={{
                        borderRadius: 10,
                        border: `1px solid ${overallRisk === "GREEN" ? `${UP}66` : overallRisk === "YELLOW" ? `${GOLD}66` : `${DOWN}80`}`,
                        color: levelColor(overallRisk),
                        background: overallRisk === "GREEN" ? `${UP}0a` : overallRisk === "YELLOW" ? `${GOLD}0a` : `${DOWN}0a`,
                      }}>
                        {overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}
                      </span>
                    )}
                    <span className="text-[10px]" style={{ color: MUTED }}>{riskCollapsed ? "▾" : "▴"}</span>
                  </div>
                </button>

                {!riskCollapsed && (
                  <div className="mt-1.5 space-y-1.5">
                    {(() => {
                      const netP = parseFloat(limitPrice) || strategyNetPrice || 0;
                      const stks = strategyLegs.map(l => l.strike).sort((a, b) => a - b);
                      const w = stks.length >= 2 ? stks[stks.length - 1] - stks[0] : 0;
                      const econ = computeStrategyEconomics({ legs: strategyLegs, netPrice: netP, quantity, isCredit: strategyIsCredit });
                      const mr = econ.maxRisk;
                      const maxProfit = econ.maxProfit;
                      const bePrice = econ.breakevens[0] ?? (strategyIsCredit
                        ? (strategyLegs[0]?.optionType === "PUT" ? stks[stks.length - 1] - netP : stks[0] + netP)
                        : (strategyLegs[0]?.optionType === "CALL" ? stks[0] + netP : stks[stks.length - 1] - netP));

                      const lo = stks[0] - w * 0.8;
                      const hi = stks[stks.length - 1] + w * 0.8;
                      const range = hi - lo || 1;
                      const steps = 60;
                      const pnlAtPrice = (price: number) => {
                        let pnl = 0;
                        for (const leg of strategyLegs) {
                          const isBuy = leg.instruction.startsWith("BUY");
                          const mid = (leg.bid != null && leg.ask != null) ? (leg.bid + leg.ask) / 2 : 0;
                          const intrinsic = leg.optionType === "CALL"
                            ? Math.max(0, price - leg.strike)
                            : Math.max(0, leg.strike - price);
                          const legPnl = (intrinsic - mid) * leg.quantity * 100;
                          pnl += isBuy ? legPnl : -legPnl;
                        }
                        return pnl;
                      };
                      const pts: { x: number; y: number }[] = [];
                      for (let i = 0; i <= steps; i++) {
                        const price = lo + (range * i) / steps;
                        pts.push({ x: price, y: pnlAtPrice(price) });
                      }
                      const minY = Math.min(...pts.map(p => p.y));
                      const maxY = Math.max(...pts.map(p => p.y));
                      const yRange = maxY - minY || 1;
                      const toSvgX = (price: number) => ((price - lo) / range) * 100;
                      const toSvgY = (pnl: number) => 100 - ((pnl - minY) / yRange) * 100;
                      const zeroY = toSvgY(0);
                      const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toSvgX(p.x).toFixed(2)},${toSvgY(p.y).toFixed(2)}`).join(" ");

                      return (
                        <>
                          <div className="relative h-20 overflow-hidden" style={{ borderRadius: 8, border: `1px dashed ${BORDER}`, background: `linear-gradient(to bottom, #1d222e, #090b10)` }}>
                            <div className="absolute inset-1.5" style={{ borderBottom: `1px solid ${TEXT}60`, borderLeft: `1px solid ${TEXT}60` }} />
                            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-1.5" style={{ width: "calc(100% - 12px)", height: "calc(100% - 12px)" }}>
                              <defs>
                                <clipPath id="otAbove"><rect x="0" y="0" width="100" height={zeroY} /></clipPath>
                                <clipPath id="otBelow"><rect x="0" y={zeroY} width="100" height={100 - zeroY} /></clipPath>
                              </defs>
                              <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke={TEXT} strokeWidth="0.3" strokeDasharray="2,2" />
                              <path d={pathD} fill="none" stroke={UP} strokeWidth="1" clipPath="url(#otAbove)" />
                              <path d={pathD} fill="none" stroke={DOWN} strokeWidth="1" clipPath="url(#otBelow)" />
                              <path d={`${pathD} L100,${zeroY} L0,${zeroY} Z`} fill={`${UP}18`} clipPath="url(#otAbove)" />
                              <path d={`${pathD} L100,${zeroY} L0,${zeroY} Z`} fill={`${DOWN}18`} clipPath="url(#otBelow)" />
                            </svg>
                            <span className="absolute bottom-1 right-2 text-[9px]" style={{ color: MUTED }}>P/L at exp</span>
                          </div>

                          <div className="text-[11px]" style={{ color: TEXT }}>
                            Max profit if price stays between strikes. Risk: {fmtCurrency(mr > 0 ? mr : 0)}. Breakeven: {fmtCurrency(bePrice)}.
                          </div>

                          {preTradeEnabled && riskChecks.length > 0 && (
                            <div className="space-y-0.5">
                              {riskChecks.map((rc, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-[11px]">
                                  <span style={{ color: levelColor(rc.level) }}>●</span>
                                  <div>
                                    <span style={{ color: WHITE, fontWeight: 500 }}>{rc.label}</span>{" "}
                                    <span style={{ color: TEXT }}>{rc.detail}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between px-2 py-1.5" style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-1">
                  <span className="uppercase tracking-[0.06em]" style={{ fontSize: 11, color: TEXT }}>Risk overview</span>
                </div>
                {preTradeEnabled && riskChecks.length > 0 && (
                  <span className="px-1.5 py-0.5" style={{
                    fontSize: 10,
                    borderRadius: 16, border: `1px solid ${overallRisk === "GREEN" ? `${UP}66` : overallRisk === "YELLOW" ? `${GOLD}66` : `${DOWN}80`}`,
                    color: levelColor(overallRisk),
                    background: overallRisk === "GREEN" ? `${UP}0a` : overallRisk === "YELLOW" ? `${GOLD}0a` : `${DOWN}0a`,
                  }}>
                    {overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}
                  </span>
                )}
              </div>
            )}

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
          <p style={{ fontSize: 16, color: WHITE }}>Sent to Schwab</p>
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

      {/* CTA BAR — matching StrategyBuilder format for multi-leg */}
      {stage === "form" && (
        <div className="shrink-0 px-3 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 20px), 20px)", background: BG, borderTop: `1px solid ${BORDER}`, zIndex: 215 }}>
          {isMultiLeg && strategyLegs ? (
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[12px]" style={{ color: TEXT }}>
              <span>{quantity} spread{quantity !== 1 ? "s" : ""} · {strategyIsCredit ? "Credit" : "Cost"} {estimatedCost != null ? fmtCurrency(Math.abs(estimatedCost)) : "—"}</span>
              <span>Risk {(() => {
                const netP = parseFloat(limitPrice) || strategyNetPrice || 0;
                const econ = computeStrategyEconomics({ legs: strategyLegs, netPrice: netP, quantity, isCredit: strategyIsCredit });
                return fmtCurrency(econ.maxRisk);
              })()}</span>
              <span>POP {(() => {
                const popLeg = strategyIsCredit
                  ? strategyLegs.find(l => l.instruction.startsWith("SELL"))
                  : strategyLegs.find(l => l.instruction.startsWith("BUY"));
                const popPct = (popLeg?.delta != null)
                  ? Math.round((strategyIsCredit ? (1 - Math.abs(popLeg.delta)) : Math.abs(popLeg.delta)) * 100)
                  : null;
                return popPct != null ? `${popPct}%` : "—";
              })()}</span>
              {preTradeEnabled && <span style={{ color: levelColor(overallRisk) }}>{overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}</span>}
            </div>
          ) : (
            <div className="flex justify-between flex-wrap gap-1 mb-1" style={{ fontSize: S.label, color: TEXT }}>
              <span>{isBuy ? "Buy" : "Sell"} {quantity} {isOption ? "contract" : "share"}{quantity > 1 ? "s" : ""} · {needsLimit ? `Limit ${limitPrice || "—"}` : ORDER_TYPES.find(t => t.value === orderType)?.label}</span>
              {estimatedCost != null && <span>Notional {fmtCurrency(Math.abs(estimatedCost))}</span>}
              {preTradeEnabled && <span>Risk: {overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}</span>}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="tracking-[0.04em] transition-all duration-150 active:scale-[0.98]"
              style={{
                flex: 1,
                fontSize: 15,
                height: isMultiLeg ? 42 : 48,
                borderRadius: 999,
                background: "transparent",
                color: TEXT,
                border: `1px solid ${BORDER}`,
                fontFamily: SYS_FONT,
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (sendMode === "strategist") void handleSendToStrategist();
                else setStage("review");
              }}
              disabled={sendMode === "strategist" && strategistDispatchInFlight}
              className="tracking-[0.04em] transition-all duration-150 active:scale-[0.98] disabled:opacity-60"
              style={{
                flex: 2,
                fontSize: isMultiLeg ? 16 : 17,
                height: isMultiLeg ? 42 : 48,
                borderRadius: 999,
                border: "none",
                background: sendMode === "strategist"
                  ? "linear-gradient(135deg, #5ad1c0, #3aa899)"
                  : CTA_GRAD,
                color: BG,
                fontWeight: 600,
                fontFamily: SYS_FONT,
              }}
            >
              {sendMode === "strategist"
                ? (strategistDispatchInFlight ? "Sending…" : "Send to Strategist")
                : "Review"}
            </button>
          </div>
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
              <h3 style={{ fontSize: 16, color: WHITE }}>Order Confirmation</h3>
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
              {(() => {
                const totalContracts = isOption
                  ? (isMultiLeg && strategyLegs
                      ? strategyLegs.reduce((sum, l) => sum + l.quantity, 0) * quantity
                      : quantity)
                  : 0;
                const commissionPerContract = 0.65;
                const totalCommission = totalContracts * commissionPerContract;
                const netPrice = parseFloat(limitPrice) || strategyNetPrice || 0;
                const grossCost = estimatedCost != null ? Math.abs(estimatedCost) : 0;
                const totalCost = grossCost + totalCommission;
                const econMulti = isMultiLeg && strategyLegs
                  ? computeStrategyEconomics({ legs: strategyLegs, netPrice, quantity, isCredit: strategyIsCredit })
                  : null;
                const bpEffect = econMulti
                  ? -(econMulti.maxRisk + totalCommission)
                  : (side === "BUY" ? -(grossCost + totalCommission) : grossCost - totalCommission);
                const breakevens: number[] = econMulti ? econMulti.breakevens : [];
                let maxProfit: number | null = null;
                let maxLoss: number | null = null;
                if (econMulti && strategyLegs) {
                  const strikes = strategyLegs.map(l => l.strike).sort((a, b) => a - b);
                  const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : 0;
                  if (econMulti.isIronCondor || width > 0) {
                    maxProfit = econMulti.maxProfit;
                    maxLoss = econMulti.maxRisk;
                  } else {
                    maxProfit = strategyIsCredit ? netPrice * 100 * quantity : null;
                    maxLoss = strategyIsCredit ? null : netPrice * 100 * quantity;
                  }
                }
                return (
                  <>
                    <div className="pt-1 mt-1 space-y-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                      <div className="flex justify-between" style={{ fontSize: S.body }}>
                        <span style={{ color: MUTED }}>Net {strategyIsCredit ? "credit" : "debit"}</span>
                        <span style={{ color: WHITE }}>{fmtCurrency(grossCost)}</span>
                      </div>
                      {totalContracts > 0 && (
                        <div className="flex justify-between" style={{ fontSize: S.body }}>
                          <span style={{ color: MUTED }}>Commissions ({totalContracts} × $0.65)</span>
                          <span style={{ color: WHITE }}>{fmtCurrency(totalCommission)}</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1" style={{ fontSize: S.body, borderTop: `1px dashed ${DIVIDER}` }}>
                        <span style={{ color: TEXT, fontWeight: 500 }}>Total {strategyIsCredit ? "credit" : "cost"}</span>
                        <span style={{ color: WHITE, fontWeight: 600, fontSize: S.price }}>
                          {fmtCurrency(strategyIsCredit ? grossCost - totalCommission : totalCost)}
                        </span>
                      </div>
                    </div>

                    {(breakevens.length > 0 || maxProfit != null || maxLoss != null) && (
                      <div className="pt-1 mt-1 space-y-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                        {breakevens.length > 0 && (
                          <div className="flex justify-between" style={{ fontSize: S.body }}>
                            <span style={{ color: MUTED }}>Breakeven{breakevens.length > 1 ? "s" : ""}</span>
                            <span style={{ color: WHITE }}>{breakevens.map(b => `$${b.toFixed(2)}`).join(" / ")}</span>
                          </div>
                        )}
                        {maxProfit != null && (
                          <div className="flex justify-between" style={{ fontSize: S.body }}>
                            <span style={{ color: MUTED }}>Max profit</span>
                            <span style={{ color: UP }}>{fmtCurrency(maxProfit)}</span>
                          </div>
                        )}
                        {maxLoss != null && (
                          <div className="flex justify-between" style={{ fontSize: S.body }}>
                            <span style={{ color: MUTED }}>Max loss</span>
                            <span style={{ color: DOWN }}>{fmtCurrency(maxLoss)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-1 mt-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                      <div className="flex justify-between" style={{ fontSize: S.body }}>
                        <span style={{ color: MUTED }}>Buying power effect</span>
                        <span style={{ color: bpEffect >= 0 ? UP : DOWN }}>
                          {bpEffect >= 0 ? "+" : "−"}{fmtCurrency(Math.abs(bpEffect))}
                        </span>
                      </div>
                    </div>
                  </>
                );
              })()}
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
                Send to Schwab
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
