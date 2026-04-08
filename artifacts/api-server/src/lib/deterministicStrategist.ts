import { checkEventConflicts, type EventCheckResult, type EventConflict } from "./calendarEventChecker.js";
import { logFailure } from "./telemetry.js";

const SCHWAB_TRADER = "https://api.schwabapi.com/trader/v1";

export type TradingMode =
  | "HIGH_CONVICTION_DIRECTIONAL"
  | "LOW_CONVICTION_DIRECTIONAL"
  | "MICRO_OVERRIDE"
  | "HEDGING_DEFENSIVE"
  | "NO_EDGE";

export type StrategyType =
  | "BULL_PUT_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "BULL_CALL_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "IRON_CONDOR"
  | "PROTECTIVE_PUT";

export type TradeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type PositionSize = "FULL" | "HALF";

export interface PremiumGateResult {
  gate: string;
  passed: boolean;
  detail: string;
}

export interface StrategyCriteria {
  strategyType: StrategyType;
  direction: TradeDirection;
  ticker: string;
  dteRange: { min: number; max: number };
  deltaTargets: { shortStrike: number; longStrike: number };
  spreadWidth: number;
  positionSize: PositionSize;
  profitTargetPct: number;
  stopLossMultiple: number;
  maxContracts: number;
  eventConflicts: EventConflict[];
  hardBlocks: string[];
  warnings: string[];
  mode: TradingMode;
  modeReason: string;
  premiumGates: PremiumGateResult[];
  premiumSellingApproved: boolean;
}

export interface ScannerInput {
  symbol: string;
  totalScore: number;
  components: {
    trendAlignment: number;
    relativeStrength: number;
    volumeConfirmation: number;
    ivrScore: number;
    optionsLiquidity: number;
  };
  microOverrideEligible: boolean;
  ivr: number;
  atmSpreadPct: number;
  changePct: number;
  sector: string;
  scanTimestamp: number;
}

export interface PulseInput {
  composite: number;
  confidence: number;
  bias: string;
  avoidShortPremium: boolean;
  vix: number | null;
}

export interface TickerMarketData {
  price: number;
  sma20: number | null;
  atr14: number | null;
  ivr: number;
  optionsLiquidity: "ADEQUATE" | "THIN";
}

export interface PortfolioContext {
  totalEquity: number;
  openPositionCount: number;
  microOverrideCount: number;
  aggregateRiskPct: number;
}

export interface StrategistInput {
  symbol: string;
  pulse: PulseInput;
  scannerData: ScannerInput | null;
  tickerData: TickerMarketData;
  portfolio: PortfolioContext;
  shockActive: boolean;
  eventCheck: EventCheckResult;
}

export interface StrategistOutput {
  criteria: StrategyCriteria | null;
  rejection: string | null;
  mode: TradingMode;
  modeReason: string;
}

