import { useState, useMemo, useCallback, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { X, Plus, Trash2, ChevronDown, ArrowRight, Shield, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";

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

type OptionType = "CALL" | "PUT";
type LegDirection = "BUY_TO_OPEN" | "SELL_TO_OPEN" | "BUY_TO_CLOSE" | "SELL_TO_CLOSE";
type RiskLevel = "GREEN" | "YELLOW" | "RED";

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
      maxRisk = netDebit;
      maxReward = width - netDebit;
      breakevens = [longCalls[0].strike + netDebit / 100];
    } else {
      maxRisk = width + netDebit;
      maxReward = -netDebit;
      breakevens = [shortCalls[0].strike + netDebit / 100];
    }
  } else if (longPuts.length === 1 && shortPuts.length === 1 && calls.length === 0) {
    const width = Math.abs(longPuts[0].strike - shortPuts[0].strike) * 100;
    if (isDebit) {
      maxRisk = netDebit;
      maxReward = width - netDebit;
      breakevens = [longPuts[0].strike - netDebit / 100];
    } else {
      maxRisk = width + netDebit;
      maxReward = -netDebit;
      breakevens = [shortPuts[0].strike - netDebit / 100];
    }
  } else if (longCalls.length === 1 && longPuts.length === 1 && shortCalls.length === 0 && shortPuts.length === 0) {
    maxRisk = netDebit;
    maxReward = null;
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
    if (isDebit) {
      maxRisk = netDebit;
    }
  }

  const riskReward = (maxRisk != null && maxReward != null && maxRisk > 0) ? maxReward / maxRisk : null;

  const pop = totalDelta !== 0 ? Math.abs(1 - Math.abs(totalDelta)) * 100 : null;

  return {
    netDebit,
    isDebit,
    maxRisk,
    maxReward,
    breakevens: breakevens.filter(b => !isNaN(b)),
    totalDelta,
    totalGamma,
    totalTheta,
    totalVega,
    riskReward,
    pop,
    hasPrices,
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
    const avgIV = legs.reduce((s, l) => s + (l.iv ?? 0), 0) / legs.length;
    const selling = legs.filter(l => l.direction.startsWith("SELL")).length >= legs.filter(l => l.direction.startsWith("BUY")).length;
    if (avgIV > 0.5 && selling) {
      checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: `Avg IV ${(avgIV * 100).toFixed(0)}% — selling premium` });
    } else if (avgIV > 0.5 && !selling) {
      checks.push({ id: "vol", label: "Vol Environment", level: "YELLOW", detail: `Avg IV ${(avgIV * 100).toFixed(0)}% — buying expensive` });
    } else {
      checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: `Avg IV ${(avgIV * 100).toFixed(0)}%` });
    }
  } else {
    checks.push({ id: "vol", label: "Vol Environment", level: "GREEN", detail: "No IV data" });
  }

  const minDTE = Math.min(...legs.map(l => {
    const d = new Date(l.expiration.split(":")[0]);
    return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
  }));
  if (minDTE < 3) {
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
  onSendToOrderTicket: (legs: StrategyLeg[], netPrice: number, isCredit: boolean) => void;
  initialLegs?: StrategyLeg[];
  availableStrikes?: number[];
  availableExpirations?: { label: string; value: string }[];
  chainData?: Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>;
}

