import { useState, useMemo, useCallback, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  X, Plus, Trash2, ChevronDown, ChevronUp, Shield, ShieldCheck, ShieldAlert, ShieldX,
  ArrowLeft, Lock, Unlock, Minus, Sparkles, AlertTriangle, CheckCircle2, Loader2,
} from "lucide-react";

const GOLD = "#f5a623";
const UP = "#2ecc71";
const DOWN = "#ff4b5c";
const BG = "#050607";
const CARD = "#101215";
const CARD_SOFT = "#14161a";
const BORDER = "#23262c";
const BORDER2 = "#23262c";
const MUTED = "#6b7184";
const DIM = "#6b7184";
const TEXT = "#9ba1b5";
const WHITE = "#f7f8fa";
const FIELD = "rgba(10,12,16,0.95)";
const GOLD_DIM = "rgba(245,166,35,0.08)";
const DIVIDER = "#1c1f26";
const R_CARD = 14;
const CARD_GRAD = "linear-gradient(145deg, #111319, #080a0f)";
const CTA_GRAD = "linear-gradient(135deg, #f5a623, #ffce73)";
const SYS_FONT = "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif";
const MONO = SYS_FONT;

type OptionType = "CALL" | "PUT";
type LegDirection = "BUY_TO_OPEN" | "SELL_TO_OPEN" | "BUY_TO_CLOSE" | "SELL_TO_CLOSE";
type RiskLevel = "GREEN" | "YELLOW" | "RED";
type Stage = "form" | "review" | "submitting" | "success" | "error";

export interface StrategyLeg {
  id: string;
  optionType: OptionType;
  direction: LegDirection;
  strike: number;
  expiration: string;
  quantity: number;
  bid?: number;
  ask?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  schwabSymbol: string;
}

interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  buildLegs: (atmStrike: number, strikeWidth: number, expiration: string) => Omit<StrategyLeg, "id" | "bid" | "ask" | "delta" | "gamma" | "theta" | "vega" | "iv" | "schwabSymbol">[];
}

const STRATEGIES: StrategyTemplate[] = [
  {
    id: "bull_call", name: "Bull Call Spread", description: "Buy lower call, sell higher call", color: UP,
    buildLegs: (atm, w, exp) => [
      { optionType: "CALL", direction: "BUY_TO_OPEN", strike: atm, expiration: exp, quantity: 1 },
      { optionType: "CALL", direction: "SELL_TO_OPEN", strike: atm + w, expiration: exp, quantity: 1 },
    ],
  },
  {
    id: "bear_put", name: "Bear Put Spread", description: "Buy higher put, sell lower put", color: DOWN,
    buildLegs: (atm, w, exp) => [
      { optionType: "PUT", direction: "BUY_TO_OPEN", strike: atm, expiration: exp, quantity: 1 },
      { optionType: "PUT", direction: "SELL_TO_OPEN", strike: atm - w, expiration: exp, quantity: 1 },
    ],
  },
  {
    id: "iron_condor", name: "Iron Condor", description: "Sell put spread + sell call spread", color: GOLD,
    buildLegs: (atm, w, exp) => [
      { optionType: "PUT", direction: "BUY_TO_OPEN", strike: atm - w * 2, expiration: exp, quantity: 1 },
      { optionType: "PUT", direction: "SELL_TO_OPEN", strike: atm - w, expiration: exp, quantity: 1 },
      { optionType: "CALL", direction: "SELL_TO_OPEN", strike: atm + w, expiration: exp, quantity: 1 },
      { optionType: "CALL", direction: "BUY_TO_OPEN", strike: atm + w * 2, expiration: exp, quantity: 1 },
    ],
  },
  {
    id: "straddle", name: "Straddle", description: "Buy ATM call + ATM put", color: "#a78bfa",
    buildLegs: (atm, _w, exp) => [
      { optionType: "CALL", direction: "BUY_TO_OPEN", strike: atm, expiration: exp, quantity: 1 },
      { optionType: "PUT", direction: "BUY_TO_OPEN", strike: atm, expiration: exp, quantity: 1 },
    ],
  },
  {
    id: "strangle", name: "Strangle", description: "Buy OTM call + OTM put", color: "#22d3ee",
    buildLegs: (atm, w, exp) => [
      { optionType: "CALL", direction: "BUY_TO_OPEN", strike: atm + w, expiration: exp, quantity: 1 },
      { optionType: "PUT", direction: "BUY_TO_OPEN", strike: atm - w, expiration: exp, quantity: 1 },
    ],
  },
  {
    id: "butterfly", name: "Butterfly", description: "Buy 1 lower, sell 2 middle, buy 1 upper", color: "#f472b6",
    buildLegs: (atm, w, exp) => [
      { optionType: "CALL", direction: "BUY_TO_OPEN", strike: atm - w, expiration: exp, quantity: 1 },
      { optionType: "CALL", direction: "SELL_TO_OPEN", strike: atm, expiration: exp, quantity: 2 },
      { optionType: "CALL", direction: "BUY_TO_OPEN", strike: atm + w, expiration: exp, quantity: 1 },
    ],
  },
  {
    id: "calendar", name: "Calendar Spread", description: "Sell near-term, buy far-term same strike", color: "#fb923c",
    buildLegs: (atm, _w, exp) => [
      { optionType: "CALL", direction: "SELL_TO_OPEN", strike: atm, expiration: exp, quantity: 1 },
      { optionType: "CALL", direction: "BUY_TO_OPEN", strike: atm, expiration: exp, quantity: 1 },
    ],
  },
];

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

let legIdCounter = 0;
function nextLegId() { return `leg_${++legIdCounter}_${Date.now()}`; }

interface StrategyIdentity {
  name: string;
  color: string;
  warning?: string;
}