function selectMode(input: StrategistInput): { mode: TradingMode; reason: string } {
  const { pulse, scannerData, shockActive, portfolio } = input;

  if (shockActive) {
    return {
      mode: "HEDGING_DEFENSIVE",
      reason: "Regime shock is active. Only defensive strategies available.",
    };
  }

  const absComposite = Math.abs(pulse.composite);

  if (absComposite >= 0.75 && pulse.confidence >= 60) {
    return {
      mode: "HIGH_CONVICTION_DIRECTIONAL",
      reason: `Pulse composite ${pulse.composite.toFixed(2)} (|${absComposite.toFixed(2)}| >= 0.75) with confidence ${pulse.confidence} >= 60.`,
    };
  }

  if (absComposite >= 0.30 && absComposite < 0.75 && pulse.confidence >= 30 && pulse.confidence < 60) {
    return {
      mode: "LOW_CONVICTION_DIRECTIONAL",
      reason: `Pulse composite ${pulse.composite.toFixed(2)} (|${absComposite.toFixed(2)}| in 0.30-0.75) with confidence ${pulse.confidence} in 30-60.`,
    };
  }

  if (scannerData && scannerData.microOverrideEligible) {
    const scanAge = Date.now() - scannerData.scanTimestamp;
    const fiveMinMs = 5 * 60 * 1000;

    if (scanAge > fiveMinMs) {
      return {
        mode: "NO_EDGE",
        reason: `Scanner data is ${Math.round(scanAge / 60000)} minutes old (> 5 min). Rescan required for Micro-Override.`,
      };
    }

    if (portfolio.microOverrideCount >= 2) {
      return {
        mode: "NO_EDGE",
        reason: `Micro-Override limit reached: ${portfolio.microOverrideCount}/2 positions already open.`,
      };
    }

    const pulseBullish = pulse.composite > 0.30;
    const pulseBearish = pulse.composite < -0.30;
    const scanBullish = scannerData.changePct > 0;
    if ((pulseBullish && !scanBullish) || (pulseBearish && scanBullish)) {
      return {
        mode: "NO_EDGE",
        reason: "Micro-Override blocked: scanner direction is inverse to clear macro bias.",
      };
    }

    return {
      mode: "MICRO_OVERRIDE",
      reason: `Scanner score ${scannerData.totalScore} >= 90 with Micro-Override eligibility confirmed. Pulse is near-neutral (${pulse.composite.toFixed(2)}).`,
    };
  }

  if (absComposite >= 0.30 && pulse.confidence >= 60) {
    return {
      mode: "LOW_CONVICTION_DIRECTIONAL",
      reason: `Pulse composite ${pulse.composite.toFixed(2)} with high confidence ${pulse.confidence}. Using low-conviction mode for tighter risk.`,
    };
  }

  void logFailure("STRATEGIST", "INFO", `No trading mode qualified — composite ${pulse.composite.toFixed(2)}, confidence ${pulse.confidence}`, { composite: pulse.composite, confidence: pulse.confidence });
  return {
    mode: "NO_EDGE",
    reason: "No actionable edge. Cash is a position.",
  };
}

function checkPremiumGates(input: StrategistInput, dteMax: number): PremiumGateResult[] {
  const { tickerData, pulse, eventCheck } = input;
  const gates: PremiumGateResult[] = [];

  gates.push({
    gate: "IVR >= 50",
    passed: tickerData.ivr >= 50,
    detail: `IVR is ${tickerData.ivr}%.`,
  });

  let rangeBound = false;
  if (tickerData.sma20 !== null && tickerData.atr14 !== null && tickerData.atr14 > 0) {
    const dist = Math.abs(tickerData.price - tickerData.sma20);
    rangeBound = dist <= tickerData.atr14;
    gates.push({
      gate: "Range-bound (price within 1 ATR of SMA20)",
      passed: rangeBound,
      detail: `Price $${tickerData.price.toFixed(2)}, SMA20 $${tickerData.sma20.toFixed(2)}, ATR14 $${tickerData.atr14.toFixed(2)}. Distance: $${dist.toFixed(2)}.`,
    });
  } else {
    gates.push({
      gate: "Range-bound (price within 1 ATR of SMA20)",
      passed: false,
      detail: "Insufficient data for SMA20 or ATR calculation.",
    });
  }

  const hasEventInDTE = eventCheck.eventConflicts.some(ec => {
    const eventDate = new Date(ec.date);
    const now = new Date();
    const daysAway = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysAway >= 0 && daysAway <= dteMax;
  });
  gates.push({
    gate: "No events within DTE",
    passed: !hasEventInDTE,
    detail: hasEventInDTE
      ? `Event(s) found within ${dteMax}-day DTE window.`
      : `No conflicting events within ${dteMax} days.`,
  });

  gates.push({
    gate: "Pulse: no AVOID_SHORT_PREMIUM",
    passed: !pulse.avoidShortPremium,
    detail: pulse.avoidShortPremium
      ? "Market Pulse flagged AVOID_SHORT_PREMIUM."
      : "No short-premium restriction from Pulse.",
  });

  const vix = pulse.vix ?? 0;
  gates.push({
    gate: "VIX < 22",
    passed: vix > 0 && vix < 22,
    detail: vix > 0 ? `VIX at ${vix.toFixed(2)}.` : "VIX data unavailable.",
  });

  gates.push({
    gate: "Adequate options liquidity",
    passed: tickerData.optionsLiquidity === "ADEQUATE",
    detail: `Options liquidity: ${tickerData.optionsLiquidity}.`,
  });

  return gates;
}