export function StrategyBuilder({
  isOpen,
  onClose,
  onSendToOrderTicket,
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

  useEffect(() => {
    if (isOpen) {
      if (initialLegs && initialLegs.length > 0) {
        setLegs(initialLegs);
        setMode("builder");
      } else {
        setLegs([]);
        setMode("templates");
      }
    }
  }, [isOpen, initialLegs]);

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
    return {
      ...leg,
      id: nextLegId(),
      schwabSymbol,
      bid: cd?.bid,
      ask: cd?.ask,
      delta: cd?.delta,
      gamma: cd?.gamma,
      theta: cd?.theta,
      vega: cd?.vega,
      iv: cd?.iv,
    };
  }, [buildSchwabSymbol, chainData]);

  const applyTemplate = useCallback((tmpl: StrategyTemplate) => {
    const rawLegs = tmpl.buildLegs(atmStrike, strikeWidth, defaultExp);
    const enrichedLegs = rawLegs.map(l => enrichLeg(l));
    setLegs(enrichedLegs);
    setMode("builder");
  }, [atmStrike, strikeWidth, defaultExp, enrichLeg]);

  const addLeg = useCallback(() => {
    const newLeg = enrichLeg({
      optionType: "CALL",
      direction: "BUY_TO_OPEN",
      strike: atmStrike,
      expiration: defaultExp,
      quantity: 1,
    });
    setLegs(prev => [...prev, newLeg]);
  }, [atmStrike, defaultExp, enrichLeg]);

  const removeLeg = useCallback((id: string) => {
    setLegs(prev => prev.filter(l => l.id !== id));
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
        updated.bid = cd?.bid;
        updated.ask = cd?.ask;
        updated.delta = cd?.delta;
        updated.gamma = cd?.gamma;
        updated.theta = cd?.theta;
        updated.vega = cd?.vega;
        updated.iv = cd?.iv;
      }
      return updated;
    }));
  }, [buildSchwabSymbol, chainData]);

  const metrics = useMemo(() => computeStrategyMetrics(legs), [legs]);
  const riskChecks = useMemo(() => {
    if (!preTradeEnabled || legs.length === 0) return [];
    return runStrategyRiskChecks({
      legs,
      maxRisk: metrics.maxRisk,
      netDebit: metrics.netDebit,
      riskReward: metrics.riskReward,
      regime: pulseData?.structuralRegime?.label ?? null,
      sessionBias: pulseData?.sessionBias?.label ?? null,
      accountSize,
      preTradeMaxPositionPct,
      preTradeMinRR,
      totalDelta: metrics.totalDelta,
    });
  }, [preTradeEnabled, legs, metrics, pulseData, accountSize, preTradeMaxPositionPct, preTradeMinRR]);

  const overallRisk = useMemo(() => getOverallLevel(riskChecks), [riskChecks]);
  const blockedByRisk = preTradeEnabled && preTradeBlockOnRed && overallRisk === "RED";

  const handleSend = useCallback(() => {
    if (legs.length === 0 || blockedByRisk) return;
    const isCredit = metrics.netDebit < 0;
    const netPrice = Math.abs(metrics.netDebit) / 100;
    onSendToOrderTicket(legs, netPrice, isCredit);
  }, [legs, metrics, onSendToOrderTicket, blockedByRisk]);

  if (!isOpen) return null;

  const changePct = quote?.changePct;
  const changeColor = (changePct ?? 0) >= 0 ? UP : DOWN;

  return (
    <div className="fixed inset-0 z-[210] flex flex-col" style={{ background: BG }}>
      <header className="shrink-0 flex items-center h-12 px-4 border-b" style={{ borderColor: BORDER, background: "#111113" }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-light text-[15px] tracking-wide" style={{ color: WHITE }}>{symbol}</span>
            <span className="font-mono text-[13px]" style={{ color: changeColor }}>
              {fmt(quote?.last)} {changePct != null ? `${changePct >= 0 ? "+" : ""}${fmt(changePct)}%` : ""}
            </span>
          </div>
        </div>
        <span className="font-mono font-light text-[11px] tracking-widest mr-4" style={{ color: MUTED }}>STRATEGY BUILDER</span>
        <button onClick={onClose} className="p-2 -mr-2 rounded-lg transition-colors active:text-white" style={{ color: MUTED }}>
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pb-32">
        <div className="p-4 space-y-4">
          <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER2}` }}>
            {(["templates", "builder"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-2.5 font-mono text-[12px] font-light tracking-wider transition-all"
                style={{
                  color: mode === m ? GOLD : DIM,
                  background: mode === m ? "rgba(255,184,0,0.08)" : "transparent",
                  borderBottom: `2px solid ${mode === m ? GOLD : "transparent"}`,
                }}
              >
                {m === "templates" ? "QUICK STRATEGIES" : "LEG BUILDER"}
              </button>
            ))}
          </div>

          {mode === "templates" && (
            <div className="grid grid-cols-2 gap-2">
              {STRATEGIES.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => applyTemplate(tmpl)}
                  className="rounded-xl p-3 text-left transition-all active:scale-[0.97]"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: tmpl.color }} />
                    <span className="font-mono text-[11px] font-light" style={{ color: WHITE }}>{tmpl.name}</span>
                  </div>
                  <span className="font-mono text-[9px]" style={{ color: DIM }}>{tmpl.description}</span>
                </button>
              ))}
            </div>
          )}

          {mode === "builder" && (
            <div className="space-y-3">
              {legs.map((leg, idx) => (
                <div key={leg.id} className="rounded-xl p-3 space-y-2" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-light" style={{ color: GOLD }}>LEG {idx + 1}</span>
                    <button onClick={() => removeLeg(leg.id)} className="p-1 rounded transition-colors" style={{ color: DOWN }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-mono text-[9px] tracking-wider block mb-1" style={{ color: DIM }}>DIRECTION</label>
                      <select
                        value={leg.direction}
                        onChange={(e) => updateLeg(leg.id, { direction: e.target.value as LegDirection })}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-[11px] bg-transparent outline-none"
                        style={{ color: TEXT, background: "#1a1a1e", border: `1px solid ${BORDER2}` }}
                      >
                        <option value="BUY_TO_OPEN">Buy to Open</option>
                        <option value="SELL_TO_OPEN">Sell to Open</option>
                        <option value="BUY_TO_CLOSE">Buy to Close</option>
                        <option value="SELL_TO_CLOSE">Sell to Close</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-mono text-[9px] tracking-wider block mb-1" style={{ color: DIM }}>TYPE</label>
                      <select
                        value={leg.optionType}
                        onChange={(e) => updateLeg(leg.id, { optionType: e.target.value as OptionType })}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-[11px] bg-transparent outline-none"
                        style={{ color: TEXT, background: "#1a1a1e", border: `1px solid ${BORDER2}` }}
                      >
                        <option value="CALL">Call</option>
                        <option value="PUT">Put</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="font-mono text-[9px] tracking-wider block mb-1" style={{ color: DIM }}>STRIKE</label>
                      {availableStrikes.length > 0 ? (
                        <select
                          value={leg.strike}
                          onChange={(e) => updateLeg(leg.id, { strike: parseFloat(e.target.value) })}
                          className="w-full px-2 py-1.5 rounded-lg font-mono text-[11px] bg-transparent outline-none"
                          style={{ color: TEXT, background: "#1a1a1e", border: `1px solid ${BORDER2}` }}
                        >
                          {availableStrikes.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number" step="0.5" value={leg.strike}
                          onChange={(e) => updateLeg(leg.id, { strike: parseFloat(e.target.value) || 0 })}
                          className="w-full px-2 py-1.5 rounded-lg font-mono text-[11px] bg-transparent outline-none"
                          style={{ color: TEXT, background: "#1a1a1e", border: `1px solid ${BORDER2}` }}
                        />
                      )}
                    </div>
                    <div>
                      <label className="font-mono text-[9px] tracking-wider block mb-1" style={{ color: DIM }}>QTY</label>
                      <input
                        type="number" min={1} value={leg.quantity}
                        onChange={(e) => updateLeg(leg.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                        className="w-full px-2 py-1.5 rounded-lg font-mono text-[11px] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        style={{ color: TEXT, background: "#1a1a1e", border: `1px solid ${BORDER2}` }}
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[9px] tracking-wider block mb-1" style={{ color: DIM }}>EXP</label>
                      {availableExpirations.length > 0 ? (
                        <select
                          value={leg.expiration}
                          onChange={(e) => updateLeg(leg.id, { expiration: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-lg font-mono text-[11px] bg-transparent outline-none"
                          style={{ color: TEXT, background: "#1a1a1e", border: `1px solid ${BORDER2}` }}
                        >
                          {availableExpirations.map(e => (
                            <option key={e.value} value={e.value}>{e.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text" value={leg.expiration} readOnly
                          className="w-full px-2 py-1.5 rounded-lg font-mono text-[11px] bg-transparent outline-none"
                          style={{ color: DIM, background: "#1a1a1e", border: `1px solid ${BORDER2}` }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex gap-3">
                      <span className="font-mono text-[9px]" style={{ color: DIM }}>
                        Bid <span style={{ color: leg.bid != null ? UP : DIM }}>{fmt(leg.bid)}</span>
                      </span>
                      <span className="font-mono text-[9px]" style={{ color: DIM }}>
                        Ask <span style={{ color: leg.ask != null ? DOWN : DIM }}>{fmt(leg.ask)}</span>
                      </span>
                      <span className="font-mono text-[9px]" style={{ color: DIM }}>
                        \u0394 <span style={{ color: TEXT }}>{fmt(leg.delta, 3)}</span>
                      </span>
                    </div>
                    <span className="font-mono text-[9px] font-light" style={{ color: leg.direction.startsWith("BUY") ? UP : DOWN }}>
                      {leg.direction.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              ))}

              <button
                onClick={addLeg}
                className="w-full py-2.5 rounded-xl font-mono text-[11px] font-light tracking-wider flex items-center justify-center gap-1.5 transition-colors active:opacity-70"
                style={{ color: GOLD, background: "rgba(255,184,0,0.06)", border: `1px solid rgba(255,184,0,0.2)` }}
              >
                <Plus className="w-3.5 h-3.5" /> ADD LEG
              </button>
            </div>
          )}

          {legs.length > 0 && (
            <>
              <div className="rounded-xl p-4 space-y-2" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                <span className="font-mono text-[10px] font-light tracking-wider" style={{ color: GOLD }}>STRATEGY PREVIEW</span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Net {metrics.isDebit ? "Debit" : "Credit"}</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: metrics.isDebit ? DOWN : UP }}>
                      {fmtCurrency(Math.abs(metrics.netDebit))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>R:R</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: TEXT }}>
                      {metrics.riskReward != null ? `${metrics.riskReward.toFixed(1)}:1` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Max Risk</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: DOWN }}>
                      {metrics.maxRisk != null ? fmtCurrency(metrics.maxRisk) : "Undefined"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-[10px]" style={{ color: MUTED }}>Max Reward</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: UP }}>
                      {metrics.maxReward != null ? fmtCurrency(metrics.maxReward) : "Unlimited"}
                    </span>
                  </div>
                  {metrics.breakevens.length > 0 && (
                    <div className="flex justify-between col-span-2">
                      <span className="font-mono text-[10px]" style={{ color: MUTED }}>Breakeven{metrics.breakevens.length > 1 ? "s" : ""}</span>
                      <span className="font-mono text-[11px]" style={{ color: TEXT }}>
                        {metrics.breakevens.map(b => `$${b.toFixed(2)}`).join(" / ")}
                      </span>
                    </div>
                  )}
                  {metrics.pop != null && (
                    <div className="flex justify-between">
                      <span className="font-mono text-[10px]" style={{ color: MUTED }}>Est. PoP</span>
                      <span className="font-mono text-[11px] font-light" style={{ color: TEXT }}>{metrics.pop.toFixed(0)}%</span>
                    </div>
                  )}
                </div>
                <div className="border-t my-2" style={{ borderColor: BORDER }} />
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center">
                    <span className="font-mono text-[8px] uppercase tracking-widest block" style={{ color: DIM }}>\u0394</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: TEXT }}>{fmt(metrics.totalDelta, 3)}</span>
                  </div>
                  <div className="text-center">
                    <span className="font-mono text-[8px] uppercase tracking-widest block" style={{ color: DIM }}>\u0393</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: TEXT }}>{fmt(metrics.totalGamma, 4)}</span>
                  </div>
                  <div className="text-center">
                    <span className="font-mono text-[8px] uppercase tracking-widest block" style={{ color: DIM }}>\u0398</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: metrics.totalTheta > 0 ? UP : DOWN }}>{fmt(metrics.totalTheta, 3)}</span>
                  </div>
                  <div className="text-center">
                    <span className="font-mono text-[8px] uppercase tracking-widest block" style={{ color: DIM }}>V</span>
                    <span className="font-mono text-[11px] font-light" style={{ color: TEXT }}>{fmt(metrics.totalVega, 3)}</span>
                  </div>
                </div>
              </div>

              {preTradeEnabled && riskChecks.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4" style={{ color: GOLD }} />
                      <span className="font-mono text-[10px] font-light tracking-wider" style={{ color: GOLD }}>PRE-TRADE RISK CHECK</span>
                    </div>
                  </div>
                  <div className="w-full h-1" style={{ background: levelColor(overallRisk) }} />
                  <div className="px-4 py-2 space-y-1">
                    {riskChecks.map(c => (
                      <div key={c.id} className="flex items-center gap-2 py-0.5">
                        <RiskIcon level={c.level} />
                        <span className="font-mono text-[10px] font-light" style={{ color: TEXT, minWidth: 80 }}>{c.label}</span>
                        <span className="font-mono text-[9px] flex-1 text-right truncate" style={{ color: levelColor(c.level) }}>{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {legs.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-8" style={{ background: `linear-gradient(transparent, ${BG} 20%)` }}>
          {blockedByRisk && (
            <div className="mb-2 rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: "rgba(242,54,69,0.08)", border: "1px solid rgba(242,54,69,0.2)" }}>
              <ShieldX className="w-4 h-4 shrink-0" style={{ color: DOWN }} />
              <span className="font-mono text-[10px]" style={{ color: DOWN }}>Risk check failed — order blocked</span>
            </div>
          )}
          <button
            onClick={handleSend}
            disabled={blockedByRisk || legs.length === 0}
            className="w-full py-4 rounded-xl font-mono text-[14px] font-light tracking-wider flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{
              background: !blockedByRisk ? `linear-gradient(180deg, ${GOLD} 0%, #d4a000 100%)` : BORDER2,
              color: !blockedByRisk ? "#000" : DIM,
              boxShadow: !blockedByRisk ? "0 4px 20px rgba(255,184,0,0.3)" : "none",
            }}
          >
            SEND TO ORDER TICKET <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
