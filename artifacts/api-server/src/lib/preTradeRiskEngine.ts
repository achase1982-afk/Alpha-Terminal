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
  ivr?: number;
  putSkew?: number;
  earningsDaysAway?: number | null;
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

function isStrategyCredit(strategy: StrategyPayload): boolean {
  return strategy.net_credit > 0;
}

function strategyInvolvesSellPuts(strategy: StrategyPayload): boolean {
  if (strategy.short_leg.type === "PUT" && strategy.short_leg.action === "SELL" && strategy.short_leg.strike > 0) return true;
  if (strategy.short_leg_2?.type === "PUT" && strategy.short_leg_2?.action === "SELL" && (strategy.short_leg_2?.strike ?? 0) > 0) return true;
  return false;
}

function checkIVR(input: PreTradeInput): PreTradeCheck {
  const ivr = input.ivr;
  if (ivr === undefined || ivr === null) {
    return {
      id: "ivr",
      label: "IV Rank",
      status: "WARN",
      value: "Unavailable",
      threshold: "IVR gates strategy type",
      detail: "Cannot compute IV Rank from chain data",
    };
  }

  const credit = isStrategyCredit(input.strategy);
  let status: CheckStatus = "PASS";
  let detail: string;

  if (ivr > 50) {
    if (credit) {
      detail = `IVR ${ivr}% favors premium selling — credit strategy is well-suited`;
    } else {
      status = "WARN";
      detail = `IVR ${ivr}% is elevated — debit strategies face inflated premium costs`;
    }
  } else if (ivr < 30) {
    if (!credit) {
      detail = `IVR ${ivr}% is low — debit/directional strategy benefits from cheap premium`;
    } else {
      status = "WARN";
      detail = `IVR ${ivr}% is low — credit strategies collect insufficient premium`;
    }
  } else {
    detail = `IVR ${ivr}% is in neutral zone — both credit and debit strategies viable`;
  }

  return {
    id: "ivr",
    label: "IV Rank",
    status,
    value: `${ivr}%`,
    threshold: ">50 favors credit, <30 favors debit",
    detail,
  };
}

function checkPutSkew(input: PreTradeInput): PreTradeCheck {
  const skew = input.putSkew;
  if (skew === undefined || skew === null) {
    return {
      id: "put_skew",
      label: "Put Skew",
      status: "PASS",
      value: "Unavailable",
      threshold: "Skew <5 vol pts",
      detail: "Cannot compute put skew from chain data",
    };
  }

  const sellsPuts = strategyInvolvesSellPuts(input.strategy);

  let status: CheckStatus = "PASS";
  let detail: string;

  if (sellsPuts && skew > 10) {
    status = "FAIL";
    detail = `Put skew ${skew} vol pts is extreme — selling puts carries outsized downside risk`;
  } else if (sellsPuts && skew > 5) {
    status = "WARN";
    detail = `Elevated put skew increases cost of downside protection`;
  } else if (skew > 5) {
    detail = `Put skew ${skew} vol pts is elevated but strategy does not sell puts`;
  } else {
    detail = `Put skew ${skew} vol pts is within normal range`;
  }

  return {
    id: "put_skew",
    label: "Put Skew",
    status,
    value: `${skew} vol pts`,
    threshold: sellsPuts ? "≤5 vol pts (selling puts)" : "Informational",
    detail,
  };
}

function checkEarningsProximity(input: PreTradeInput): PreTradeCheck {
  const days = input.earningsDaysAway;
  if (days === undefined || days === null) {
    return {
      id: "earnings_proximity",
      label: "Earnings Proximity",
      status: "PASS",
      value: "Unknown",
      threshold: ">14 days",
      detail: "Earnings date unavailable — no proximity gate applied",
    };
  }

  const credit = isStrategyCredit(input.strategy);
  let status: CheckStatus = "PASS";
  let detail: string;

  if (days <= 7 && credit) {
    status = "FAIL";
    detail = `Earnings in ${days} day${days !== 1 ? "s" : ""} — earnings risk makes premium selling unsuitable`;
  } else if (days <= 14 && credit) {
    status = "WARN";
    detail = `Earnings in ${days} days — credit strategy size reduced 50% due to earnings risk`;
  } else if (days <= 7) {
    status = "WARN";
    detail = `Earnings in ${days} day${days !== 1 ? "s" : ""} — elevated vol event ahead`;
  } else {
    detail = `Earnings in ${days} days — no proximity concern`;
  }

  return {
    id: "earnings_proximity",
    label: "Earnings Proximity",
    status,
    value: days <= 0 ? "Imminent" : `${days} days`,
    threshold: credit ? ">14 days for credit" : ">7 days",
    detail,
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
    checkIVR(input),
    checkPutSkew(input),
    checkEarningsProximity(input),
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