function determineDirection(pulse: PulseInput, scannerData: ScannerInput | null): TradeDirection {
  if (scannerData) {
    return scannerData.changePct >= 0 ? "BULLISH" : "BEARISH";
  }
  if (pulse.composite >= 0.30) return "BULLISH";
  if (pulse.composite <= -0.30) return "BEARISH";
  return "NEUTRAL";
}

function computeMaxContracts(
  portfolio: PortfolioContext,
  spreadWidth: number,
  positionSize: PositionSize,
): number {
  if (portfolio.totalEquity <= 0 || spreadWidth <= 0) return 1;

  const maxRiskPct = 0.30;
  const availableRiskPct = Math.max(0, maxRiskPct - portfolio.aggregateRiskPct);
  const maxRiskDollars = portfolio.totalEquity * availableRiskPct;
  const riskPerContract = spreadWidth * 100;
  if (availableRiskPct <= 0) return 0;
  let contracts = Math.floor(maxRiskDollars / riskPerContract);
  if (positionSize === "HALF") {
    contracts = Math.floor(contracts / 2);
  }
  return Math.min(contracts, 50);
}

export function runDeterministicStrategist(input: StrategistInput): StrategistOutput {
  const { mode, reason: modeReason } = selectMode(input);

  if (mode === "NO_EDGE") {
    return { criteria: null, rejection: modeReason, mode, modeReason };
  }

  const direction = mode === "HEDGING_DEFENSIVE"
    ? "BEARISH" as TradeDirection
    : determineDirection(input.pulse, input.scannerData);

  let dteRange: { min: number; max: number };
  let positionSize: PositionSize;

  switch (mode) {
    case "HIGH_CONVICTION_DIRECTIONAL":
      dteRange = { min: 21, max: 45 };
      positionSize = "FULL";
      break;
    case "LOW_CONVICTION_DIRECTIONAL":
      dteRange = { min: 14, max: 21 };
      positionSize = "HALF";
      break;
    case "MICRO_OVERRIDE":
      dteRange = { min: 7, max: 21 };
      positionSize = "HALF";
      break;
    case "HEDGING_DEFENSIVE":
      dteRange = { min: 7, max: 21 };
      positionSize = "HALF";
      break;
    default:
      dteRange = { min: 14, max: 30 };
      positionSize = "HALF";
  }

  const premiumGates = checkPremiumGates(input, dteRange.max);
  const premiumSellingApproved = premiumGates.every(g => g.passed);

  let strategyType: StrategyType;
  let deltaTargets: { shortStrike: number; longStrike: number };

  if (mode === "HEDGING_DEFENSIVE") {
    strategyType = "PROTECTIVE_PUT";
    deltaTargets = { shortStrike: 0.30, longStrike: 0.20 };
  } else if (premiumSellingApproved && direction !== "NEUTRAL") {
    if (direction === "BULLISH") {
      strategyType = "BULL_PUT_SPREAD";
      deltaTargets = { shortStrike: 0.30, longStrike: 0.20 };
    } else {
      strategyType = "BEAR_CALL_SPREAD";
      deltaTargets = { shortStrike: 0.30, longStrike: 0.20 };
    }
  } else if (premiumSellingApproved && direction === "NEUTRAL") {
    strategyType = "IRON_CONDOR";
    deltaTargets = { shortStrike: 0.20, longStrike: 0.10 };
  } else {
    if (direction === "BULLISH") {
      strategyType = "BULL_CALL_SPREAD";
      deltaTargets = { shortStrike: 0.40, longStrike: 0.30 };
    } else if (direction === "BEARISH") {
      strategyType = "BEAR_PUT_SPREAD";
      deltaTargets = { shortStrike: 0.40, longStrike: 0.30 };
    } else {
      strategyType = "BULL_CALL_SPREAD";
      deltaTargets = { shortStrike: 0.40, longStrike: 0.30 };
    }
  }

  const spreadWidth = 5;
  const maxContracts = computeMaxContracts(input.portfolio, spreadWidth, positionSize);

  const criteria: StrategyCriteria = {
    strategyType,
    direction,
    ticker: input.symbol,
    dteRange,
    deltaTargets,
    spreadWidth,
    positionSize,
    profitTargetPct: 50,
    stopLossMultiple: 2,
    maxContracts,
    eventConflicts: input.eventCheck.eventConflicts,
    hardBlocks: input.eventCheck.hardBlocks,
    warnings: input.eventCheck.warnings,
    mode,
    modeReason,
    premiumGates,
    premiumSellingApproved,
  };

  return { criteria, rejection: null, mode, modeReason };
}

