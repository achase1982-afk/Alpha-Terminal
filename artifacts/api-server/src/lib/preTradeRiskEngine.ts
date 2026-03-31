import type { StrategyPayload, RiskEvaluation } from "./optionsStrategist.js";

export type CheckStatus = "PASS" | "WARN" | "FAIL";

export interface PreTradeCheck {
  id: string;
  label: string;
  status: CheckStatus;
  value: string;
  threshold: string;
  detail: string;
}

export interface PreTradeResult {
  overall: CheckStatus;
  checks: PreTradeCheck[];
  failCount: number;
  warnCount: number;
  passCount: number;
  blockTrade: boolean;
}

export interface PreTradeInput {
  strategy: StrategyPayload;
  pulseComposite: number;
  pulseConfidence: number;
  pulseEdge: string;
  vix: number | null;
  accountSize: number;
  settings: {
    minRR: number;
    maxPositionPct: number;
    minDTE: number;
    blockOnRed: boolean;
  };
}

function checkPulseAlignment(input: PreTradeInput): PreTradeCheck {
  const { strategy, pulseEdge } = input;
  const stratType = strategy.strategy_type.toUpperCase();
  const isBullish = stratType.includes("BULL") || stratType.includes("LONG CALL") || stratType.includes("CASH SECURED") || stratType.includes("SHORT PUT");
  const isBearish = stratType.includes("BEAR") || stratType.includes("LONG PUT");
  const isNeutral = stratType.includes("IRON") || stratType.includes("STRANGLE") || stratType.includes("BUTTERFLY");

  let aligned = false;
  if (isNeutral) aligned = true;
  else if (isBullish && (pulseEdge === "BULLISH_EDGE" || pulseEdge === "NEUTRAL_EDGE")) aligned = true;
  else if (isBearish && (pulseEdge === "BEARISH_EDGE" || pulseEdge === "NEUTRAL_EDGE")) aligned = true;

  const conf = input.pulseConfidence;
  let status: CheckStatus = "FAIL";
  if (aligned && conf >= 50) status = "PASS";
  else if (aligned && conf >= 25) status = "WARN";

  return {
    id: "pulse_alignment",
    label: "Pulse Alignment",
    status,
    value: `${pulseEdge.replace(/_/g, " ")} (${conf}%)`,
    threshold: "Strategy matches pulse direction",
    detail: aligned
      ? conf >= 50 ? "Strategy aligned with market pulse" : "Aligned but low confidence"
      : "Strategy direction conflicts with pulse",
  };
}

function checkRiskReward(input: PreTradeInput): PreTradeCheck {
  const { strategy, settings } = input;
  const rr = strategy.max_loss > 0 ? strategy.max_profit / strategy.max_loss : 0;
  const minRR = settings.minRR;

  let status: CheckStatus = "FAIL";
  if (rr >= minRR) status = "PASS";
  else if (rr >= minRR * 0.75) status = "WARN";

  return {
    id: "risk_reward",
    label: "Risk/Reward",
    status,
    value: `${rr.toFixed(2)}:1`,
    threshold: `≥ ${minRR.toFixed(2)}:1`,
    detail: status === "PASS" ? "R/R meets threshold" : status === "WARN" ? "R/R slightly below target" : "R/R below minimum threshold",
  };
}

function checkLiquidity(input: PreTradeInput): PreTradeCheck {
  const { strategy } = input;
  const leg = strategy.short_leg.strike > 0 ? strategy.short_leg : strategy.long_leg;
  const spread = leg.ask > 0 ? (leg.ask - leg.bid) / ((leg.bid + leg.ask) / 2) : 1;
  const spreadPct = Math.round(spread * 100);

  let status: CheckStatus = "FAIL";
  if (spreadPct <= 15) status = "PASS";
  else if (spreadPct <= 25) status = "WARN";

  return {
    id: "liquidity",
    label: "Bid/Ask Spread",
    status,
    value: `${spreadPct}%`,
    threshold: "≤ 15%",
    detail: status === "PASS" ? "Tight spread, good liquidity" : status === "WARN" ? "Moderate spread" : "Wide spread, poor liquidity",
  };
}

