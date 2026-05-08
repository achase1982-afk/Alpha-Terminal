import { useState, useMemo, useCallback, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote, type QuoteData } from "@/hooks/useQuote";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { fetchWithAuth, humanizeFailedApiBody } from "@/lib/fetchWithAuth";
import { startStrategistPolling } from "@/lib/strategistPoller";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import {
  X, Plus, Trash2, ChevronDown, ChevronUp, ShieldX,
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
const MUTED = "#7d8494";
const DIM = "#7d8494";
const TEXT = "#b8bcc8";
const WHITE = "#f7f8fa";
const FIELD = "rgba(10,12,16,0.95)";
const GOLD_DIM = "rgba(245,166,35,0.08)";
const DIVIDER = "#1c1f26";
const R_CARD = 14;
const CARD_GRAD = "linear-gradient(145deg, #111319, #080a0f)";
const CTA_GRAD = "linear-gradient(135deg, #f5a623, #ffce73)";
const SYS_FONT = "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif";

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

/** QuoteData uses `description`; some code paths still attach `companyName` on the merged object. */
function companyNameFromQuote(quote: QuoteData | null | undefined): string {
  if (quote == null) return "";
  const v = Reflect.get(quote, "companyName");
  return v == null ? "" : String(v);
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


interface StrategyBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  onSwitchToStock?: () => void;
  onSendToStrategist?: (ticker: string) => void;
  initialLegs?: StrategyLeg[];
  availableStrikes?: number[];
  availableExpirations?: { label: string; value: string }[];
  chainData?: Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>;
}

export function StrategyBuilder({
  isOpen,
  onClose,
  onBack,
  onSwitchToStock,
  onSendToStrategist,
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
  const [timeInForce, setTimeInForce] = useState<"DAY" | "GTC">("DAY");
  const [stage, setStage] = useState<Stage>("form");
  const [accountHash, setAccountHash] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [priceError, setPriceError] = useState("");
  const [sendMode, setSendMode] = useState<"order" | "strategist">("order");
  const [thesisText, setThesisText] = useState("");
  const [rollingShort, setRollingShort] = useState(false);
  const [strategistDispatchInFlight, setStrategistDispatchInFlight] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setExpandedLeg(null);
      setRiskCollapsed(true);
      setLimitPrice("");
      setQuantity(1);
      setPriceLocked(false);
      setExtendedHours(false);
      setTimeInForce("DAY");
      setStage("form");
      setOrderId(null);
      setErrorMsg("");
      setPriceError("");
      if (initialLegs && initialLegs.length > 0) {
        const streamTicks = useOptionsStreamStore.getState().ticks;
        const enrichedLegs = initialLegs.map(leg => {
          const tick = leg.schwabSymbol ? streamTicks[leg.schwabSymbol] : undefined;
          if (!tick) return leg;
          return {
            ...leg,
            bid: (tick.bid != null) ? tick.bid : leg.bid,
            ask: (tick.ask != null) ? tick.ask : leg.ask,
            delta: (tick.delta != null) ? tick.delta : leg.delta,
            gamma: (tick.gamma != null) ? tick.gamma : leg.gamma,
            theta: (tick.theta != null) ? tick.theta : leg.theta,
            vega: (tick.vega != null) ? tick.vega : leg.vega,
            iv: (tick.iv != null) ? tick.iv : leg.iv,
          };
        });
        setLegs(enrichedLegs);
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
    const parts = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let yy: string, mm: string, dd: string;
    if (parts) {
      yy = parts[1].slice(2);
      mm = parts[2];
      dd = parts[3];
    } else {
      const d = new Date(clean + "T12:00:00");
      if (isNaN(d.getTime())) return "";
      yy = String(d.getFullYear()).slice(2);
      mm = String(d.getMonth() + 1).padStart(2, "0");
      dd = String(d.getDate()).padStart(2, "0");
    }
    const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
    const sym = symbol.toUpperCase().padEnd(6, " ");
    return `${sym}${yy}${mm}${dd}${optionType === "CALL" ? "C" : "P"}${strikePadded}`;
  }, [symbol]);

  const enrichLeg = useCallback((leg: Omit<StrategyLeg, "id" | "bid" | "ask" | "delta" | "gamma" | "theta" | "vega" | "iv" | "schwabSymbol">): StrategyLeg => {
    const schwabSymbol = buildSchwabSymbol(leg.strike, leg.optionType, leg.expiration);
    const cd = chainData?.get(schwabSymbol);
    const tick = useOptionsStreamStore.getState().ticks[schwabSymbol];
    return {
      ...leg, id: nextLegId(), schwabSymbol,
      bid: (tick && tick.bid != null) ? tick.bid : cd?.bid,
      ask: (tick && tick.ask != null) ? tick.ask : cd?.ask,
      delta: (tick && tick.delta != null) ? tick.delta : cd?.delta,
      gamma: (tick && tick.gamma != null) ? tick.gamma : cd?.gamma,
      theta: (tick && tick.theta != null) ? tick.theta : cd?.theta,
      vega: (tick && tick.vega != null) ? tick.vega : cd?.vega,
      iv: (tick && tick.iv != null) ? tick.iv : cd?.iv,
    };
  }, [buildSchwabSymbol, chainData]);

  const applyTemplate = useCallback((tmpl: StrategyTemplate) => {
    const rawLegs = tmpl.buildLegs(atmStrike, strikeWidth, defaultExp);
    setLegs(rawLegs.map(l => enrichLeg(l)));
    setMode("builder");
    setLimitPrice("");
  }, [atmStrike, strikeWidth, defaultExp, enrichLeg]);

  const MAX_OPTION_LEGS = 4;

  const addLeg = useCallback(() => {
    setLegs(prev => {
      if (prev.length >= MAX_OPTION_LEGS) return prev;
      return [...prev, enrichLeg({ optionType: "CALL", direction: "BUY_TO_OPEN", strike: atmStrike, expiration: defaultExp, quantity: 1 })];
    });
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
        const tick = useOptionsStreamStore.getState().ticks[schwabSymbol];
        updated.schwabSymbol = schwabSymbol;
        updated.bid = (tick && tick.bid != null) ? tick.bid : cd?.bid;
        updated.ask = (tick && tick.ask != null) ? tick.ask : cd?.ask;
        updated.delta = (tick && tick.delta != null) ? tick.delta : cd?.delta;
        updated.gamma = (tick && tick.gamma != null) ? tick.gamma : cd?.gamma;
        updated.theta = (tick && tick.theta != null) ? tick.theta : cd?.theta;
        updated.vega = (tick && tick.vega != null) ? tick.vega : cd?.vega;
        updated.iv = (tick && tick.iv != null) ? tick.iv : cd?.iv;
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
  const blockedByRisk = false;

  const spreadPrices = useMemo(() => {
    if (legs.length === 0) return null;
    let spreadBid = 0, spreadAsk = 0;
    for (const leg of legs) {
      const isSell = leg.direction.startsWith("SELL");
      const b = leg.bid ?? 0;
      const a = leg.ask ?? 0;
      if (isSell) { spreadBid += b; spreadAsk += a; }
      else { spreadBid -= a; spreadAsk -= b; }
    }
    if (isCredit) {
      spreadBid = Math.abs(spreadBid); spreadAsk = Math.abs(spreadAsk);
      if (spreadBid > spreadAsk) { const t = spreadBid; spreadBid = spreadAsk; spreadAsk = t; }
    } else {
      spreadBid = Math.abs(spreadBid);
      spreadAsk = Math.abs(spreadAsk);
      if (spreadBid > spreadAsk) { const t = spreadBid; spreadBid = spreadAsk; spreadAsk = t; }
    }
    const spreadMid = (spreadBid + spreadAsk) / 2;
    if (spreadMid <= 0) return { spreadBid: 0.01, spreadMid: 0.01, spreadAsk: 0.01 };
    return { spreadBid, spreadMid, spreadAsk };
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

  const isValid = legs.length > 0 && !!limitPrice && parseFloat(limitPrice) > 0 && quantity > 0 && !!accountHash;

  const buildSchwabOrder = useCallback(() => {
    const parsed = parseFloat(limitPrice || "0");
    const getSymParts = (sym: string) => ({ date: sym.substring(6, 12), cp: sym.charAt(12) });
    let complexType = "CUSTOM";
    if (legs.length === 1) {
      complexType = "NONE";
    } else if (legs.length === 2) {
      const p0 = getSymParts(legs[0].schwabSymbol);
      const p1 = getSymParts(legs[1].schwabSymbol);
      if (p0.date === p1.date && p0.cp === p1.cp) complexType = "VERTICAL";
      else if (p0.date === p1.date && p0.cp !== p1.cp) complexType = "STRANGLE";
      else complexType = "CUSTOM";
    } else if (legs.length === 4) {
      const cps = legs.map(l => getSymParts(l.schwabSymbol).cp);
      if (cps.filter(c => c === "C").length === 2 && cps.filter(c => c === "P").length === 2) complexType = "IRON_CONDOR";
    }
    const o: Record<string, unknown> = {
      orderType: isCredit ? "NET_CREDIT" : "NET_DEBIT",
      session: extendedHours ? "SEAMLESS" : "NORMAL",
      duration: timeInForce,
      complexOrderStrategyType: complexType,
      orderStrategyType: "SINGLE",
      orderLegCollection: legs.map(leg => ({
        instruction: leg.direction,
        quantity: leg.quantity * quantity,
        instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
      })),
    };
    if (parsed > 0) o.price = parsed;
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

  const isRollingShortEligible = useMemo(() => {
    if (legs.length < 2) return false;
    const shortLegs = legs.filter(l => l.direction.startsWith("SELL") && !!l.expiration);
    const longLegs = legs.filter(l => l.direction.startsWith("BUY") && !!l.expiration);
    if (shortLegs.length === 0 || longLegs.length === 0) return false;
    return shortLegs.some(s => longLegs.some(lg => s.expiration < lg.expiration));
  }, [legs]);

  useEffect(() => {
    if (!isRollingShortEligible && rollingShort) setRollingShort(false);
  }, [isRollingShortEligible, rollingShort]);

  const handleSendToStrategist = useCallback(async () => {
    if (strategistDispatchInFlight) return;
    setStrategistDispatchInFlight(true);
    const upperTicker = symbol.toUpperCase();
    const jobId = `vj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
    const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : 0;
    const px = parseFloat(limitPrice) || 0;
    const estMaxRisk = isCredit ? (width - px) * 100 * quantity : px * 100 * quantity;
    const estMaxProfit = isCredit ? px * 100 * quantity : (width - px) * 100 * quantity;

    const validationLegs = legs.map(l => ({
      instruction: l.direction,
      strike: l.strike,
      optionType: (l.optionType?.toUpperCase() === "CALL" ? "CALL" : "PUT") as "CALL" | "PUT",
      expiration: l.expiration,
      quantity: l.quantity,
      bid: l.bid ?? null,
      ask: l.ask ?? null,
      delta: l.delta ?? null,
    }));

    const ticket = {
      ticker: upperTicker,
      isOption: true,
      isMultiLeg: true,
      mode: "opening" as const,
      side: (isCredit ? "SELL" : "BUY") as "BUY" | "SELL",
      orderType: "LIMIT",
      duration: timeInForce,
      quantity,
      limitPrice: px || null,
      legs: validationLegs,
      netPrice: px || null,
      isCredit,
      underlyingPrice: quote?.last ?? null,
      underlyingChangePct: quote?.changePct ?? null,
      estMaxRisk,
      estMaxProfit,
      breakeven: null,
    };

    const validationMeta = {
      ticker: upperTicker,
      mode: "opening" as const,
      ticket,
      thesis: thesisText.trim() || undefined,
      rollingShort: isRollingShortEligible && rollingShort,
    };

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
        return;
      }
      startStrategistPolling(jobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useTerminalStore.getState().errorStrategistJob(jobId, msg);
      setErrorMsg(`Strategist dispatch failed: ${msg.slice(0, 200)}`);
      setStrategistDispatchInFlight(false);
      return;
    }

    onSendToStrategist?.(upperTicker);
    setStrategistDispatchInFlight(false);
  }, [
    strategistDispatchInFlight, symbol, legs, limitPrice, isCredit, quantity,
    timeInForce, quote, thesisText, isRollingShortEligible, rollingShort,
    onSendToStrategist,
  ]);

  if (!isOpen) return null;

  const changePct = quote?.changePct;
  const changeColor = (changePct ?? 0) >= 0 ? UP : DOWN;

  const inputStyle = {
    color: WHITE, background: FIELD, border: `1px solid ${BORDER}`,
    fontSize: 13, fontFamily: SYS_FONT, borderRadius: 7,
  } as const;

  const companyName = companyNameFromQuote(quote);
  const expLabel0 = legs.length > 0 ? (() => {
    const clean = legs[0].expiration.split(":")[0].trim();
    const d = new Date(clean);
    if (isNaN(d.getTime())) return clean;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  })() : "";

  return (
    <div className="fixed inset-0 z-[210] flex flex-col" style={{ background: BG, fontFamily: SYS_FONT, fontWeight: 300 }}>

      <header className="shrink-0 flex items-center justify-between h-11 px-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onBack ?? onClose}
            className="flex items-center justify-center transition-colors active:opacity-70"
            style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${BORDER}`, background: "transparent", color: MUTED }}
            aria-label="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="leading-tight">
            <div className="text-[13px] tracking-[0.04em] font-medium" style={{ color: WHITE }}>ORDER TICKET</div>
            <div className="text-[11px]" style={{ color: MUTED }}>Options · {symbol}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-0.5" style={{ borderRadius: 999, border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.05)" }}>
            <span className="px-2 py-0.5 text-[11px] cursor-pointer" style={{ borderRadius: 999, background: `${GOLD}18`, color: GOLD }}>Options</span>
            <span
              className="px-2 py-0.5 text-[11px] cursor-pointer active:opacity-70"
              style={{ borderRadius: 999, color: TEXT }}
              onClick={(e) => { e.stopPropagation(); onSwitchToStock?.(); }}
            >Stock</span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center transition-colors active:opacity-70"
            style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${BORDER}`, background: "transparent", color: MUTED }}
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {stage === "success" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: "50%", background: `${UP}12`, border: `1px solid ${UP}40` }}>
            <CheckCircle2 className="w-8 h-8" style={{ color: UP }} />
          </div>
          <p className="text-[18px]" style={{ color: WHITE }}>Sent to Schwab</p>
          <p className="text-[17px] text-center" style={{ color: TEXT }}>
            {isCredit ? "Credit" : "Debit"} spread — {quantity} contract{quantity > 1 ? "s" : ""} of {symbol}
          </p>
          {orderId && <p className="text-[15px]" style={{ color: MUTED }}>Order ID: {orderId}</p>}
          <button onClick={onClose} className="mt-4 w-full max-w-xs text-[18px] transition-colors" style={{ height: 42, borderRadius: 999, background: CTA_GRAD, color: BG, border: "none", fontFamily: SYS_FONT }}>
            Done
          </button>
        </div>
      ) : stage === "submitting" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: GOLD }} />
          <p className="text-[18px]" style={{ color: TEXT }}>Submitting order…</p>
        </div>
      ) : stage === "error" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-14 h-14 flex items-center justify-center" style={{ borderRadius: "50%", background: `${DOWN}12`, border: `1px solid ${DOWN}40` }}>
            <AlertTriangle className="w-8 h-8" style={{ color: DOWN }} />
          </div>
          <p className="text-[18px]" style={{ color: WHITE }}>Order failed</p>
          <p className="text-[17px] text-center max-w-sm" style={{ color: DOWN }}>{errorMsg}</p>
          <div className="flex gap-2 mt-4 w-full max-w-xs">
            <button onClick={() => setStage("form")} className="flex-1 text-[17px]" style={{ height: 40, borderRadius: 999, background: "transparent", color: TEXT, border: `1px solid ${BORDER}` }}>Edit order</button>
            <button onClick={onClose} className="flex-1 text-[17px]" style={{ height: 40, borderRadius: 999, background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>Close</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto pb-40">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 10px 10px" }}>

              {/* instrument header */}
              <div className="flex items-center justify-between" style={{ background: CARD_GRAD, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "5px 10px" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold tracking-[0.06em]" style={{ color: GOLD }}>{symbol}</span>
                  <span className="text-[13px]" style={{ color: WHITE }}>{fmt(quote?.last)}</span>
                  <span className="text-[11px]" style={{ color: changeColor }}>
                    {changePct != null ? `${changePct >= 0 ? "+" : ""}${fmt(changePct)}%` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: MUTED }}>
                  {expLabel0 && <span>{expLabel0}</span>}
                  <span className="px-1.5 py-px" style={{ borderRadius: 10, border: `1px solid ${BORDER}`, color: TEXT, fontSize: 10 }}>
                    {accountHash ? "Schwab" : "No acct"}
                  </span>
                </div>
              </div>

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
                      placeholder="Describe your strategy (optional)"
                      rows={3}
                      maxLength={2000}
                      className="w-full px-3 py-2 resize-none"
                      style={{
                        background: FIELD,
                        border: `1px solid ${BORDER}`,
                        borderRadius: 10,
                        color: WHITE,
                        fontSize: 12,
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
                        <span style={{ fontSize: 12, color: TEXT }}>
                          Rolling short — short leg expires before long leg
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>

              {/* strategy summary */}
              {legs.length > 0 && (
                <div style={{ background: CARD_SOFT, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium" style={{ color: WHITE }}>{strategyId.name}</span>
                      <span className="text-[11px]" style={{ color: TEXT }}>
                        {legs.length}-leg {isCredit ? "credit" : "debit"}
                      </span>
                    </div>
                    <span className="text-[10px] px-1.5 py-px" style={{ borderRadius: 999, border: `1px solid ${isCredit ? `${UP}66` : `${DOWN}66`}`, background: isCredit ? `${UP}0a` : `${DOWN}0a`, color: isCredit ? UP : DOWN }}>
                      {isCredit ? "Credit" : "Debit"}
                    </span>
                  </div>

                  {strategyId.warning && (
                    <div className="mt-1 px-2 py-1 flex items-center gap-1.5" style={{ background: `${DOWN}20`, borderRadius: 6, border: `1px solid ${DOWN}50` }}>
                      <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: "#fff" }} />
                      <span className="text-[11px] leading-tight font-medium" style={{ color: "#fff" }}>Naked short — undefined risk. Add a protective leg.</span>
                    </div>
                  )}

                  {inlineWarnings.map((w, i) => (
                    <div key={i} className="mt-1 px-2 py-1 flex items-center gap-1.5" style={{
                      background: w.level === "red" ? `${DOWN}08` : w.level === "yellow" ? `${GOLD}08` : `${MUTED}08`,
                      borderRadius: 6,
                      border: `1px solid ${w.level === "red" ? `${DOWN}30` : w.level === "yellow" ? `${GOLD}30` : `${MUTED}30`}`,
                    }}>
                      <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: w.color }} />
                      <span className="text-[11px] leading-tight" style={{ color: w.color }}>{w.text}</span>
                    </div>
                  ))}

                  <div className="mt-1 grid grid-cols-4 gap-x-2 pt-1 text-[11px]" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                    <div>
                      <div style={{ color: MUTED }}>Net {isCredit ? "cr" : "dr"}</div>
                      <div className="text-[13px]" style={{ color: WHITE }}>{fmtCurrency(Math.abs(metrics.netDebit))}</div>
                    </div>
                    <div>
                      <div style={{ color: MUTED }}>Max risk</div>
                      <div className="text-[13px]" style={{ color: WHITE }}>{metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk) : "—"}</div>
                    </div>
                    <div>
                      <div style={{ color: MUTED }}>POP</div>
                      <div className="text-[13px]" style={{ color: TEXT }}>{metrics.pop != null ? `${metrics.pop.toFixed(0)}%` : "—"}</div>
                    </div>
                    <div>
                      <div style={{ color: MUTED }}>R:R</div>
                      <div className="text-[13px]" style={{ color: TEXT }}>{metrics.riskReward != null ? `${metrics.riskReward.toFixed(1)}:1` : "—"}</div>
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-1 pt-1 text-[11px]" style={{ borderTop: `1px dashed ${DIVIDER}`, color: MUTED }}>
                    <span>BE {metrics.breakevens.length > 0 ? metrics.breakevens.map(b => `$${b.toFixed(2)}`).join(" / ") : "—"}</span>
                    <span>BP {estimatedCost != null ? `−${fmtCurrency(Math.abs(estimatedCost))}` : "—"}</span>
                  </div>
                </div>
              )}

              {/* mode toggle */}
              <div className="inline-flex p-0.5 self-start" style={{ borderRadius: 999, border: `1px solid ${BORDER}`, background: "rgba(255,255,255,0.01)" }}>
                {(["templates", "builder"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="px-3 py-0.5 text-[12px] transition-all"
                    style={{
                      borderRadius: 999, border: "none",
                      color: mode === m ? GOLD : TEXT,
                      background: mode === m ? `${GOLD}16` : "transparent",
                    }}
                  >
                    {m === "templates" ? "Strategies" : "Leg builder"}
                  </button>
                ))}
              </div>

              {/* templates grid */}
              {mode === "templates" && (
                <div className="grid grid-cols-2 gap-2">
                  {STRATEGIES.map(tmpl => (
                    <button
                      key={tmpl.id}
                      onClick={() => applyTemplate(tmpl)}
                      className="p-3 text-left transition-all active:scale-[0.97]"
                      style={{ background: CARD_GRAD, borderRadius: R_CARD, border: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: tmpl.color }} />
                        <span className="text-[12px]" style={{ color: WHITE }}>{tmpl.name}</span>
                      </div>
                      <span className="text-[10px] leading-tight" style={{ color: MUTED }}>{tmpl.description}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* leg builder */}
              {mode === "builder" && (
                <div style={{ background: CARD_GRAD, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                  <div className="flex items-center justify-between text-[13px]" style={{ color: TEXT }}>
                    <span className="uppercase tracking-[0.06em]">Legs</span>
                    {legs.length < MAX_OPTION_LEGS && (
                      <button onClick={addLeg} className="text-[11px]" style={{ color: GOLD, background: "none", border: "none", cursor: "pointer" }}>+ Add leg</button>
                    )}
                    {legs.length >= MAX_OPTION_LEGS && (
                      <span className="text-[10px]" style={{ color: DIM }}>4/4 max</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {legs.map((leg) => {
                      const isBuy = leg.direction.startsWith("BUY");
                      const dirColor = isBuy ? UP : DOWN;
                      const isOpen = leg.direction.includes("OPEN");
                      const roleLabel = isOpen ? "OPEN" : "CLOSE";
                      const qtySign = isBuy ? "+" : "-";
                      const expLabel = (() => {
                        const clean = leg.expiration.split(":")[0].trim();
                        const d = new Date(clean);
                        if (isNaN(d.getTime())) return clean.slice(0, 9);
                        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        return `${months[d.getMonth()]} ${d.getFullYear()}`;
                      })();
                      const mid = (leg.bid != null && leg.ask != null) ? (leg.bid + leg.ask) / 2 : null;
                      return (
                        <div key={leg.id}>
                          <div
                            className="flex items-center justify-between px-2 py-1 cursor-pointer active:opacity-80"
                            style={{ borderRadius: 8, background: expandedLeg === leg.id ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)", border: `1px solid ${BORDER}70` }}
                            onClick={() => setExpandedLeg(expandedLeg === leg.id ? null : leg.id)}
                          >
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 text-[12px]">
                                <span className="text-[10px] tracking-[0.09em]" style={{ color: dirColor }}>{roleLabel}</span>
                                <span style={{ color: WHITE }}>{qtySign}{leg.quantity} · {leg.strike} {leg.optionType === "CALL" ? "Call" : "Put"} · {expLabel}</span>
                              </div>
                              <div className="text-[10px]" style={{ color: TEXT }}>{isBuy ? "Buy" : "Sell"} · {mid != null ? `Mark ${mid.toFixed(2)}` : "No data"}</div>
                            </div>
                            <div className="flex items-center gap-2 text-[10px]" style={{ color: TEXT }}>
                              <span>B {fmt(leg.bid)} / A {fmt(leg.ask)}</span>
                              <button onClick={(e) => { e.stopPropagation(); setExpandedLeg(expandedLeg === leg.id ? null : leg.id); }} className="text-[10px]" style={{ color: GOLD, background: "none", border: "none", cursor: "pointer" }}>Edit</button>
                              <button onClick={(e) => { e.stopPropagation(); removeLeg(leg.id); }} style={{ color: MUTED, background: "none", border: "none", cursor: "pointer" }} aria-label="Remove leg">
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>
                          {expandedLeg === leg.id && (
                            <div className="px-2 py-1.5 mt-0.5 space-y-1.5" style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, border: `1px solid ${BORDER}50` }}>
                              <div className="grid grid-cols-2 gap-1.5">
                                <div>
                                  <label className="text-[10px] block mb-px" style={{ color: MUTED }}>Direction</label>
                                  <select value={leg.direction} onChange={(e) => updateLeg(leg.id, { direction: e.target.value as LegDirection })} className="w-full px-1.5 py-1 text-[12px] outline-none" style={inputStyle}>
                                    <option value="BUY_TO_OPEN">Buy to Open</option>
                                    <option value="SELL_TO_OPEN">Sell to Open</option>
                                    <option value="BUY_TO_CLOSE">Buy to Close</option>
                                    <option value="SELL_TO_CLOSE">Sell to Close</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] block mb-px" style={{ color: MUTED }}>Type</label>
                                  <select value={leg.optionType} onChange={(e) => updateLeg(leg.id, { optionType: e.target.value as OptionType })} className="w-full px-1.5 py-1 text-[12px] outline-none" style={inputStyle}>
                                    <option value="CALL">Call</option>
                                    <option value="PUT">Put</option>
                                  </select>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-1.5">
                                <div>
                                  <label className="text-[10px] block mb-px" style={{ color: MUTED }}>Strike</label>
                                  {availableStrikes.length > 0 ? (
                                    <select value={leg.strike} onChange={(e) => updateLeg(leg.id, { strike: parseFloat(e.target.value) })} className="w-full px-1.5 py-1 text-[12px] outline-none" style={inputStyle}>
                                      {availableStrikes.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  ) : (
                                    <input type="number" step="0.5" value={leg.strike} onChange={(e) => updateLeg(leg.id, { strike: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 text-[12px] outline-none" style={inputStyle} />
                                  )}
                                </div>
                                <div>
                                  <label className="text-[10px] block mb-px" style={{ color: MUTED }}>Qty</label>
                                  <input type="number" min={1} value={leg.quantity} onChange={(e) => updateLeg(leg.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} className="w-full px-1.5 py-1 text-[12px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" style={inputStyle} />
                                </div>
                                <div>
                                  <label className="text-[10px] block mb-px" style={{ color: MUTED }}>Exp</label>
                                  {availableExpirations.length > 0 ? (
                                    <select value={leg.expiration} onChange={(e) => updateLeg(leg.id, { expiration: e.target.value })} className="w-full px-1.5 py-1 text-[12px] outline-none" style={inputStyle}>
                                      {availableExpirations.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                                    </select>
                                  ) : (
                                    <input type="text" value={leg.expiration} readOnly className="w-full px-1.5 py-1 text-[12px] outline-none" style={{ ...inputStyle, color: DIM }} />
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px]">
                                {[["Δ", leg.delta, 3], ["Γ", leg.gamma, 4], ["Θ", leg.theta, 3], ["V", leg.vega, 3]].map(([l, v, d]) => (
                                  <span key={l as string} style={{ color: MUTED }}>
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
                </div>
              )}

              {/* order controls */}
              {legs.length > 0 && (
                <div style={{ background: CARD_SOFT, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                  <div className="text-[13px] uppercase tracking-[0.06em] mb-1" style={{ color: TEXT }}>Order</div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="flex flex-col gap-px">
                      <span className="text-[10px]" style={{ color: MUTED }}>Order type</span>
                      <select
                        value="LIMIT"
                        disabled
                        className="w-full px-2 text-[12px] outline-none appearance-none cursor-pointer"
                        style={{ height: 26, borderRadius: 7, border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.4)", color: WHITE, WebkitAppearance: "none" }}
                      >
                        <option value="LIMIT">Limit</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-px">
                      <span className="text-[10px]" style={{ color: MUTED }}>Time in force</span>
                      <select
                        value={timeInForce}
                        onChange={(e) => setTimeInForce(e.target.value as "DAY" | "GTC")}
                        className="w-full px-2 text-[12px] outline-none appearance-none cursor-pointer"
                        style={{ height: 26, borderRadius: 7, border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.4)", color: WHITE, WebkitAppearance: "none" }}
                      >
                        <option value="DAY">DAY</option>
                        <option value="GTC">GTC</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-1.5 flex flex-col gap-px">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px]" style={{ color: MUTED }}>Net {isCredit ? "credit" : "debit"} price</span>
                      <button onClick={() => setPriceLocked(!priceLocked)} className="p-0.5" style={{ color: priceLocked ? GOLD : DIM, background: "none", border: "none", cursor: "pointer" }} aria-label={priceLocked ? "Unlock price" : "Lock price"}>
                        {priceLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-1" style={{ height: 28, borderRadius: 7, border: `1px solid ${priceLocked ? `${GOLD}4d` : BORDER}`, background: "rgba(0,0,0,0.4)", padding: "0 8px" }}>
                      <input
                        type="number" inputMode="decimal" step="0.01" value={limitPrice}
                        onChange={(e) => { if (!priceLocked) { setLimitPrice(e.target.value); setPriceError(""); } }}
                        placeholder="0.00"
                        className="flex-1 text-[13px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-right"
                        style={{ color: priceLocked ? GOLD : WHITE, border: "none", fontFamily: SYS_FONT }}
                        readOnly={priceLocked}
                      />
                      <span className="text-[10px]" style={{ color: MUTED }}>USD</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px]" style={{ color: TEXT }}>
                      <button
                        onClick={() => { if (!priceLocked && effectiveBid != null) setLimitPrice(effectiveBid.toFixed(2)); }}
                        disabled={priceLocked}
                        className="px-1.5 py-px"
                        style={{ borderRadius: 999, border: "1px solid transparent", opacity: priceLocked ? 0.4 : 1 }}
                      >Bid {effectiveBid != null ? fmt(effectiveBid) : "—"}</button>
                      <button
                        onClick={() => { if (!priceLocked) setMidPrice(); }}
                        disabled={priceLocked}
                        className="px-1.5 py-px"
                        style={{ borderRadius: 999, border: `1px solid ${GOLD}70`, background: `${GOLD}0a`, color: GOLD, opacity: priceLocked ? 0.4 : 1 }}
                      >Mid {midPrice != null ? fmt(midPrice) : "—"}</button>
                      <button
                        onClick={() => { if (!priceLocked) setNatPrice(); }}
                        disabled={priceLocked}
                        className="px-1.5 py-px"
                        style={{ borderRadius: 999, border: "1px solid transparent", opacity: priceLocked ? 0.4 : 1 }}
                      >Ask {effectiveAsk != null ? fmt(effectiveAsk) : "—"}</button>
                    </div>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[12px]">
                    <div>
                      <span className="text-[10px]" style={{ color: MUTED }}>Qty</span>
                      <span className="ml-1 text-[10px]" style={{ color: TEXT }}>Spreads · 100sh/ct</span>
                    </div>
                    <div className="inline-flex items-center" style={{ borderRadius: 14, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
                      <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="flex items-center justify-center transition-colors active:opacity-70" style={{ width: 24, height: 22, color: TEXT, background: "transparent", border: "none" }}>
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number" inputMode="numeric" value={quantity}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) setQuantity(v); }}
                        className="text-center text-[12px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ color: WHITE, minWidth: 26, width: 26, border: "none", fontFamily: SYS_FONT }}
                      />
                      <button onClick={() => setQuantity(quantity + 1)} className="flex items-center justify-center transition-colors active:opacity-70" style={{ width: 24, height: 22, color: TEXT, background: "transparent", border: "none" }}>
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-1 pt-1 text-[11px]" style={{ borderTop: `1px dashed ${DIVIDER}`, color: MUTED }}>
                    <span>Total {isCredit ? "cr" : "cost"} {estimatedCost != null ? fmtCurrency(Math.abs(estimatedCost)) : "—"}</span>
                    <span>Max risk {metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk) : "—"}</span>
                    <span>Fees $0.65/ct</span>
                  </div>
                </div>
              )}

              {/* advanced settings */}
              {legs.length > 0 && (
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
                        <span className="text-[12px]" style={{ color: WHITE }}>DAY</span>
                      </div>
                      <div className="px-2 py-1 flex items-center justify-between" style={{ background: FIELD, border: `1px solid ${BORDER}`, borderRadius: 7 }}>
                        <div>
                          <span className="text-[10px] block" style={{ color: MUTED }}>Ext Hrs</span>
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
              )}

              {/* risk overview */}
              {legs.length > 0 && (
                <div style={{ background: CARD_SOFT, borderRadius: 10, border: `1px solid ${BORDER}`, padding: "6px 10px" }}>
                  <button
                    type="button"
                    onClick={() => setRiskCollapsed(v => !v)}
                    className="flex w-full items-center justify-between text-[13px]"
                    style={{ color: TEXT, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    <span className="uppercase tracking-[0.06em]">Risk overview</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: MUTED }}>
                        Loss {metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk) : "—"} · POP {metrics.pop != null ? `${metrics.pop.toFixed(0)}%` : "—"} · Mgn {metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk * 0.2) : "—"}
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
                      <div className="relative h-20 overflow-hidden" style={{ borderRadius: 8, border: `1px dashed ${BORDER}`, background: `linear-gradient(to bottom, #1d222e, #090b10)` }}>
                        <div className="absolute inset-1.5" style={{ borderBottom: `1px solid ${TEXT}60`, borderLeft: `1px solid ${TEXT}60` }} />
                        {(() => {
                          const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
                          const lo = strikes[0] - (strikes[strikes.length - 1] - strikes[0]) * 0.8;
                          const hi = strikes[strikes.length - 1] + (strikes[strikes.length - 1] - strikes[0]) * 0.8;
                          const range = hi - lo || 1;
                          const steps = 60;
                          const pnlAtPrice = (price: number) => {
                            let pnl = 0;
                            for (const leg of legs) {
                              const isBuy = leg.direction.startsWith("BUY");
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
                          let minPnl = Infinity, maxPnl = -Infinity;
                          for (let i = 0; i <= steps; i++) {
                            const price = lo + (range * i) / steps;
                            const pnl = pnlAtPrice(price);
                            pts.push({ x: i, y: pnl });
                            if (pnl < minPnl) minPnl = pnl;
                            if (pnl > maxPnl) maxPnl = pnl;
                          }
                          const padY = Math.max(Math.abs(maxPnl - minPnl) * 0.15, 10);
                          const yLo = minPnl - padY;
                          const yHi = maxPnl + padY;
                          const yRange = yHi - yLo || 1;
                          const zeroY = ((yHi - 0) / yRange) * 100;
                          const toSvgX = (i: number) => (8 + (i / steps) * 84).toFixed(1);
                          const toSvgY = (pnl: number) => (8 + ((yHi - pnl) / yRange) * 84).toFixed(1);
                          const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toSvgX(p.x)},${toSvgY(p.y)}`).join(" ");
                          const fillPath = `${linePath} L${toSvgX(steps)},${toSvgY(0)} L${toSvgX(0)},${toSvgY(0)} Z`;
                          return (
                            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="payoffGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={UP} stopOpacity="0.35" />
                                  <stop offset={`${zeroY}%`} stopColor={UP} stopOpacity="0.05" />
                                  <stop offset={`${zeroY}%`} stopColor={DOWN} stopOpacity="0.05" />
                                  <stop offset="100%" stopColor={DOWN} stopOpacity="0.3" />
                                </linearGradient>
                              </defs>
                              <line x1="8" y1={toSvgY(0)} x2="92" y2={toSvgY(0)} stroke={TEXT} strokeOpacity="0.25" strokeWidth="0.3" strokeDasharray="1.5,1" />
                              <path d={fillPath} fill="url(#payoffGrad)" />
                              <path d={linePath} fill="none" stroke={isCredit ? UP : GOLD} strokeWidth="0.7" />
                            </svg>
                          );
                        })()}
                        <div className="absolute bottom-0.5 right-1.5 text-[9px]" style={{ color: MUTED }}>P/L at exp</div>
                      </div>

                      <div className="text-[11px]" style={{ color: TEXT }}>
                        {isCredit ? "Max profit if price stays between strikes" : "Max profit past breakeven"}.
                        Risk: {metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk) : "undef"}.
                        {metrics.breakevens.length > 0 && ` BE: ${metrics.breakevens.map(b => `$${b.toFixed(2)}`).join(" / ")}`}
                      </div>

                      <div className="flex items-center gap-3 pt-1 text-[11px]" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                        {([
                          ["D", metrics.totalDelta, 3],
                          ["G", metrics.totalGamma, 4],
                          ["T", metrics.totalTheta, 3],
                          ["V", metrics.totalVega, 3],
                        ] as [string, number, number][]).map(([label, val, dec]) => (
                          <span key={label} style={{ color: MUTED }}>
                            {label} <span style={{ color: TEXT }}>{fmt(val, dec)}</span>
                          </span>
                        ))}
                      </div>

                      {preTradeEnabled && riskChecks.length > 0 && (
                        <div className="mt-1 pt-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                          <div className="space-y-0.5 text-[11px]">
                            {riskChecks.map(c => (
                              <div key={c.id} className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: levelColor(c.level) }} />
                                <span style={{ color: TEXT }}>{c.label}</span>
                                <span style={{ color: MUTED }}>{c.detail}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-1 pt-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <Sparkles className="w-2.5 h-2.5" style={{ color: GOLD }} />
                          <span className="text-[11px]" style={{ color: TEXT }}>AI co-pilot</span>
                        </div>
                        <div className="space-y-0.5">
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
                                if (spreadPct > 5) tips.push({ text: `Wide b/a (${spreadPct.toFixed(1)}%) — use limits`, type: "warn" });
                                const fillProb = lp >= effectiveAsk ? 99 : lp >= spreadPrices.spreadMid ? 78 : lp >= effectiveBid ? 45 : 15;
                                tips.push({ text: `Fill prob ~${fillProb}% at $${lp.toFixed(2)}`, type: "info" });
                              }
                            }
                            if (tips.length === 0) {
                              tips.push({ text: `${legs.length}-leg ${isCredit ? "credit" : "debit"} on ${symbol} — review before submit`, type: "info" });
                            }
                            return tips.map((s, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <div className="w-1 h-1 rounded-full shrink-0" style={{ background: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : UP }} />
                                <span className="text-[11px] leading-snug" style={{ color: s.type === "warn" ? DOWN : s.type === "tip" ? GOLD : TEXT }}>{s.text}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>

          {/* bottom CTA */}
          {legs.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 px-3 pb-6 pt-2" style={{ background: `linear-gradient(to top, rgba(5,6,7,1), rgba(5,6,7,0.95), transparent)` }}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-[11px]" style={{ color: TEXT }}>
                <span>{quantity} spread{quantity !== 1 ? "s" : ""} · {isCredit ? "Cr" : "Cost"} {estimatedCost != null ? fmtCurrency(Math.abs(estimatedCost)) : "—"}</span>
                <span>Risk {metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk) : "—"}</span>
                <span>POP {metrics.pop != null ? `${metrics.pop.toFixed(0)}%` : "—"}</span>
                {preTradeEnabled && <span style={{ color: levelColor(overallRisk) }}>{overallRisk === "GREEN" ? "PASS" : overallRisk === "YELLOW" ? "WARN" : "FAIL"}</span>}
              </div>
              {blockedByRisk && (
                <div className="mb-1 px-2 py-1 flex items-center gap-1.5 text-[11px]" style={{ background: `${DOWN}08`, border: `1px solid ${DOWN}4d`, borderRadius: 8 }}>
                  <ShieldX className="w-3 h-3 shrink-0" style={{ color: DOWN }} />
                  <span style={{ color: DOWN }}>Risk check failed — order blocked</span>
                </div>
              )}
              {priceError && (
                <div className="mb-1 px-2 py-1 flex items-center gap-1.5 text-[11px]" style={{ background: `${DOWN}08`, border: `1px solid ${DOWN}4d`, borderRadius: 8 }}>
                  <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: DOWN }} />
                  <span style={{ color: DOWN }}>{priceError}</span>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="text-[15px] tracking-[0.04em] active:scale-[0.98] transition-all duration-150"
                  style={{
                    flex: 1,
                    height: 42,
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
                    else validateAndReview();
                  }}
                  disabled={!isValid || (sendMode === "strategist" && strategistDispatchInFlight)}
                  className="text-[16px] tracking-[0.04em] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    flex: 2,
                    height: 42,
                    borderRadius: 999,
                    border: "none",
                    background: !isValid
                      ? BORDER
                      : sendMode === "strategist"
                        ? "linear-gradient(135deg, #5ad1c0, #3aa899)"
                        : CTA_GRAD,
                    color: !isValid ? DIM : BG,
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

          {/* review modal */}
          {stage === "review" && (
            <div className="fixed inset-0 z-[220] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
              <div className="w-full max-w-lg p-3 space-y-2 animate-in slide-in-from-bottom duration-300" style={{ background: BG, borderRadius: "16px 16px 0 0", border: `1px solid ${BORDER}`, borderBottom: "none" }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-medium" style={{ color: WHITE }}>Order Confirmation</h3>
                  <button onClick={() => setStage("form")} className="w-6 h-6 flex items-center justify-center" style={{ borderRadius: "50%", border: `1px solid ${BORDER}`, background: "transparent", color: MUTED }} aria-label="Close review">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-1 p-2.5" style={{ background: CARD_GRAD, borderRadius: 10, border: `1px solid ${BORDER}` }}>
                  <div className="flex justify-between text-[12px]">
                    <span style={{ color: MUTED }}>Strategy</span>
                    <span style={{ color: strategyId.color }}>{strategyId.name}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span style={{ color: MUTED }}>Order type</span>
                    <span style={{ color: WHITE }}>Limit</span>
                  </div>
                  {legs.map((leg, i) => {
                    const isBuy = leg.direction.startsWith("BUY");
                    const dirLabel = isBuy ? (leg.direction === "BUY_TO_OPEN" ? "BTO" : "BTC") : (leg.direction === "SELL_TO_OPEN" ? "STO" : "STC");
                    return (
                      <div key={i} className="flex items-center text-[12px]" style={{ height: 18 }}>
                        <span style={{ color: isBuy ? UP : DOWN, width: 28 }}>{dirLabel}</span>
                        <span style={{ color: isBuy ? UP : DOWN, width: 22 }}>{isBuy ? "+" : "-"}{leg.quantity * quantity}</span>
                        <span className="flex-1" style={{ color: TEXT }}>{leg.strike} {leg.optionType === "CALL" ? "Call" : "Put"}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between pt-1 text-[12px]" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                    <span style={{ color: MUTED }}>Net price</span>
                    <span style={{ color: WHITE }}>${limitPrice}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span style={{ color: MUTED }}>Duration</span>
                    <span style={{ color: WHITE }}>{timeInForce}{extendedHours ? " + Ext" : ""}</span>
                  </div>
                  {(() => {
                    const totalContracts = legs.reduce((sum, l) => sum + l.quantity, 0) * quantity;
                    const totalCommission = totalContracts * 0.65;
                    const px = parseFloat(limitPrice) || 0;
                    const grossCost = estimatedCost != null ? Math.abs(estimatedCost) : 0;
                    const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
                    const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : 0;
                    const allCalls = legs.every(l => l.optionType === "CALL");
                    const allPuts = legs.every(l => l.optionType === "PUT");
                    const breakevens: number[] = [];
                    if (legs.length === 2 && width > 0) {
                      const sellLeg = legs.find(l => l.direction.startsWith("SELL"));
                      if (sellLeg) {
                        if (allPuts) breakevens.push(sellLeg.strike - (isCredit ? px : -px));
                        else if (allCalls) breakevens.push(sellLeg.strike + (isCredit ? px : -px));
                      }
                    } else if (legs.length === 2 && !allCalls && !allPuts) {
                      const callLeg = legs.find(l => l.optionType === "CALL");
                      const putLeg = legs.find(l => l.optionType === "PUT");
                      if (callLeg && putLeg) {
                        breakevens.push(putLeg.strike - px);
                        breakevens.push(callLeg.strike + px);
                      }
                    }
                    const maxProfit = width > 0
                      ? (isCredit ? px * 100 * quantity : (width - px) * 100 * quantity)
                      : (isCredit ? px * 100 * quantity : null);
                    const maxLoss = width > 0
                      ? (isCredit ? (width - px) * 100 * quantity : px * 100 * quantity)
                      : (isCredit ? null : px * 100 * quantity);
                    const bpEffect = isCredit
                      ? -((width - px) * 100 * quantity + totalCommission)
                      : -(px * 100 * quantity + totalCommission);
                    return (
                      <>
                        <div className="pt-1 mt-0.5 space-y-0.5" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                          <div className="flex justify-between text-[12px]">
                            <span style={{ color: MUTED }}>Net {isCredit ? "credit" : "debit"}</span>
                            <span style={{ color: WHITE }}>{fmtCurrency(grossCost)}</span>
                          </div>
                          <div className="flex justify-between text-[12px]">
                            <span style={{ color: MUTED }}>Commissions ({totalContracts} × $0.65)</span>
                            <span style={{ color: WHITE }}>{fmtCurrency(totalCommission)}</span>
                          </div>
                          <div className="flex justify-between pt-1" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                            <span className="text-[12px]" style={{ color: TEXT, fontWeight: 500 }}>Total {isCredit ? "credit" : "cost"}</span>
                            <span className="text-[14px] font-semibold" style={{ color: WHITE }}>
                              {fmtCurrency(isCredit ? grossCost - totalCommission : grossCost + totalCommission)}
                            </span>
                          </div>
                        </div>
                        {(breakevens.length > 0 || maxProfit != null || maxLoss != null) && (
                          <div className="pt-1 mt-0.5 space-y-0.5" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                            {breakevens.length > 0 && (
                              <div className="flex justify-between text-[12px]">
                                <span style={{ color: MUTED }}>Breakeven{breakevens.length > 1 ? "s" : ""}</span>
                                <span style={{ color: WHITE }}>{breakevens.map(b => `$${b.toFixed(2)}`).join(" / ")}</span>
                              </div>
                            )}
                            {maxProfit != null && (
                              <div className="flex justify-between text-[12px]">
                                <span style={{ color: MUTED }}>Max profit</span>
                                <span style={{ color: UP }}>{fmtCurrency(maxProfit)}</span>
                              </div>
                            )}
                            {maxLoss != null && (
                              <div className="flex justify-between text-[12px]">
                                <span style={{ color: MUTED }}>Max loss</span>
                                <span style={{ color: DOWN }}>{fmtCurrency(maxLoss)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="pt-1 mt-0.5" style={{ borderTop: `1px dashed ${DIVIDER}` }}>
                          <div className="flex justify-between text-[12px]">
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
                <div className="px-2 py-1.5 flex items-center gap-1.5" style={{ background: `${GOLD}08`, borderRadius: 8, border: `1px solid ${GOLD}1a` }}>
                  <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: GOLD }} />
                  <p className="text-[11px] leading-tight" style={{ color: `${GOLD}cc` }}>
                    Live order via Schwab. Verify all details.
                  </p>
                </div>
                <div className="flex gap-2 pt-0.5 pb-3">
                  <button onClick={() => setStage("form")} className="flex-1 text-[13px]" style={{ height: 36, background: "transparent", color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 999 }}>Back</button>
                  <button
                    onClick={handleSubmit}
                    className="flex-[2] text-[18px] tracking-[0.04em] active:scale-[0.98] transition-transform"
                    style={{ height: 42, borderRadius: 999, border: "none", background: CTA_GRAD, color: BG, fontFamily: SYS_FONT }}
                  >
                    Send to Schwab
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