function detectStrategyType(legs: StrategyLeg[], netDebit: number): StrategyIdentity {
  if (legs.length === 0) return { name: "No Legs", color: MUTED };

  const calls = legs.filter(l => l.optionType === "CALL");
  const puts = legs.filter(l => l.optionType === "PUT");
  const buys = legs.filter(l => l.direction.startsWith("BUY"));
  const sells = legs.filter(l => l.direction.startsWith("SELL"));
  const buyC = calls.filter(l => l.direction.startsWith("BUY"));
  const sellC = calls.filter(l => l.direction.startsWith("SELL"));
  const buyP = puts.filter(l => l.direction.startsWith("BUY"));
  const sellP = puts.filter(l => l.direction.startsWith("SELL"));
  const expirations = [...new Set(legs.map(l => l.expiration.split(":")[0].trim()))];
  const sameExp = expirations.length === 1;
  const strikes = [...new Set(legs.map(l => l.strike))];

  if (legs.length === 1) {
    const leg = legs[0];
    const isBuy = leg.direction.startsWith("BUY");
    if (isBuy && leg.optionType === "CALL") return { name: "Long Call", color: UP };
    if (isBuy && leg.optionType === "PUT") return { name: "Long Put", color: DOWN };
    if (!isBuy && leg.optionType === "CALL") return { name: "Naked Short Call", color: DOWN, warning: "WARNING: This is a naked short position with undefined risk. Max loss is theoretically unlimited. Consider adding a protective leg to define your risk." };
    if (!isBuy && leg.optionType === "PUT") return { name: "Naked Short Put", color: DOWN, warning: "WARNING: This is a naked short position with substantial risk. Consider adding a protective leg to define your risk." };
  }

  if (legs.length === 2 && sameExp) {
    if (puts.length === 2 && calls.length === 0 && sellP.length === 1 && buyP.length === 1) {
      const shortStrike = sellP[0].strike;
      const longStrike = buyP[0].strike;
      if (shortStrike > longStrike) return { name: "Bull Put Spread", color: UP };
      if (shortStrike < longStrike) return { name: "Bear Put Spread", color: DOWN };
    }

    if (calls.length === 2 && puts.length === 0 && sellC.length === 1 && buyC.length === 1) {
      const shortStrike = sellC[0].strike;
      const longStrike = buyC[0].strike;
      if (shortStrike > longStrike) return { name: "Bull Call Spread", color: UP };
      if (shortStrike < longStrike) return { name: "Bear Call Spread", color: DOWN };
    }

    if (buys.length === 2 && sells.length === 0 && calls.length === 1 && puts.length === 1 && strikes.length === 1) {
      return { name: "Straddle", color: "#a78bfa" };
    }
    if (buys.length === 2 && sells.length === 0 && calls.length === 1 && puts.length === 1) {
      return { name: "Strangle", color: "#22d3ee" };
    }
  }

  if (legs.length === 2 && !sameExp && calls.length + puts.length === 2) {
    const sameType = (calls.length === 2 || puts.length === 2);
    if (sameType && strikes.length === 1) return { name: "Calendar Spread", color: "#fb923c" };
    if (sameType && strikes.length === 2) return { name: "Diagonal Spread", color: "#fb923c" };
  }

  if (legs.length === 4 && sameExp && buyP.length === 1 && sellP.length === 1 && buyC.length === 1 && sellC.length === 1) {
    const putStrikes = [sellP[0].strike, buyP[0].strike].sort((a, b) => a - b);
    const callStrikes = [sellC[0].strike, buyC[0].strike].sort((a, b) => a - b);
    if (sellP[0].strike === sellC[0].strike && buyP[0].strike === buyC[0].strike) {
      return { name: "Iron Butterfly", color: GOLD };
    }
    if (putStrikes[1] <= callStrikes[0]) {
      return { name: "Iron Condor", color: GOLD };
    }
  }

  if (legs.length === 3 && sameExp) {
    const strikeCounts: Record<number, number> = {};
    for (const l of legs) strikeCounts[l.strike] = (strikeCounts[l.strike] || 0) + 1;
    const hasDouble = Object.values(strikeCounts).some(c => c >= 2);
    if (hasDouble) return { name: "Butterfly", color: "#f472b6" };
  }

  if (sells.length > 0 && buys.length === 0) {
    return { name: "Naked Position", color: DOWN, warning: "WARNING: This is a naked short position with undefined risk. Max loss is theoretically unlimited for calls and substantial for puts. Consider adding a protective leg to define your risk." };
  }

  const creditOrDebit = netDebit < 0 ? "Credit" : "Debit";
  return { name: `Custom ${legs.length}-Leg (${creditOrDebit})`, color: TEXT };
}

function computeStrategyMetrics(legs: StrategyLeg[]) {
  let netDebit = 0;
  let totalDelta = 0, totalGamma = 0, totalTheta = 0, totalVega = 0;
  let hasPrices = true;

  for (const leg of legs) {
    const isBuy = leg.direction.startsWith("BUY");
    const mid = (leg.bid != null && leg.ask != null) ? (leg.bid + leg.ask) / 2 : null;
    if (mid == null) { hasPrices = false; continue; }
    const cost = mid * leg.quantity * 100;
    netDebit += isBuy ? cost : -cost;
    const sign = isBuy ? 1 : -1;
    if (leg.delta != null) totalDelta += leg.delta * leg.quantity * sign;
    if (leg.gamma != null) totalGamma += leg.gamma * leg.quantity * sign;
    if (leg.theta != null) totalTheta += leg.theta * leg.quantity * sign;
    if (leg.vega != null) totalVega += leg.vega * leg.quantity * sign;
  }

  const calls = legs.filter(l => l.optionType === "CALL");
  const puts = legs.filter(l => l.optionType === "PUT");
  const longCalls = calls.filter(l => l.direction.startsWith("BUY"));
  const shortCalls = calls.filter(l => l.direction.startsWith("SELL"));
  const longPuts = puts.filter(l => l.direction.startsWith("BUY"));
  const shortPuts = puts.filter(l => l.direction.startsWith("SELL"));

  let maxRisk: number | null = null;
  let maxReward: number | null = null;
  let breakevens: number[] = [];
  const isDebit = netDebit > 0;

  if (longCalls.length === 1 && shortCalls.length === 1 && puts.length === 0) {
    const width = Math.abs(shortCalls[0].strike - longCalls[0].strike) * 100;
    if (isDebit) {
      maxRisk = netDebit; maxReward = width - netDebit;
      breakevens = [longCalls[0].strike + netDebit / 100];
    } else {
      maxRisk = width + netDebit; maxReward = -netDebit;
      breakevens = [shortCalls[0].strike + netDebit / 100];
    }
  } else if (longPuts.length === 1 && shortPuts.length === 1 && calls.length === 0) {
    const width = Math.abs(longPuts[0].strike - shortPuts[0].strike) * 100;
    if (isDebit) {
      maxRisk = netDebit; maxReward = width - netDebit;
      breakevens = [longPuts[0].strike - netDebit / 100];
    } else {
      maxRisk = width + netDebit; maxReward = -netDebit;
      breakevens = [shortPuts[0].strike - netDebit / 100];
    }
  } else if (longCalls.length === 1 && longPuts.length === 1 && shortCalls.length === 0 && shortPuts.length === 0) {
    maxRisk = netDebit; maxReward = null;
    if (hasPrices) {
      const cost100 = netDebit / 100;
      breakevens = [longCalls[0].strike + cost100, longPuts[0].strike - cost100];
    }
  } else if (longPuts.length === 1 && shortPuts.length === 1 && longCalls.length === 1 && shortCalls.length === 1) {
    const putWidth = Math.abs(shortPuts[0].strike - longPuts[0].strike) * 100;
    const callWidth = Math.abs(longCalls[0].strike - shortCalls[0].strike) * 100;
    const credit = -netDebit;
    maxReward = credit > 0 ? credit : null;
    maxRisk = Math.max(putWidth, callWidth) - credit;
    breakevens = [shortPuts[0].strike - credit / 100, shortCalls[0].strike + credit / 100];
  } else {
    if (isDebit) maxRisk = netDebit;
  }

  const riskReward = (maxRisk != null && maxReward != null && maxRisk > 0) ? maxReward / maxRisk : null;
  const pop = totalDelta !== 0 ? Math.abs(1 - Math.abs(totalDelta)) * 100 : null;

  return {
    netDebit, isDebit, maxRisk, maxReward,
    breakevens: breakevens.filter(b => !isNaN(b)),
    totalDelta, totalGamma, totalTheta, totalVega,
    riskReward, pop, hasPrices,
  };
}

interface RiskCheck {
  id: string;
  label: string;
  level: RiskLevel;
  detail: string;
}