function checkPoP(input: PreTradeInput): PreTradeCheck {
  const pop = input.strategy.probability_of_profit_pct;

  let status: CheckStatus = "FAIL";
  if (pop >= 35) status = "PASS";
  else if (pop >= 25) status = "WARN";

  return {
    id: "pop",
    label: "Probability of Profit",
    status,
    value: `${pop}%`,
    threshold: "≥ 35%",
    detail: status === "PASS" ? "PoP meets threshold" : status === "WARN" ? "PoP slightly low" : "PoP too low",
  };
}

function checkPositionSize(input: PreTradeInput): PreTradeCheck {
  const { strategy, accountSize, settings } = input;
  const riskEval = strategy.risk_evaluation;
  const riskAmount = riskEval?.risk_metric ?? strategy.max_loss;
  const positionPct = accountSize > 0 ? (riskAmount / accountSize) * 100 : 100;
  const maxPct = settings.maxPositionPct;

  let status: CheckStatus = "FAIL";
  if (positionPct <= maxPct) status = "PASS";
  else if (positionPct <= maxPct * 1.5) status = "WARN";

  return {
    id: "position_size",
    label: "Position Size",
    status,
    value: `${positionPct.toFixed(1)}% of account`,
    threshold: `≤ ${maxPct}%`,
    detail: status === "PASS" ? "Position size within limits" : status === "WARN" ? "Position size slightly large" : "Position size exceeds limit",
  };
}

function checkVolEnvironment(input: PreTradeInput): PreTradeCheck {
  const { strategy, vix } = input;
  const isCredit = strategy.net_credit > 0;

  if (vix === null) {
    return {
      id: "vol_environment",
      label: "Vol Environment",
      status: "WARN",
      value: "VIX unavailable",
      threshold: "Check vol regime",
      detail: "Cannot verify vol environment without VIX data",
    };
  }

  let status: CheckStatus = "PASS";
  if (isCredit && vix < 14) {
    status = "WARN";
  } else if (!isCredit && vix > 30) {
    status = "WARN";
  }
  if (isCredit && vix < 10) status = "FAIL";

  return {
    id: "vol_environment",
    label: "Vol Environment",
    status,
    value: `VIX ${vix.toFixed(1)}`,
    threshold: isCredit ? "VIX ≥ 14 for credit" : "VIX ≤ 30 for debit",
    detail: status === "PASS" ? "Vol environment supports strategy" : status === "WARN" ? "Vol environment suboptimal" : "Vol environment unfavorable",
  };
}

function checkDTE(input: PreTradeInput): PreTradeCheck {
  const dte = input.strategy.days_to_expiration;
  const minDTE = input.settings.minDTE;

  let status: CheckStatus = "FAIL";
  if (dte >= minDTE) status = "PASS";
  else if (dte >= Math.max(minDTE - 2, 1)) status = "WARN";

  return {
    id: "dte",
    label: "Days to Expiration",
    status,
    value: `${dte} DTE`,
    threshold: `≥ ${minDTE} DTE`,
    detail: status === "PASS" ? "Sufficient time to expiration" : status === "WARN" ? "DTE slightly low" : "Insufficient time to expiration",
  };
}

export function runPreTradeChecks(input: PreTradeInput): PreTradeResult {
  const checks: PreTradeCheck[] = [
    checkPulseAlignment(input),
    checkRiskReward(input),
    checkLiquidity(input),
    checkPoP(input),
    checkPositionSize(input),
    checkVolEnvironment(input),
    checkDTE(input),
  ];

  const failCount = checks.filter(c => c.status === "FAIL").length;
  const warnCount = checks.filter(c => c.status === "WARN").length;
  const passCount = checks.filter(c => c.status === "PASS").length;

  let overall: CheckStatus = "PASS";
  if (failCount >= 2) overall = "FAIL";
  else if (failCount >= 1 || warnCount >= 3) overall = "WARN";

  return {
    overall,
    checks,
    failCount,
    warnCount,
    passCount,
    blockTrade: input.settings.blockOnRed && failCount >= 1,
  };
}