export async function fetchPortfolioContext(traderToken: string | null): Promise<PortfolioContext> {
  const defaultCtx: PortfolioContext = {
    totalEquity: 100000,
    openPositionCount: 0,
    microOverrideCount: 0,
    aggregateRiskPct: 0,
  };
  if (!traderToken) return defaultCtx;

  try {
    const res = await fetch(`${SCHWAB_TRADER}/accounts?fields=positions`, {
      headers: { Authorization: `Bearer ${traderToken}` },
    });
    if (!res.ok) return defaultCtx;
    const accounts = await res.json() as Array<Record<string, unknown>>;

    let totalEquity = 0;
    let posCount = 0;
    let totalMaintReq = 0;

    for (const acct of accounts) {
      const sa = acct["securitiesAccount"] as Record<string, unknown> | undefined;
      if (!sa) continue;

      const balances = (sa["currentBalances"] ?? sa["projectedBalances"]) as Record<string, unknown> | undefined;
      if (balances) {
        totalEquity += (balances["equity"] as number) ?? (balances["liquidationValue"] as number) ?? 0;
      }

      const positions = (sa["positions"] as Array<Record<string, unknown>>) ?? [];
      for (const p of positions) {
        posCount++;
        totalMaintReq += (p["maintenanceRequirement"] as number) ?? 0;
      }
    }

    if (totalEquity <= 0) totalEquity = 100000;
    const aggregateRiskPct = totalEquity > 0 ? totalMaintReq / totalEquity : 0;

    return {
      totalEquity,
      openPositionCount: posCount,
      microOverrideCount: 0,
      aggregateRiskPct: Math.min(aggregateRiskPct, 1),
    };
  } catch {
    return defaultCtx;
  }
}