function runStrategyRiskChecks(params: {
  legs: StrategyLeg[];
  maxRisk: number | null;
  netDebit: number;
  riskReward: number | null;
  regime: string | null;
  sessionBias: string | null;
  accountSize: number;
  preTradeMaxPositionPct: number;
  preTradeMinRR: number;
  totalDelta: number;
}): RiskCheck[] {
  const { legs, maxRisk, netDebit, riskReward, regime, sessionBias, accountSize, preTradeMaxPositionPct, preTradeMinRR, totalDelta } = params;
  const checks: RiskCheck[] = [];

  const isBullish = totalDelta > 0;
  const biasMatch = sessionBias === "BULLISH" ? isBullish : sessionBias === "BEARISH" ? !isBullish : null;
  if (regime && sessionBias) {
    if (regime === "NO_READ" || sessionBias === "NO_EDGE") {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "YELLOW", detail: `${regime} / ${sessionBias}` });
    } else if (biasMatch === true) {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "GREEN", detail: `Strategy aligns with ${sessionBias} bias` });
    } else if (biasMatch === false) {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "RED", detail: `Strategy opposes ${sessionBias} bias` });
    } else {
      checks.push({ id: "pulse", label: "Pulse Alignment", level: "YELLOW", detail: "Neutral bias — no directional edge" });
    }
  } else {
    checks.push({ id: "pulse", label: "Pulse Alignment", level: "YELLOW", detail: "No Market Pulse data" });
  }

  if (riskReward != null) {
    if (riskReward >= preTradeMinRR) {
      checks.push({ id: "rr", label: "Risk/Reward", level: "GREEN", detail: `${riskReward.toFixed(1)}:1 >= ${preTradeMinRR}:1` });
    } else {
      checks.push({ id: "rr", label: "Risk/Reward", level: "YELLOW", detail: `${riskReward.toFixed(1)}:1 < ${preTradeMinRR}:1` });
    }
  } else {
    checks.push({ id: "rr", label: "Risk/Reward", level: "YELLOW", detail: "Cannot calculate R:R" });
  }

  let hasWideSpreads = false;
  for (const leg of legs) {
    if (leg.bid != null && leg.ask != null && leg.bid > 0) {
      const pct = ((leg.ask - leg.bid) / leg.bid) * 100;
      if (pct > 15) { hasWideSpreads = true; break; }
    }
  }
  checks.push(hasWideSpreads
    ? { id: "liq", label: "Liquidity", level: "RED", detail: "One or more legs have wide spreads" }
    : { id: "liq", label: "Liquidity", level: "GREEN", detail: "All legs have acceptable spreads" });

  const risk = maxRisk ?? Math.abs(netDebit);
  const maxAllowed = accountSize * (preTradeMaxPositionPct / 100);
  if (risk > 0 && maxAllowed > 0) {
    if (risk <= maxAllowed) {
      checks.push({ id: "size", label: "Position Size", level: "GREEN", detail: `${fmtCurrency(risk)} <= ${fmtCurrency(maxAllowed)} max` });
    } else if (risk <= maxAllowed * 1.5) {
      checks.push({ id: "size", label: "Position Size", level: "YELLOW", detail: `${fmtCurrency(risk)} near ${fmtCurrency(maxAllowed)} max` });
    } else {
      checks.push({ id: "size", label: "Position Size", level: "RED", detail: `${fmtCurrency(risk)} > ${fmtCurrency(maxAllowed)} max` });
    }
  } else {
    checks.push({ id: "size", label: "Position Size", level: "YELLOW", detail: "Enter prices for size check" });
  }

  const hasIV = legs.some(l => l.iv != null);
  if (hasIV) {
    const rawAvgIV = legs.reduce((s, l) => s + (l.iv ?? 0), 0) / legs.length;
    const avgIVPct = rawAvgIV > 5 ? rawAvgIV : rawAvgIV * 100;
    const ivDisplay = `${avgIVPct.toFixed(2)}%`;
    const ivWarning = avgIVPct > 500 ? " — unusually high, verify data" : "";
    const selling = legs.filter(l => l.direction.startsWith("SELL")).length >= legs.filter(l => l.direction.startsWith("BUY")).length;
    const isHighIV = rawAvgIV > 5 ? rawAvgIV > 50 : rawAvgIV > 0.5;
    if (isHighIV && selling) {
      checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: `Avg IV ${ivDisplay} — selling premium${ivWarning}` });
    } else if (isHighIV && !selling) {
      checks.push({ id: "vol", label: "Vol Environment", level: "YELLOW", detail: `Avg IV ${ivDisplay} — buying expensive${ivWarning}` });
    } else {
      checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: `Avg IV ${ivDisplay}${ivWarning}` });
    }
  } else {
    checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: "No IV data" });
  }

  const parseDTE = (exp: string): number | null => {
    const clean = exp.split(":")[0].trim();
    const parts = clean.split("-");
    let d: Date;
    if (parts.length === 3) {
      d = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
    } else {
      d = new Date(clean);
    }
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const expUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.max(0, Math.ceil((expUTC - todayUTC) / 86400000));
  };

  const dteValues = legs.map(l => parseDTE(l.expiration));
  const validDTEs = dteValues.filter((d): d is number => d !== null);
  const minDTE = validDTEs.length > 0 ? Math.min(...validDTEs) : null;

  if (minDTE === null) {
    checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "YELLOW", detail: "DTE unavailable" });
  } else if (minDTE < 3) {
    checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "RED", detail: `${minDTE} DTE — extreme gamma risk` });
  } else if (minDTE < 7) {
    checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "YELLOW", detail: `${minDTE} DTE — elevated gamma` });
  } else {
    checks.push({ id: "dte", label: "DTE / Gamma Risk", level: "GREEN", detail: `${minDTE} DTE — safe range` });
  }

  if (legs.length > 1) {
    const exps = new Set(legs.map(l => l.expiration));
    if (exps.size > 1) {
      checks.push({ id: "legs", label: "Leg Alignment", level: "YELLOW", detail: "Multiple expirations — calendar risk" });
    } else {
      checks.push({ id: "legs", label: "Leg Alignment", level: "GREEN", detail: `${legs.length} legs, same expiration` });
    }
  } else {
    checks.push({ id: "legs", label: "Leg Alignment", level: "GREEN", detail: "Single leg" });
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

function RiskIcon({ level }: { level: RiskLevel }) {
  if (level === "GREEN") return <ShieldCheck className="w-3.5 h-3.5" style={{ color: UP }} />;
  if (level === "YELLOW") return <ShieldAlert className="w-3.5 h-3.5" style={{ color: GOLD }} />;
  return <ShieldX className="w-3.5 h-3.5" style={{ color: DOWN }} />;
}

interface StrategyBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  initialLegs?: StrategyLeg[];
  availableStrikes?: number[];
  availableExpirations?: { label: string; value: string }[];
  chainData?: Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>;
}