export async function fetchTickerMarketData(
  symbol: string,
  accessToken: string,
  scannerIvr?: number,
  scannerLiquidity?: string,
): Promise<TickerMarketData> {
  let price = 0;
  let sma20: number | null = null;
  let atr14: number | null = null;
  let ivr = scannerIvr ?? 0;
  const optionsLiquidity: "ADEQUATE" | "THIN" =
    scannerLiquidity === "ADEQUATE" ? "ADEQUATE" : scannerLiquidity === "THIN" ? "THIN" : "ADEQUATE";

  try {
    const params = new URLSearchParams({
      symbol,
      periodType: "month",
      period: "3",
      frequencyType: "daily",
      frequency: "1",
    });
    const res = await fetch(
      `https://api.schwabapi.com/marketdata/v1/pricehistory?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.ok) {
      const json = await res.json() as Record<string, unknown>;
      const candles = (json["candles"] as Array<Record<string, number>>) ?? [];
      if (candles.length > 0) {
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        price = closes[closes.length - 1] ?? 0;

        if (closes.length >= 20) {
          sma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
        }

        if (highs.length >= 15 && lows.length >= 15 && closes.length >= 15) {
          let atrSum = 0;
          const start = Math.max(1, closes.length - 14);
          for (let i = start; i < closes.length; i++) {
            const tr = Math.max(
              highs[i] - lows[i],
              Math.abs(highs[i] - closes[i - 1]),
              Math.abs(lows[i] - closes[i - 1]),
            );
            atrSum += tr;
          }
          atr14 = atrSum / 14;
        }
      }
    }
  } catch { /* use defaults */ }

  return { price, sma20, atr14, ivr, optionsLiquidity };
}

export function buildNarrativePrompt(
  criteria: StrategyCriteria,
  pulseSummary: string,
  scannerBreakdown: string | null,
): string {
  const lines: string[] = [];
  lines.push("You are a senior options strategist. The system has already selected a trade setup using deterministic rules. Your job is to write 2-3 paragraphs explaining why this setup makes sense, the key risk factors, what conditions would invalidate the thesis, and what to watch during the trade.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Do NOT modify the criteria or suggest alternatives.");
  lines.push("- Do NOT override the mode selection or gate checks.");
  lines.push("- Do NOT use em dashes.");
  lines.push("- Mention any divergence between Pulse bias and trade direction.");
  lines.push("- Be specific about risk and invalidation levels.");
  lines.push("");
  lines.push("STRATEGY CRITERIA:");
  lines.push(`Strategy: ${criteria.strategyType}`);
  lines.push(`Direction: ${criteria.direction}`);
  lines.push(`Ticker: ${criteria.ticker}`);
  lines.push(`DTE Range: ${criteria.dteRange.min}-${criteria.dteRange.max} days`);
  lines.push(`Delta Targets: Short ${criteria.deltaTargets.shortStrike}, Long ${criteria.deltaTargets.longStrike}`);
  lines.push(`Spread Width: $${criteria.spreadWidth}`);
  lines.push(`Position Size: ${criteria.positionSize}`);
  lines.push(`Profit Target: ${criteria.profitTargetPct}% of credit`);
  lines.push(`Stop Loss: ${criteria.stopLossMultiple}x credit`);
  lines.push(`Max Contracts: ${criteria.maxContracts}`);
  lines.push(`Mode: ${criteria.mode} - ${criteria.modeReason}`);
  lines.push(`Premium Selling Approved: ${criteria.premiumSellingApproved}`);
  lines.push("");
  lines.push("PREMIUM GATE RESULTS:");
  for (const g of criteria.premiumGates) {
    lines.push(`  ${g.passed ? "PASS" : "FAIL"} - ${g.gate}: ${g.detail}`);
  }
  lines.push("");
  lines.push("EVENT CONFLICTS:");
  if (criteria.eventConflicts.length === 0) {
    lines.push("  None within DTE window.");
  } else {
    for (const ec of criteria.eventConflicts) {
      lines.push(`  ${ec.eventTitle} on ${ec.dateFormatted ?? ec.date} - ${ec.importance}`);
    }
  }
  if (criteria.hardBlocks.length > 0) {
    lines.push("");
    lines.push("HARD BLOCKS:");
    for (const hb of criteria.hardBlocks) {
      lines.push(`  - ${hb}`);
    }
  }
  if (criteria.warnings.length > 0) {
    lines.push("");
    lines.push("WARNINGS:");
    for (const w of criteria.warnings) {
      lines.push(`  - ${w}`);
    }
  }
  lines.push("");
  lines.push("MARKET PULSE SUMMARY:");
  lines.push(pulseSummary);

  if (scannerBreakdown) {
    lines.push("");
    lines.push("SCANNER SCORE BREAKDOWN:");
    lines.push(scannerBreakdown);
  }

  return lines.join("\n");
}