export function StrategyBuilder({
  isOpen,
  onClose,
  onBack,
  initialLegs,
  availableStrikes = [],
  availableExpirations = [],
  chainData,
}: StrategyBuilderProps) {
  const symbol = useTerminalStore((s) => s.symbol);
  const { data: quote } = useQuote(symbol);
  const pulseData = useMarketPulseStore((s) => s.pulseData);
  const preTradeEnabled = useTerminalStore((s) => s.preTradeEnabled);
  const preTradeBlockOnRed = useTerminalStore((s) => s.preTradeBlockOnRed);
  const preTradeMinRR = useTerminalStore((s) => s.preTradeMinRR);
  const preTradeMaxPositionPct = useTerminalStore((s) => s.preTradeMaxPositionPct);
  const accountSize = useTerminalStore((s) => s.accountSize);

  const [legs, setLegs] = useState<StrategyLeg[]>([]);
  const [mode, setMode] = useState<"templates" | "builder">("templates");
  const [expandedLeg, setExpandedLeg] = useState<string | null>(null);
  const [riskCollapsed, setRiskCollapsed] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [limitPrice, setLimitPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [priceLocked, setPriceLocked] = useState(false);
  const [extendedHours, setExtendedHours] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [accountHash, setAccountHash] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [priceError, setPriceError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setExpandedLeg(null);
      setRiskCollapsed(false);
      setLimitPrice("");
      setQuantity(1);
      setPriceLocked(false);
      setExtendedHours(false);
      setStage("form");
      setOrderId(null);
      setErrorMsg("");
      setPriceError("");
      if (initialLegs && initialLegs.length > 0) {
        setLegs(initialLegs);
        setMode("builder");
      } else {
        setLegs([]);
        setMode("templates");
      }
    }
  }, [isOpen, initialLegs]);

  useEffect(() => {
    if (!isOpen) return;
    fetchWithAuth("/api/portfolio/account-hash")
      .then(r => r.json())
      .then(d => { if (d.hashValue) setAccountHash(d.hashValue); })
      .catch(() => {});
  }, [isOpen]);

  const lastPrice = quote?.last ?? 0;
  const defaultExp = availableExpirations.length > 0 ? availableExpirations[0].value : "";

  const atmStrike = useMemo(() => {
    if (availableStrikes.length === 0 || !lastPrice) return Math.round(lastPrice);
    let best = availableStrikes[0];
    for (const s of availableStrikes) {
      if (Math.abs(s - lastPrice) < Math.abs(best - lastPrice)) best = s;
    }
    return best;
  }, [availableStrikes, lastPrice]);

  const strikeWidth = useMemo(() => {
    if (availableStrikes.length < 2) return 5;
    const sorted = [...availableStrikes].sort((a, b) => a - b);
    const atmIdx = sorted.findIndex(s => s >= atmStrike);
    if (atmIdx > 0 && atmIdx < sorted.length) return sorted[atmIdx] - sorted[atmIdx - 1];
    return sorted[1] - sorted[0];
  }, [availableStrikes, atmStrike]);

  const buildSchwabSymbol = useCallback((strike: number, optionType: OptionType, expiration: string) => {
    const clean = expiration.split(":")[0].trim();
    const d = new Date(clean);
    if (isNaN(d.getTime())) return "";
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
    const sym = symbol.toUpperCase().padEnd(6, " ");
    return `${sym}${yy}${mm}${dd}${optionType === "CALL" ? "C" : "P"}${strikePadded}`;
  }, [symbol]);

  const enrichLeg = useCallback((leg: Omit<StrategyLeg, "id" | "bid" | "ask" | "delta" | "gamma" | "theta" | "vega" | "iv" | "schwabSymbol">): StrategyLeg => {
    const schwabSymbol = buildSchwabSymbol(leg.strike, leg.optionType, leg.expiration);
    const cd = chainData?.get(schwabSymbol);
    return { ...leg, id: nextLegId(), schwabSymbol, bid: cd?.bid, ask: cd?.ask, delta: cd?.delta, gamma: cd?.gamma, theta: cd?.theta, vega: cd?.vega, iv: cd?.iv };
  }, [buildSchwabSymbol, chainData]);

  const applyTemplate = useCallback((tmpl: StrategyTemplate) => {
    const rawLegs = tmpl.buildLegs(atmStrike, strikeWidth, defaultExp);
    setLegs(rawLegs.map(l => enrichLeg(l)));
    setMode("builder");
    setLimitPrice("");
  }, [atmStrike, strikeWidth, defaultExp, enrichLeg]);

  const addLeg = useCallback(() => {
    setLegs(prev => [...prev, enrichLeg({ optionType: "CALL", direction: "BUY_TO_OPEN", strike: atmStrike, expiration: defaultExp, quantity: 1 })]);
  }, [atmStrike, defaultExp, enrichLeg]);

  const removeLeg = useCallback((id: string) => {
    setLegs(prev => prev.filter(l => l.id !== id));
    setExpandedLeg(prev => prev === id ? null : prev);
  }, []);

  const updateLeg = useCallback((id: string, updates: Partial<StrategyLeg>) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...updates };
      if (updates.strike != null || updates.optionType != null || updates.expiration != null) {
        const schwabSymbol = buildSchwabSymbol(
          updates.strike ?? l.strike,
          updates.optionType ?? l.optionType,
          updates.expiration ?? l.expiration
        );
        const cd = chainData?.get(schwabSymbol);
        updated.schwabSymbol = schwabSymbol;
        updated.bid = cd?.bid; updated.ask = cd?.ask;
        updated.delta = cd?.delta; updated.gamma = cd?.gamma;
        updated.theta = cd?.theta; updated.vega = cd?.vega; updated.iv = cd?.iv;
      }
      return updated;
    }));
  }, [buildSchwabSymbol, chainData]);

  const metrics = useMemo(() => computeStrategyMetrics(legs), [legs]);
  const isCredit = metrics.netDebit < 0;
  const strategyId = useMemo(() => detectStrategyType(legs, metrics.netDebit), [legs, metrics.netDebit]);

  const inlineWarnings = useMemo(() => {
    const warnings: { text: string; color: string; level: "red" | "yellow" | "orange" | "gray" }[] = [];

    const hasInsufficientGreeks = legs.some(l =>
      (l.delta == null || l.delta === 0) && (l.gamma == null || l.gamma === 0)
    );
    if (legs.length > 0 && hasInsufficientGreeks) {
      warnings.push({ text: "Greeks unavailable for one or more legs. Position-level risk metrics may be incomplete.", color: MUTED, level: "gray" });
    }

    return warnings;
  }, [legs]);

  const riskChecks = useMemo(() => {
    if (!preTradeEnabled || legs.length === 0) return [];
    return runStrategyRiskChecks({
      legs, maxRisk: metrics.maxRisk, netDebit: metrics.netDebit,
      riskReward: metrics.riskReward,
      regime: pulseData?.structuralRegime?.label ?? null,
      sessionBias: pulseData?.sessionBias?.label ?? null,
      accountSize, preTradeMaxPositionPct, preTradeMinRR, totalDelta: metrics.totalDelta,
    });
  }, [preTradeEnabled, legs, metrics, pulseData, accountSize, preTradeMaxPositionPct, preTradeMinRR]);

  const overallRisk = useMemo(() => getOverallLevel(riskChecks), [riskChecks]);
  const blockedByRisk = preTradeEnabled && preTradeBlockOnRed && overallRisk === "RED";

  const spreadPrices = useMemo(() => {
    if (legs.length === 0) return null;
    let spreadBid = 0, spreadAsk = 0, hasPrices = true;
    for (const leg of legs) {
      const isSell = leg.direction.startsWith("SELL");
      if (leg.bid == null || leg.ask == null) { hasPrices = false; break; }
      if (isSell) { spreadBid += leg.bid; spreadAsk += leg.ask; }
      else { spreadBid -= leg.ask; spreadAsk -= leg.bid; }
    }
    if (!hasPrices) return null;
    if (isCredit) {
      spreadBid = Math.abs(spreadBid); spreadAsk = Math.abs(spreadAsk);
      if (spreadBid > spreadAsk) { const t = spreadBid; spreadBid = spreadAsk; spreadAsk = t; }
    }
    return { spreadBid, spreadMid: (spreadBid + spreadAsk) / 2, spreadAsk };
  }, [legs, isCredit]);

  useEffect(() => {
    if (spreadPrices && !limitPrice && !priceLocked) {
      setLimitPrice(spreadPrices.spreadMid.toFixed(2));
    }
  }, [spreadPrices]);

  const effectiveBid = spreadPrices?.spreadBid ?? null;
  const effectiveAsk = spreadPrices?.spreadAsk ?? null;
  const midPrice = effectiveBid != null && effectiveAsk != null ? (effectiveBid + effectiveAsk) / 2 : null;

  const sliderValue = useMemo(() => {
    if (effectiveBid == null || effectiveAsk == null) return 50;
    const lp = parseFloat(limitPrice);
    if (!lp) return 50;
    const range = effectiveAsk - effectiveBid;
    if (range <= 0) return 50;
    return Math.min(100, Math.max(0, ((lp - effectiveBid) / range) * 100));
  }, [effectiveBid, effectiveAsk, limitPrice]);

  const setMidPrice = useCallback(() => {
    if (spreadPrices) setLimitPrice(spreadPrices.spreadMid.toFixed(2));
  }, [spreadPrices]);

  const setNatPrice = useCallback(() => {
    if (!spreadPrices) return;
    setLimitPrice(isCredit ? spreadPrices.spreadBid.toFixed(2) : spreadPrices.spreadAsk.toFixed(2));
  }, [spreadPrices, isCredit]);

  const estimatedCost = useMemo(() => {
    const price = parseFloat(limitPrice);
    if (!price || legs.length === 0) return null;
    return price * quantity * 100;
  }, [limitPrice, quantity, legs]);

  const isValid = legs.length > 0 && !blockedByRisk && !!limitPrice && parseFloat(limitPrice) > 0 && quantity > 0 && !!accountHash;

  const buildSchwabOrder = useCallback(() => {
    const parsed = parseFloat(limitPrice || "0");
    const o: Record<string, unknown> = {
      orderType: isCredit ? "NET_CREDIT" : "NET_DEBIT",
      session: extendedHours ? "SEAMLESS" : "NORMAL",
      duration: "DAY",
      complexOrderStrategyType: "NONE",
      orderStrategyType: "SINGLE",
      orderLegCollection: legs.map(leg => ({
        instruction: leg.direction,
        quantity: leg.quantity * quantity,
        instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
      })),
      price: parsed,
    };
    return o;
  }, [isCredit, extendedHours, legs, quantity, limitPrice]);

  const validateAndReview = useCallback(() => {
    const parsed = parseFloat(limitPrice || "0");
    if (!parsed || parsed <= 0) {
      setPriceError("A limit price is required. Set a price using BID / MID / NAT or enter manually.");
      return;
    }
    setPriceError("");
    setStage("review");
  }, [limitPrice]);

  const handleSubmit = useCallback(async () => {
    if (!accountHash) return;
    const parsed = parseFloat(limitPrice || "0");
    if (!parsed || parsed <= 0) {
      setPriceError("A limit price is required.");
      setStage("form");
      return;
    }
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

  const changePct = quote?.changePct;
  const changeColor = (changePct ?? 0) >= 0 ? UP : DOWN;

  const inputStyle = {
    color: WHITE, background: FIELD, border: `1px solid ${BORDER2}`,
    fontSize: 13, fontFamily: MONO,
  } as const;

  return (
    <div className="fixed inset-0 z-[210] flex flex-col" style={{ background: BG }}>

      <header className="shrink-0 flex items-center h-11 px-4" style={{ background: FIELD, borderBottom: `1px solid ${BORDER}` }}>
        <button
          onClick={onBack ?? onClose}
          className="flex items-center gap-1.5 font-mono text-[13px] font-medium transition-colors active:opacity-70"
          style={{ color: MUTED, minWidth: 56 }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <span className="font-mono font-bold text-[15px] tracking-wide" style={{ color: WHITE }}>{symbol}</span>
          <span className="font-mono text-[13px] font-semibold" style={{ color: changeColor }}>
            {fmt(quote?.last)}{changePct != null ? ` ${changePct >= 0 ? "+" : ""}${fmt(changePct)}%` : ""}
          </span>
        </div>
        <button
          onClick={onClose}
          className="font-mono text-[13px] font-medium transition-colors active:opacity-70"
          style={{ color: MUTED, minWidth: 56, textAlign: "right" }}
        >
          Close
        </button>
      </header>

      {stage === "success" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <CheckCircle2 className="w-14 h-14" style={{ color: UP }} />
          <p className="font-mono text-[16px] font-bold" style={{ color: WHITE }}>Order Placed</p>
          <p className="font-mono text-[12px] text-center" style={{ color: MUTED }}>
            {isCredit ? "Credit" : "Debit"} spread — {quantity} contract{quantity > 1 ? "s" : ""} of {symbol}
          </p>
          {orderId && <p className="font-mono text-[11px]" style={{ color: DIM }}>Order ID: {orderId}</p>}
          <button
            onClick={onClose}
            className="mt-4 w-full max-w-xs py-3 font-mono text-[13px] font-bold tracking-wider"
            style={{ background: CARD, color: TEXT, border: `1px solid ${BORDER2}` }}
          >
            Done
          </button>
        </div>
      ) : stage === "submitting" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: GOLD }} />
          <p className="font-mono text-[13px]" style={{ color: MUTED }}>Submitting order...</p>
        </div>
      ) : stage === "error" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <AlertTriangle className="w-14 h-14" style={{ color: DOWN }} />
          <p className="font-mono text-[16px] font-bold" style={{ color: WHITE }}>Order Failed</p>
          <p className="font-mono text-[12px] text-center max-w-sm" style={{ color: DOWN }}>{errorMsg}</p>
          <div className="flex gap-3 mt-4 w-full max-w-xs">
            <button onClick={() => setStage("form")} className="flex-1 py-3 font-mono text-[13px] font-bold tracking-wider" style={{ background: CARD, color: TEXT, border: `1px solid ${BORDER2}` }}>Edit</button>
            <button onClick={onClose} className="flex-1 py-3 font-mono text-[13px] font-bold tracking-wider" style={{ background: CARD, color: MUTED, border: `1px solid ${BORDER2}` }}>Close</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto pb-28">

            {legs.length > 0 && (
              <div className="px-4 pt-3 pb-2">
                <span className="font-mono text-[18px] font-bold tracking-wider" style={{ color: strategyId.color }}>
                  {strategyId.name}
                </span>
                {strategyId.warning && (
                  <div className="mt-2 px-3 py-2 flex items-start gap-2" style={{ background: "rgba(242,54,69,0.08)", border: `1px solid rgba(242,54,69,0.3)` }}>
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: DOWN }} />
                    <span className="font-mono text-[11px] leading-relaxed" style={{ color: DOWN }}>{strategyId.warning}</span>
                  </div>
                )}
                {inlineWarnings.map((w, i) => (
                  <div key={i} className="mt-2 px-3 py-2 flex items-start gap-2" style={{
                    background: w.level === "red" ? "rgba(242,54,69,0.08)" : w.level === "yellow" ? "rgba(251,191,36,0.08)" : w.level === "orange" ? "rgba(249,115,22,0.08)" : "rgba(113,113,122,0.08)",
                    border: `1px solid ${w.level === "red" ? "rgba(242,54,69,0.3)" : w.level === "yellow" ? "rgba(251,191,36,0.3)" : w.level === "orange" ? "rgba(249,115,22,0.3)" : "rgba(113,113,122,0.3)"}`,
                  }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: w.color }} />
                    <span className="font-mono text-[10px] leading-relaxed" style={{ color: w.color }}>{w.text}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="p-4 space-y-3">
              <div className="flex" style={{ border: `1px solid ${BORDER2}` }}>
                {(["templates", "builder"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="flex-1 py-2 font-mono text-[12px] font-bold tracking-[0.1em] transition-all"
                    style={{
                      color: mode === m ? GOLD : DIM,
                      background: mode === m ? "rgba(255,184,0,0.06)" : "transparent",
                      borderBottom: mode === m ? `2px solid ${GOLD}` : `2px solid transparent`,
                    }}
                  >
                    {m === "templates" ? "STRATEGIES" : "LEG BUILDER"}
                  </button>
                ))}
              </div>

              {mode === "templates" && (
                <div className="grid grid-cols-2 gap-2">
                  {STRATEGIES.map(tmpl => (
                    <button
                      key={tmpl.id}
                      onClick={() => applyTemplate(tmpl)}
                      className="p-3 text-left transition-all active:scale-[0.97]"
                      style={{ background: CARD, border: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: tmpl.color }} />
                        <span className="font-mono text-[12px] font-bold" style={{ color: WHITE }}>{tmpl.name}</span>
                      </div>
                      <span className="font-mono text-[10px] leading-tight" style={{ color: MUTED }}>{tmpl.description}</span>
                    </button>
                  ))}
                </div>
              )}

              {mode === "builder" && (
                <div className="space-y-2">
                  <div style={{ background: CARD, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
                    <div className="flex items-center px-3 py-1.5" style={{ borderBottom: `1px solid ${BORDER}`, background: "#0d0d0f" }}>
                      <span className="font-mono text-[11px] tracking-wider" style={{ color: MUTED, width: 44 }}>DIR</span>
                      <span className="font-mono text-[11px] tracking-wider" style={{ color: MUTED, width: 36 }}>QTY</span>
                      <span className="font-mono text-[11px] tracking-wider flex-1" style={{ color: MUTED }}>STRIKE / TYPE / EXP</span>
                      <span className="font-mono text-[11px] tracking-wider text-right" style={{ color: MUTED, width: 86 }}>BID / ASK</span>
                      <span style={{ width: 28 }} />
                    </div>
                    {legs.map((leg) => {
                      const isBuy = leg.direction.startsWith("BUY");
                      const dirColor = isBuy ? UP : DOWN;
                      const dirLabel = isBuy ? (leg.direction === "BUY_TO_OPEN" ? "BTO" : "BTC") : (leg.direction === "SELL_TO_OPEN" ? "STO" : "STC");
                      const qtySign = isBuy ? "+" : "-";
                      const expLabel = (() => {
                        const clean = leg.expiration.split(":")[0].trim();
                        const d = new Date(clean);
                        if (isNaN(d.getTime())) return clean.slice(0, 9);
                        const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
                        return `${d.getDate()} ${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
                      })();
                      return (
                        <div key={leg.id}>
                          <div
                            className="flex items-center px-3 cursor-pointer active:opacity-80"
                            style={{ borderBottom: `1px solid ${BORDER}`, height: 44, background: expandedLeg === leg.id ? "#111113" : "transparent" }}
                            onClick={() => setExpandedLeg(expandedLeg === leg.id ? null : leg.id)}
                          >
                            <span className="font-mono text-[13px] font-bold" style={{ color: dirColor, width: 44 }}>{dirLabel}</span>
                            <span className="font-mono text-[15px] font-bold" style={{ color: dirColor, width: 36 }}>{qtySign}{leg.quantity}</span>
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <span className="font-mono text-[15px] font-bold" style={{ color: WHITE }}>{leg.strike}</span>
                              <span className="font-mono text-[13px] font-bold" style={{ color: leg.optionType === "CALL" ? "#60a5fa" : "#f472b6" }}>
                                {leg.optionType === "CALL" ? "C" : "P"}
                              </span>
                              <span className="font-mono text-[11px]" style={{ color: MUTED }}>{expLabel}</span>
                            </div>
                            <div className="flex items-center gap-1 text-right" style={{ width: 86 }}>
                              {(() => {
                                const mid = (leg.bid != null && leg.ask != null && leg.bid > 0) ? (leg.bid + leg.ask) / 2 : null;
                                const spread = (leg.bid != null && leg.ask != null) ? leg.ask - leg.bid : 0;
                                const isWide = mid != null && mid > 0 && (spread / mid) > 2;
                                return isWide ? <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: "#f59e0b" }} title="Wide bid-ask spread on this leg" /> : null;
                              })()}
                              <span className="font-mono text-[12px]" style={{ color: leg.bid != null ? UP : DIM }}>{fmt(leg.bid)}</span>
                              <span className="font-mono text-[10px]" style={{ color: DIM }}>/</span>
                              <span className="font-mono text-[12px]" style={{ color: leg.ask != null ? DOWN : DIM }}>{fmt(leg.ask)}</span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeLeg(leg.id); }}
                              className="p-1 ml-1 transition-colors"
                              style={{ color: MUTED }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {expandedLeg === leg.id && (
                            <div className="px-3 py-2 space-y-2" style={{ background: "#0d0d0f", borderBottom: `1px solid ${BORDER}` }}>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="font-mono text-[9px] tracking-wider block mb-0.5" style={{ color: MUTED }}>DIRECTION</label>
                                  <select value={leg.direction} onChange={(e) => updateLeg(leg.id, { direction: e.target.value as LegDirection })} className="w-full px-2 py-1.5 font-mono text-[12px] outline-none" style={inputStyle}>
                                    <option value="BUY_TO_OPEN">Buy to Open</option>
                                    <option value="SELL_TO_OPEN">Sell to Open</option>
                                    <option value="BUY_TO_CLOSE">Buy to Close</option>
                                    <option value="SELL_TO_CLOSE">Sell to Close</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="font-mono text-[9px] tracking-wider block mb-0.5" style={{ color: MUTED }}>TYPE</label>
                                  <select value={leg.optionType} onChange={(e) => updateLeg(leg.id, { optionType: e.target.value as OptionType })} className="w-full px-2 py-1.5 font-mono text-[12px] outline-none" style={inputStyle}>
                                    <option value="CALL">Call</option>
                                    <option value="PUT">Put</option>
                                  </select>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="font-mono text-[9px] tracking-wider block mb-0.5" style={{ color: MUTED }}>STRIKE</label>
                                  {availableStrikes.length > 0 ? (
                                    <select value={leg.strike} onChange={(e) => updateLeg(leg.id, { strike: parseFloat(e.target.value) })} className="w-full px-2 py-1.5 font-mono text-[12px] outline-none" style={inputStyle}>
                                      {availableStrikes.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  ) : (
                                    <input type="number" step="0.5" value={leg.strike} onChange={(e) => updateLeg(leg.id, { strike: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-1.5 font-mono text-[12px] outline-none" style={inputStyle} />
                                  )}
                                </div>
                                <div>
                                  <label className="font-mono text-[9px] tracking-wider block mb-0.5" style={{ color: MUTED }}>QTY</label>
                                  <input type="number" min={1} value={leg.quantity} onChange={(e) => updateLeg(leg.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} className="w-full px-2 py-1.5 font-mono text-[12px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" style={inputStyle} />
                                </div>
                                <div>
                                  <label className="font-mono text-[9px] tracking-wider block mb-0.5" style={{ color: MUTED }}>EXP</label>
                                  {availableExpirations.length > 0 ? (
                                    <select value={leg.expiration} onChange={(e) => updateLeg(leg.id, { expiration: e.target.value })} className="w-full px-2 py-1.5 font-mono text-[12px] outline-none" style={inputStyle}>
                                      {availableExpirations.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                                    </select>
                                  ) : (
                                    <input type="text" value={leg.expiration} readOnly className="w-full px-2 py-1.5 font-mono text-[12px] outline-none" style={{ ...inputStyle, color: DIM }} />
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 pt-1">
                                {[["Δ", leg.delta, 3], ["Γ", leg.gamma, 4], ["Θ", leg.theta, 3], ["V", leg.vega, 3]].map(([l, v, d]) => (
                                  <span key={l as string} className="font-mono text-[10px]" style={{ color: MUTED }}>
                                    {l as string} <span style={{ color: TEXT }}>{fmt(v as number | null, d as number)}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={addLeg}
                    className="w-full py-2 font-mono text-[11px] font-bold tracking-wider flex items-center justify-center gap-2 transition-colors active:opacity-70"
                    style={{ color: GOLD, background: "rgba(255,184,0,0.04)", border: `1px solid ${BORDER2}` }}
                  >
                    <Plus className="w-3.5 h-3.5" /> ADD LEG
                  </button>
                </div>
              )}

              {legs.length > 0 && (
                <>
                  <div style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                    <div className="px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <span className="font-mono text-[11px] font-bold tracking-[0.12em]" style={{ color: GOLD }}>STRATEGY PREVIEW</span>
                    </div>
                    <div className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                        <div className="flex flex-col items-start">
                          <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: MUTED }}>Net {metrics.isDebit ? "Debit" : "Credit"}</span>
                          <span className="font-mono text-[18px] font-bold" style={{ color: metrics.isDebit ? DOWN : UP }}>{fmtCurrency(Math.abs(metrics.netDebit))}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: MUTED }}>Max Risk</span>
                          <span className="font-mono text-[18px] font-bold" style={{ color: DOWN }}>{metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk) : "Undefined"}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                        <div className="flex justify-between items-baseline">
                          <span className="font-mono text-[12px]" style={{ color: MUTED }}>Max Reward</span>
                          <span className="font-mono text-[14px] font-bold" style={{ color: UP }}>{metrics.maxReward != null ? fmtCurrency(metrics.maxReward) : "Unlimited"}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="font-mono text-[12px]" style={{ color: MUTED }}>R:R</span>
                          <span className="font-mono text-[14px] font-bold" style={{ color: TEXT }}>{metrics.riskReward != null ? `${metrics.riskReward.toFixed(1)}:1` : "—"}</span>
                        </div>
                        {metrics.breakevens.length > 0 && (
                          <div className="flex justify-between items-baseline col-span-2">
                            <span className="font-mono text-[12px]" style={{ color: MUTED }}>Breakeven{metrics.breakevens.length > 1 ? "s" : ""}</span>
                            <span className="font-mono text-[13px] font-semibold" style={{ color: TEXT }}>{metrics.breakevens.map(b => `$${b.toFixed(2)}`).join(" / ")}</span>
                          </div>
                        )}
                        {metrics.pop != null && (
                          <div className="flex justify-between items-baseline">
                            <span className="font-mono text-[12px]" style={{ color: MUTED }}>Est. PoP</span>
                            <span className="font-mono text-[14px] font-bold" style={{ color: TEXT }}>{metrics.pop.toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                        <div className="grid grid-cols-4 gap-2">
                          {([
                            ["Delta", metrics.totalDelta, 3, null],
                            ["Gamma", metrics.totalGamma, 4, null],
                            ["Theta", metrics.totalTheta, 3, metrics.totalTheta > 0 ? UP : DOWN],
                            ["Vega", metrics.totalVega, 3, null],
                          ] as [string, number, number, string | null][]).map(([label, val, dec, clr]) => (
                            <div key={label} className="text-center">
                              <span className="font-mono text-[9px] tracking-wider block mb-0.5 uppercase" style={{ color: DIM }}>{label}</span>
                              <span className="font-mono text-[13px] font-bold" style={{ color: clr ?? TEXT }}>{fmt(val, dec)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-mono text-[10px] tracking-wider" style={{ color: MUTED }}>
                        {isCredit ? "NET CREDIT PRICE" : "NET DEBIT PRICE"}
                      </label>
                      <button onClick={() => setPriceLocked(!priceLocked)} className="p-0.5" style={{ color: priceLocked ? GOLD : DIM }}>
                        {priceLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                    </div>
                    <div className="flex items-center overflow-hidden" style={{ background: FIELD, border: `1px solid ${priceLocked ? "rgba(251,191,36,0.3)" : BORDER2}` }}>
                      <span className="pl-3 font-mono text-[12px]" style={{ color: DIM }}>$</span>
                      <input
                        type="number" inputMode="decimal" step="0.01" value={limitPrice}
                        onChange={(e) => { if (!priceLocked) { setLimitPrice(e.target.value); setPriceError(""); } }}
                        placeholder="0.00"
                        className="flex-1 px-1.5 py-2 font-mono text-[14px] font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ color: priceLocked ? GOLD : WHITE }}
                        readOnly={priceLocked}
                      />
                      <div className="flex items-center gap-1 pr-2">
                        <button onClick={() => { if (!priceLocked && effectiveBid != null) setLimitPrice(effectiveBid.toFixed(2)); }} disabled={priceLocked} className="px-2 py-1 rounded font-mono text-[10px] font-bold" style={{ color: UP, background: "rgba(0,209,102,0.08)", opacity: priceLocked ? 0.4 : 1 }}>BID</button>
                        <button onClick={() => { if (!priceLocked) setMidPrice(); }} disabled={priceLocked} className="px-2 py-1 rounded font-mono text-[10px] font-bold" style={{ color: GOLD, background: GOLD_DIM, opacity: priceLocked ? 0.4 : 1 }}>MID</button>
                        <button onClick={() => { if (!priceLocked) setNatPrice(); }} disabled={priceLocked} className="px-2 py-1 rounded font-mono text-[10px] font-bold" style={{ color: DOWN, background: "rgba(242,54,69,0.08)", opacity: priceLocked ? 0.4 : 1 }}>NAT</button>
                      </div>
                    </div>
                    {effectiveBid != null && effectiveAsk != null && (
                      <div className="mt-1.5 px-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px]" style={{ color: UP }}>Bid</span>
                          <div className="flex-1 relative h-3">
                            <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: BORDER2 }}>
                              <div className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(90deg, ${UP}30, ${GOLD}40, ${DOWN}30)` }} />
                            </div>
                            <input
                              type="range" min={0} max={100} value={sliderValue}
                              onChange={(e) => {
                                if (priceLocked) return;
                                const pct = parseInt(e.target.value) / 100;
                                setLimitPrice((effectiveBid + (effectiveAsk - effectiveBid) * pct).toFixed(2));
                              }}
                              className="absolute inset-0 w-full opacity-0 cursor-pointer"
                              style={{ height: 12 }}
                            />
                            <div className="absolute top-0 w-2.5 h-3 rounded-sm" style={{ background: GOLD, left: `calc(${sliderValue}% - 5px)`, boxShadow: `0 0 6px ${GOLD}60` }} />
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

                  <div>
                    <label className="font-mono text-[10px] tracking-wider block mb-1" style={{ color: MUTED }}>QUANTITY (SPREADS)</label>
                    <div className="flex items-center overflow-hidden h-11" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                      <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="px-4 h-full transition-colors active:text-white" style={{ color: "#a1a1aa" }}>
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number" inputMode="numeric" value={quantity}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) setQuantity(v); }}
                        className="flex-1 text-center font-mono text-[16px] font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ color: WHITE, minWidth: 0 }}
                      />
                      <button onClick={() => setQuantity(quantity + 1)} className="px-4 h-full transition-colors active:text-white" style={{ color: "#a1a1aa" }}>
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex gap-1.5 mt-1.5">
                      {[1, 5, 10, 25].map((q) => (
                        <button key={q} onClick={() => setQuantity(q)} className="flex-1 py-1.5 font-mono text-[11px] font-medium transition-colors"
                          style={{ color: quantity === q ? GOLD : DIM, background: quantity === q ? GOLD_DIM : CARD, border: `1px solid ${quantity === q ? "rgba(251,191,36,0.3)" : BORDER2}` }}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ border: `1px solid ${BORDER2}` }}>
                    <button
                      className="w-full flex items-center justify-between px-3 py-2"
                      onClick={() => setAdvancedOpen(v => !v)}
                    >
                      <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: MUTED }}>Advanced Settings</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px]" style={{ color: DIM }}>BEST · DAY · {extendedHours ? "Ext On" : "Ext Off"}</span>
                        {advancedOpen
                          ? <ChevronUp className="w-3.5 h-3.5" style={{ color: MUTED }} />
                          : <ChevronDown className="w-3.5 h-3.5" style={{ color: MUTED }} />}
                      </div>
                    </button>
                    {advancedOpen && (
                      <div className="grid grid-cols-3 gap-1.5 px-3 pb-2">
                        <div className="px-3 py-2" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                          <span className="font-mono text-[10px] block mb-0.5" style={{ color: MUTED }}>Exchange</span>
                          <span className="font-mono text-[12px] font-medium" style={{ color: TEXT }}>BEST</span>
                        </div>
                        <div className="px-3 py-2" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                          <span className="font-mono text-[10px] block mb-0.5" style={{ color: MUTED }}>Duration</span>
                          <span className="font-mono text-[12px] font-medium" style={{ color: TEXT }}>DAY</span>
                        </div>
                        <div className="px-3 py-2 flex items-center justify-between" style={{ background: FIELD, border: `1px solid ${BORDER2}` }}>
                          <div>
                            <span className="font-mono text-[10px] block mb-0.5" style={{ color: MUTED }}>Ext Hrs</span>
                            <span className="font-mono text-[12px] font-medium" style={{ color: extendedHours ? GOLD : TEXT }}>{extendedHours ? "On" : "Off"}</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setExtendedHours(!extendedHours); }}
                            className="relative w-8 h-4 rounded-full transition-colors duration-200"
                            style={{ background: extendedHours ? GOLD : BORDER2 }}
                          >
                            <div className="absolute top-0.5 w-3 h-3 rounded-full transition-transform duration-200" style={{ background: extendedHours ? BG : DIM, transform: extendedHours ? "translateX(16px)" : "translateX(2px)" }} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {estimatedCost != null && (
                    <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: `${isCredit ? UP : DOWN}08`, border: `1px solid ${isCredit ? UP : DOWN}20` }}>
                      <span className="font-mono text-[12px]" style={{ color: MUTED }}>Est. {isCredit ? "Credit" : "Cost"}</span>
                      <span className="font-mono text-[16px] font-bold" style={{ color: WHITE }}>{fmtCurrency(Math.abs(estimatedCost))}</span>
                    </div>
                  )}

                  <div className="overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <Sparkles className="w-3.5 h-3.5" style={{ color: GOLD }} />
                      <span className="font-mono text-[11px] font-bold tracking-[0.12em]" style={{ color: GOLD }}>AI CO-PILOT</span>
                    </div>
                    <div className="px-4 py-2.5 space-y-2">
                      {(() => {
                        const tips: { text: string; type: "info" | "warn" | "tip" }[] = [];
                        const lp = parseFloat(limitPrice) || 0;
                        if (spreadPrices && lp > 0) {
                          if (!isCredit && lp > spreadPrices.spreadMid * 1.02) {
                            tips.push({ text: `Lower to mid ${fmt(spreadPrices.spreadMid)} for better fill`, type: "tip" });
                          } else if (isCredit && lp < spreadPrices.spreadMid * 0.98) {
                            tips.push({ text: `Raise credit to mid ${fmt(spreadPrices.spreadMid)} for better fill`, type: "tip" });
                          }
                          if (effectiveBid != null && effectiveAsk != null) {
                            const spreadPct = effectiveBid > 0 ? ((effectiveAsk - effectiveBid) / effectiveBid) * 100 : 0;
                            if (spreadPct > 5) tips.push({ text: `Wide bid-ask spread (${spreadPct.toFixed(1)}%) — use limit orders`, type: "warn" });
                            const fillProb = lp >= effectiveAsk ? 99 : lp >= spreadPrices.spreadMid ? 78 : lp >= effectiveBid ? 45 : 15;
                            tips.push({ text: `Fill probability at $${lp.toFixed(2)}: ~${fillProb}%`, type: "info" });
                          }
                        }
                        if (tips.length === 0) {
                          tips.push({ text: `${legs.length}-leg ${isCredit ? "credit" : "debit"} spread on ${symbol} — review risk before submitting`, type: "info" });
                        }
                        return tips.map((s, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : UP }} />
                            <span className="font-mono text-[11px] leading-snug" style={{ color: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : TEXT }}>{s.text}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {preTradeEnabled && riskChecks.length > 0 && (
                    <div className="overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                      <button
                        className="w-full flex items-center gap-2 px-4 py-2 transition-colors"
                        onClick={() => setRiskCollapsed(v => !v)}
                      >
                        <Shield className="w-4 h-4 shrink-0" style={{ color: levelColor(overallRisk) }} />
                        <span className="font-mono text-[11px] font-bold tracking-[0.12em]" style={{ color: WHITE }}>PRE-TRADE RISK CHECK</span>
                        <div className="flex-1" />
                        <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded" style={{
                          color: overallRisk === "GREEN" ? "#000" : overallRisk === "YELLOW" ? "#000" : "#fff",
                          background: levelColor(overallRisk),
                        }}>
                          {overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}
                        </span>
                        {riskCollapsed
                          ? <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0" style={{ color: MUTED }} />
                          : <ChevronUp className="w-3.5 h-3.5 ml-1 shrink-0" style={{ color: MUTED }} />
                        }
                      </button>
                      {!riskCollapsed && (
                        <>
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
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {legs.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 px-4 pb-8 pt-3" style={{ background: `linear-gradient(transparent, ${BG} 30%)` }}>
              {blockedByRisk && (
                <div className="mb-2 px-3 py-2 flex items-center gap-2" style={{ background: "rgba(242,54,69,0.08)", border: `1px solid rgba(242,54,69,0.3)` }}>
                  <ShieldX className="w-4 h-4 shrink-0" style={{ color: DOWN }} />
                  <span className="font-mono text-[12px] font-medium" style={{ color: DOWN }}>Risk check failed — order blocked</span>
                </div>
              )}
              {priceError && (
                <div className="mb-2 px-3 py-2 flex items-center gap-2" style={{ background: "rgba(242,54,69,0.08)", border: `1px solid rgba(242,54,69,0.3)` }}>
                  <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: DOWN }} />
                  <span className="font-mono text-[11px] font-medium" style={{ color: DOWN }}>{priceError}</span>
                </div>
              )}
              <button
                onClick={validateAndReview}
                disabled={!isValid}
                className="w-full py-3.5 font-mono text-[14px] font-bold tracking-[0.15em] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
                style={{ background: isValid ? UP : BORDER2, color: isValid ? "#fff" : DIM }}
              >
                REVIEW STRATEGY ORDER
              </button>
            </div>
          )}

          {stage === "review" && (
            <div className="fixed inset-0 z-[220] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
              <div className="w-full max-w-lg p-5 space-y-3 animate-in slide-in-from-bottom duration-300" style={{ background: CARD, border: `1px solid ${BORDER2}`, borderBottom: "none" }}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-mono font-bold text-[14px] tracking-wider" style={{ color: WHITE }}>Confirm Strategy Order</h3>
                  <button onClick={() => setStage("form")} className="p-1" style={{ color: MUTED }}><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-1.5 p-3" style={{ background: "#0a0a0c", border: `1px solid ${BORDER}` }}>
                  <div className="flex justify-between mb-1">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Strategy</span>
                    <span className="font-mono text-[12px] font-bold" style={{ color: strategyId.color }}>{strategyId.name}</span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Order Type</span>
                    <span className="font-mono text-[11px] font-bold" style={{ color: TEXT }}>LIMIT ORDER</span>
                  </div>
                  {legs.map((leg, i) => {
                    const isBuy = leg.direction.startsWith("BUY");
                    const dirLabel = isBuy ? (leg.direction === "BUY_TO_OPEN" ? "BTO" : "BTC") : (leg.direction === "SELL_TO_OPEN" ? "STO" : "STC");
                    return (
                      <div key={i} className="flex items-center" style={{ height: 22 }}>
                        <span className="font-mono text-[11px] font-bold" style={{ color: isBuy ? UP : DOWN, width: 32 }}>{dirLabel}</span>
                        <span className="font-mono text-[11px] font-bold" style={{ color: isBuy ? UP : DOWN, width: 26 }}>{isBuy ? "+" : "-"}{leg.quantity * quantity}</span>
                        <span className="font-mono text-[11px] flex-1" style={{ color: TEXT }}>{leg.strike} {leg.optionType === "CALL" ? "C" : "P"}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between mt-1">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Net Price</span>
                    <span className="font-mono text-[12px]" style={{ color: TEXT }}>${limitPrice}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Duration</span>
                    <span className="font-mono text-[12px]" style={{ color: TEXT }}>DAY{extendedHours ? " + Ext" : ""}</span>
                  </div>
                  <div className="border-t my-1.5" style={{ borderColor: BORDER }} />
                  <div className="flex justify-between">
                    <span className="font-mono text-[11px]" style={{ color: "#a1a1aa" }}>Est. {isCredit ? "Credit" : "Cost"}</span>
                    <span className="font-mono text-[15px] font-bold" style={{ color: WHITE }}>{estimatedCost != null ? fmtCurrency(Math.abs(estimatedCost)) : "—"}</span>
                  </div>
                </div>
                <div className="p-3 flex items-start gap-2" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}>
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GOLD }} />
                  <p className="font-mono text-[11px] leading-relaxed" style={{ color: GOLD }}>
                    This will place a live order with Schwab. Verify all details before confirming.
                  </p>
                </div>
                <div className="flex gap-3 pt-1 pb-4">
                  <button onClick={() => setStage("form")} className="flex-1 py-3 font-mono text-[12px] font-bold tracking-wider" style={{ background: FIELD, color: "#a1a1aa", border: `1px solid ${BORDER2}` }}>Back</button>
                  <button
                    onClick={handleSubmit}
                    className="flex-[2] py-3 font-mono text-[13px] font-bold tracking-wider active:scale-[0.98] transition-transform"
                    style={{ background: `linear-gradient(180deg, ${UP} 0%, #00a854 100%)`, color: "#fff", boxShadow: "0 4px 20px rgba(0,209,102,0.3)" }}
                  >
                    Confirm Strategy
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
