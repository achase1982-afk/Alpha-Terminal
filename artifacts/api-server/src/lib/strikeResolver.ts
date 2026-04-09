import type { StrategyCriteria, StrategyType, ScannerInput } from "./deterministicStrategist.js";

const SUPPORTED_VERTICALS: StrategyType[] = [
  "BULL_CALL_SPREAD",
  "BEAR_PUT_SPREAD",
  "BULL_PUT_SPREAD",
  "BEAR_CALL_SPREAD",
];

export interface ChainContract {
  strike: number;
  expiration: string;
  schwabSymbol?: string;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  dte?: number;
}

export interface ChainData {
  symbol: string;
  underlyingPrice?: number;
  calls: ChainContract[];
  puts: ChainContract[];
  fetchedAt: number;
}

export interface AccountSnapshot {
  netLiquidatingValue: number;
  availableBuyingPower: number;
}

export interface ResolvedLeg {
  type: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  executable_price: number;
  delta: number;
  open_interest: number;
  volume: number;
  schwabSymbol?: string;
}

export interface ResolvedTrade {
  schema_version: "1.0.0";
  ticker: string;
  strategy: string;
  direction: "BULLISH" | "BEARISH";
  expiration: string;
  dte: number;
  legs: [ResolvedLeg, ResolvedLeg];
  pricing: {
    type: "debit" | "credit";
    executable_amount: number;
    mid_amount: number;
    display: string;
  };
  risk: {
    max_loss_per_contract: number;
    max_gain_per_contract: number;
    breakeven: number;
    profit_target_spread_value: number;
    profit_target_display: string;
    stop_loss_spread_value: number;
    stop_loss_display: string;
  };
  sizing: {
    recommended_contracts: number;
    total_risk: number;
    total_max_gain: number;
    size_modifier: "FULL" | "HALF";
    account_net_liq: number;
    available_buying_power: number;
    max_risk_per_trade: number;
  };
  warnings: string[];
  as_of_timestamp: string;
  chain_source: "live" | "cache" | "previous_close";
  source: "scanner" | "manual";
  micro_override: boolean;
  scanner_score: number | null;
}

export interface StrikeResolutionError {
  error: true;
  error_code:
    | "NO_VALID_EXPIRATION"
    | "GREEKS_UNAVAILABLE"
    | "INVALID_ENGINE_OUTPUT"
    | "NO_VALID_STRIKES"
    | "PRICING_INVALID"
    | "UNSUPPORTED_STRATEGY";
  user_message: string;
  fallback_params: StrategyCriteria | null;
}

export type StrikeResolutionResult =
  | { resolved: true; trade: ResolvedTrade }
  | { resolved: false; error: StrikeResolutionError };

const STRATEGY_LABELS: Record<string, string> = {
  BULL_CALL_SPREAD: "Bull Call Spread",
  BEAR_PUT_SPREAD: "Bear Put Spread",
  BULL_PUT_SPREAD: "Bull Put Spread",
  BEAR_CALL_SPREAD: "Bear Call Spread",
};

function isMarketHours(): boolean {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = fmt.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
  const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "Monday";
  const isWeekend = weekday === "Saturday" || weekday === "Sunday";
  if (isWeekend) return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960;
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function isDebitSpread(strategy: StrategyType): boolean {
  return strategy === "BULL_CALL_SPREAD" || strategy === "BEAR_PUT_SPREAD";
}

function getContractType(strategy: StrategyType): "call" | "put" {
  return strategy === "BULL_CALL_SPREAD" || strategy === "BEAR_CALL_SPREAD" ? "call" : "put";
}

function earningsDatesFromCriteria(criteria: StrategyCriteria): Date[] {
  const dates: Date[] = [];
  for (const ec of criteria.eventConflicts) {
    if (
      ec.eventTitle.toLowerCase().includes("earning") ||
      ec.importance === "HIGH"
    ) {
      const d = new Date(ec.date);
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }
  return dates;
}

function selectExpiration(
  criteria: StrategyCriteria,
  availableExpirations: string[],
  warnings: string[],
): string | null {
  const now = new Date();
  const earningsDates = earningsDatesFromCriteria(criteria);

  function filterAndRank(dteMin: number, dteMax: number, allowEarningsCrossing = false): string | null {
    const candidates: { exp: string; dte: number; midDist: number }[] = [];
    const midpoint = (dteMin + dteMax) / 2;

    for (const exp of availableExpirations) {
      const expDate = new Date(exp);
      if (isNaN(expDate.getTime())) continue;
      const dte = daysBetween(now, expDate);
      if (dte < dteMin || dte > dteMax) continue;

      const crossesEarnings = earningsDates.some(ed => ed >= now && ed <= expDate);
      if (crossesEarnings && !allowEarningsCrossing) continue;

      candidates.push({ exp, dte, midDist: Math.abs(dte - midpoint) });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.midDist - b.midDist || a.dte - b.dte);
    return candidates[0].exp;
  }

  const { min: dteMin, max: dteMax } = criteria.dteRange;

  let result = filterAndRank(dteMin, dteMax);
  if (result) return result;

  const allInRangeCrossEarnings = availableExpirations.some(exp => {
    const expDate = new Date(exp);
    const dte = daysBetween(now, expDate);
    return dte >= dteMin && dte <= dteMax;
  });

  if (allInRangeCrossEarnings) {
    const earningsCrossingResult = filterAndRank(dteMin, dteMax, true);
    if (earningsCrossingResult) {
      const expDate = new Date(earningsCrossingResult);
      const crossedDate = earningsDates.find(ed => ed >= now && ed <= expDate);
      if (crossedDate) {
        const matchingEvent = criteria.eventConflicts.find(ec => {
          const d = new Date(ec.date);
          return Math.abs(d.getTime() - crossedDate.getTime()) < 86400000 * 2;
        });
        const dateStr = crossedDate.toISOString().slice(0, 10);
        const title = matchingEvent ? ` — ${matchingEvent.eventTitle}` : "";
        warnings.push(`EARNINGS: ${criteria.ticker} reports on ${dateStr}${title}. This position expires after earnings. Expect elevated IV and potential gap risk.`);
      }
      return earningsCrossingResult;
    }
  }

  result = filterAndRank(dteMin - 5, dteMax + 5);
  if (result) {
    warnings.push(`DTE window expanded by ±5 days (original ${dteMin}-${dteMax}d).`);
    return result;
  }

  result = filterAndRank(dteMin - 10, dteMax + 10);
  if (result) {
    warnings.push(`DTE window expanded by ±10 days (original ${dteMin}-${dteMax}d).`);
    return result;
  }

  result = filterAndRank(dteMin - 10, dteMax + 10, true);
  if (result) {
    const expDate = new Date(result);
    const crossedDate = earningsDates.find(ed => ed >= now && ed <= expDate);
    if (crossedDate) {
      const matchingEvent = criteria.eventConflicts.find(ec => {
        const d = new Date(ec.date);
        return Math.abs(d.getTime() - crossedDate.getTime()) < 86400000 * 2;
      });
      const dateStr = crossedDate.toISOString().slice(0, 10);
      const title = matchingEvent ? ` — ${matchingEvent.eventTitle}` : "";
      warnings.push(`DTE window expanded by ±10 days (original ${dteMin}-${dteMax}d).`);
      warnings.push(`EARNINGS: ${criteria.ticker} reports on ${dateStr}${title}. This position expires after earnings. Expect elevated IV and potential gap risk.`);
    }
    return result;
  }

  return null;
}

function selectAnchorStrike(
  contracts: ChainContract[],
  targetDelta: number,
  expiration: string,
): ChainContract | null {
  const expContracts = contracts.filter(
    c =>
      c.expiration === expiration &&
      c.delta != null &&
      c.delta !== 0 &&
      (c.openInterest ?? 0) >= 100 &&
      (c.bid ?? 0) > 0
  );

  if (expContracts.length === 0) return null;

  const absDelta = Math.abs(targetDelta);
  const withDist = expContracts.map(c => ({
    contract: c,
    dist: Math.abs(Math.abs(c.delta!) - absDelta),
  }));

  withDist.sort((a, b) => a.dist - b.dist);

  const closeEnough = withDist.filter(w => w.dist <= 0.03);
  if (closeEnough.length > 1) {
    closeEnough.sort(
      (a, b) =>
        (b.contract.openInterest ?? 0) - (a.contract.openInterest ?? 0) ||
        ((a.contract.ask ?? 0) - (a.contract.bid ?? 0)) -
          ((b.contract.ask ?? 0) - (b.contract.bid ?? 0))
    );
    return closeEnough[0].contract;
  }

  return withDist[0]?.contract ?? null;
}

function snapWidthStrike(
  contracts: ChainContract[],
  anchorStrike: number,
  targetWidth: number,
  strategy: StrategyType,
  expiration: string,
): ChainContract | null {
  const expContracts = contracts.filter(
    c => c.expiration === expiration && (c.bid ?? 0) >= 0
  );

  let targetStrike: number;

  if (strategy === "BULL_CALL_SPREAD") {
    targetStrike = anchorStrike + targetWidth;
  } else if (strategy === "BEAR_PUT_SPREAD") {
    targetStrike = anchorStrike - targetWidth;
  } else if (strategy === "BULL_PUT_SPREAD") {
    targetStrike = anchorStrike - targetWidth;
  } else {
    targetStrike = anchorStrike + targetWidth;
  }

  const tolerance1 = Math.max(targetWidth * 0.10, 0.50);
  let candidates = expContracts.filter(
    c => Math.abs(c.strike - targetStrike) <= tolerance1
  );

  if (candidates.length === 0) {
    const tolerance2 = Math.max(targetWidth * 0.20, 1.0);
    candidates = expContracts.filter(
      c => Math.abs(c.strike - targetStrike) <= tolerance2
    );
  }

  if (candidates.length === 0) return null;

  if (strategy === "BULL_CALL_SPREAD" || strategy === "BEAR_CALL_SPREAD") {
    candidates = candidates.filter(c => c.strike > anchorStrike);
  } else {
    candidates = candidates.filter(c => c.strike < anchorStrike);
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike)
  );

  return candidates[0];
}

function verifySpreadNotInverted(
  longStrike: number,
  shortStrike: number,
  strategy: StrategyType,
): boolean {
  switch (strategy) {
    case "BULL_CALL_SPREAD":
      return shortStrike > longStrike;
    case "BEAR_PUT_SPREAD":
      return longStrike > shortStrike;
    case "BULL_PUT_SPREAD":
      return shortStrike > longStrike;
    case "BEAR_CALL_SPREAD":
      return longStrike > shortStrike;
    default:
      return false;
  }
}

function calcPnL(
  strategy: StrategyType,
  longStrike: number,
  shortStrike: number,
  netAmount: number,
  width: number,
): {
  max_loss_per_contract: number;
  max_gain_per_contract: number;
  breakeven: number;
  profit_target_spread_value: number;
  profit_target_display: string;
  stop_loss_spread_value: number;
  stop_loss_display: string;
} {
  const isDebit = isDebitSpread(strategy);

  if (isDebit) {
    const maxLoss = netAmount * 100;
    const maxGain = (width - netAmount) * 100;

    let breakeven: number;
    if (strategy === "BULL_CALL_SPREAD") {
      breakeven = longStrike + netAmount;
    } else {
      breakeven = longStrike - netAmount;
    }

    const profitTargetValue = +(netAmount + (width - netAmount) * 0.5).toFixed(2);
    const stopLossValue = +(netAmount * 0.5).toFixed(2);

    return {
      max_loss_per_contract: Math.round(maxLoss),
      max_gain_per_contract: Math.round(maxGain),
      breakeven: +breakeven.toFixed(2),
      profit_target_spread_value: profitTargetValue,
      profit_target_display: `Take profit when spread reaches $${profitTargetValue} (50% of max gain)`,
      stop_loss_spread_value: stopLossValue,
      stop_loss_display: `Stop loss when spread drops to $${stopLossValue} (50% loss of debit)`,
    };
  }

  const netCredit = netAmount;
  const maxGain = netCredit * 100;
  const maxLoss = (width - netCredit) * 100;

  let breakeven: number;
  if (strategy === "BULL_PUT_SPREAD") {
    breakeven = shortStrike - netCredit;
  } else {
    breakeven = shortStrike + netCredit;
  }

  const profitTargetValue = +(netCredit * 0.5).toFixed(2);
  const stopLossValue = +(netCredit * 2).toFixed(2);

  return {
    max_loss_per_contract: Math.round(maxLoss),
    max_gain_per_contract: Math.round(maxGain),
    breakeven: +breakeven.toFixed(2),
    profit_target_spread_value: profitTargetValue,
    profit_target_display: `Take profit when spread drops to $${profitTargetValue} (50% of credit received)`,
    stop_loss_spread_value: stopLossValue,
    stop_loss_display: `Stop loss when spread rises to $${stopLossValue} (2x credit received)`,
  };
}

function validateInputs(
  criteria: StrategyCriteria,
): StrikeResolutionError | null {
  if (!SUPPORTED_VERTICALS.includes(criteria.strategyType)) {
    return {
      error: true,
      error_code: "UNSUPPORTED_STRATEGY",
      user_message: `Multi-leg strategy resolution coming soon. Showing abstract parameters for ${criteria.strategyType}.`,
      fallback_params: criteria,
    };
  }

  const { deltaTargets, dteRange, spreadWidth } = criteria;

  if (
    deltaTargets.shortStrike < 0 || deltaTargets.shortStrike > 1 ||
    deltaTargets.longStrike < 0 || deltaTargets.longStrike > 1
  ) {
    return {
      error: true,
      error_code: "INVALID_ENGINE_OUTPUT",
      user_message: "Deterministic engine output invalid: delta values out of range (0-1). Flag for review.",
      fallback_params: criteria,
    };
  }

  if (spreadWidth <= 0) {
    return {
      error: true,
      error_code: "INVALID_ENGINE_OUTPUT",
      user_message: "Deterministic engine output invalid: spread width must be > 0. Flag for review.",
      fallback_params: criteria,
    };
  }

  if (dteRange.min >= dteRange.max) {
    return {
      error: true,
      error_code: "INVALID_ENGINE_OUTPUT",
      user_message: "Deterministic engine output invalid: DTE range min >= max. Flag for review.",
      fallback_params: criteria,
    };
  }

  if (deltaTargets.longStrike > deltaTargets.shortStrike) {
    return {
      error: true,
      error_code: "INVALID_ENGINE_OUTPUT",
      user_message: `Deterministic engine output invalid: delta ordering reversed for ${criteria.strategyType}. Long delta (${deltaTargets.longStrike}) > Short delta (${deltaTargets.shortStrike}). Flag for review.`,
      fallback_params: criteria,
    };
  }

  return null;
}

function validateSchema(trade: ResolvedTrade): string | null {
  if (!trade.ticker) return "Missing ticker";
  if (!SUPPORTED_VERTICALS.includes(trade.strategy.toUpperCase().replace(/ /g, "_") as StrategyType)) {
    return "Invalid strategy type";
  }
  const expDate = new Date(trade.expiration);
  if (isNaN(expDate.getTime()) || expDate <= new Date()) return "Invalid or past expiration";
  if (trade.legs.length !== 2) return "Must have exactly 2 legs";
  for (const leg of trade.legs) {
    if (!leg.type || !leg.action || !leg.strike || !leg.executable_price || leg.delta == null) {
      return "Leg missing required fields (type, action, strike, executable_price, delta)";
    }
  }
  if (trade.pricing.executable_amount <= 0) return "Pricing executable_amount must be > 0";
  if (trade.risk.max_loss_per_contract <= 0) return "max_loss_per_contract must be > 0";
  if (trade.risk.max_gain_per_contract <= 0) return "max_gain_per_contract must be > 0";
  if (trade.sizing.recommended_contracts < 1) return "recommended_contracts must be >= 1";
  return null;
}

export function resolveStrikes(
  criteria: StrategyCriteria,
  chain: ChainData,
  account: AccountSnapshot,
  scannerData: ScannerInput | null,
): StrikeResolutionResult {
  const warnings: string[] = [];

  const validationError = validateInputs(criteria);
  if (validationError) return { resolved: false, error: validationError };

  const chainAge = Date.now() - chain.fetchedAt;
  const isLive = isMarketHours();
  let chainSource: "live" | "cache" | "previous_close" = "live";

  if (!isLive) {
    chainSource = "previous_close";
    warnings.push("Market closed. Prices shown are from last session. Review carefully before submitting orders at open.");
  } else if (chainAge > 60_000) {
    chainSource = "cache";
    if (chainAge > 15 * 60_000) {
      warnings.push("Chain data is over 15 minutes old. Prices may have moved.");
    }
  } else {
    chainSource = chainAge <= 5_000 ? "live" : "cache";
  }

  const contractType = getContractType(criteria.strategyType);
  const contracts = contractType === "call" ? chain.calls : chain.puts;

  const expirations = [...new Set(contracts.map(c => c.expiration))].sort();

  const selectedExpiration = selectExpiration(criteria, expirations, warnings);
  if (!selectedExpiration) {
    const allInRange = expirations.some(exp => {
      const dte = daysBetween(new Date(), new Date(exp));
      return dte >= criteria.dteRange.min && dte <= criteria.dteRange.max;
    });

    if (allInRange) {
      return {
        resolved: false,
        error: {
          error: true,
          error_code: "NO_VALID_EXPIRATION",
          user_message: "No trade recommended. All expirations in the DTE window include an earnings event. Earnings trades are excluded from automated recommendations.",
          fallback_params: criteria,
        },
      };
    }

    return {
      resolved: false,
      error: {
        error: true,
        error_code: "NO_VALID_EXPIRATION",
        user_message: `No valid expiration found within DTE range ${criteria.dteRange.min}-${criteria.dteRange.max} days (expanded ±10). Insufficient chain data for ${criteria.ticker}.`,
        fallback_params: criteria,
      },
    };
  }

  const expDate = new Date(selectedExpiration);
  const dte = daysBetween(new Date(), expDate);
  const isDebit = isDebitSpread(criteria.strategyType);

  let anchorDelta: number;
  let anchorAction: "buy" | "sell";

  if (isDebit) {
    anchorDelta = criteria.deltaTargets.shortStrike;
    anchorAction = "buy";
  } else {
    anchorDelta = criteria.deltaTargets.shortStrike;
    anchorAction = "sell";
  }

  const anchorContract = selectAnchorStrike(contracts, anchorDelta, selectedExpiration);
  if (!anchorContract) {
    const hasGreeks = contracts.some(
      c => c.expiration === selectedExpiration && c.delta != null && c.delta !== 0
    );
    if (!hasGreeks) {
      return {
        resolved: false,
        error: {
          error: true,
          error_code: "GREEKS_UNAVAILABLE",
          user_message: `Greeks unavailable or unreliable for ${criteria.ticker} ${selectedExpiration}. Cannot resolve strikes.`,
          fallback_params: criteria,
        },
      };
    }
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "NO_VALID_STRIKES",
        user_message: `No strikes meet quality gates (OI >= 100, bid > $0) for ${criteria.ticker} ${selectedExpiration}. The options market may be too thin.`,
        fallback_params: criteria,
      },
    };
  }

  const widthContract = snapWidthStrike(
    contracts,
    anchorContract.strike,
    criteria.spreadWidth,
    criteria.strategyType,
    selectedExpiration,
  );
  if (!widthContract) {
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "NO_VALID_STRIKES",
        user_message: `Cannot find a valid width-leg strike near $${criteria.spreadWidth} width for ${criteria.ticker}. Strike intervals may not support this width.`,
        fallback_params: criteria,
      },
    };
  }

  let longStrike: number;
  let shortStrike: number;
  let longContract: ChainContract;
  let shortContract: ChainContract;

  if (isDebit) {
    longContract = anchorContract;
    shortContract = widthContract;
    longStrike = anchorContract.strike;
    shortStrike = widthContract.strike;
  } else {
    shortContract = anchorContract;
    longContract = widthContract;
    shortStrike = anchorContract.strike;
    longStrike = widthContract.strike;
  }

  if (!verifySpreadNotInverted(longStrike, shortStrike, criteria.strategyType)) {
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "NO_VALID_STRIKES",
        user_message: `Spread is inverted after strike selection (long $${longStrike} / short $${shortStrike}). Cannot form valid ${STRATEGY_LABELS[criteria.strategyType]}.`,
        fallback_params: criteria,
      },
    };
  }

  const longBid = longContract.bid ?? 0;
  const longAsk = longContract.ask ?? 0;
  const shortBid = shortContract.bid ?? 0;
  const shortAsk = shortContract.ask ?? 0;

  if ((longBid === 0 && longAsk === 0) || (shortBid === 0 && shortAsk === 0)) {
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "PRICING_INVALID",
        user_message: `No market exists for one or both legs of ${criteria.ticker} spread. Bid and ask are both zero.`,
        fallback_params: criteria,
      },
    };
  }

  if (longBid > longAsk || shortBid > shortAsk) {
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "PRICING_INVALID",
        user_message: `Corrupt pricing data for ${criteria.ticker}: bid > ask on one or both legs.`,
        fallback_params: criteria,
      },
    };
  }

  const longExecPrice = longAsk;
  const shortExecPrice = shortBid;
  const longMid = +((longBid + longAsk) / 2).toFixed(2);
  const shortMid = +((shortBid + shortAsk) / 2).toFixed(2);

  let executableAmount: number;
  let midAmount: number;
  let pricingType: "debit" | "credit";

  if (isDebit) {
    executableAmount = +(longExecPrice - shortExecPrice).toFixed(2);
    midAmount = +(longMid - shortMid).toFixed(2);
    pricingType = "debit";
  } else {
    executableAmount = +(shortExecPrice - longExecPrice).toFixed(2);
    midAmount = +(shortMid - longMid).toFixed(2);
    pricingType = "credit";
  }

  if (executableAmount <= 0) {
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "PRICING_INVALID",
        user_message: `Calculated net ${pricingType} is $${executableAmount.toFixed(2)}, which is invalid. The spread may not be worth trading at current prices.`,
        fallback_params: criteria,
      },
    };
  }

  for (const c of [longContract, shortContract]) {
    const bid = c.bid ?? 0;
    const ask = c.ask ?? 0;
    const mid = (bid + ask) / 2;
    const spread = ask - bid;
    if (mid > 0 && spread > mid * 0.20 && spread > 0.15) {
      warnings.push(`Wide bid-ask on $${c.strike} strike: $${bid.toFixed(2)} / $${ask.toFixed(2)} (spread $${spread.toFixed(2)}).`);
    }
  }

  const actualWidth = Math.abs(longStrike - shortStrike);
  const pnl = calcPnL(
    criteria.strategyType,
    longStrike,
    shortStrike,
    executableAmount,
    actualWidth,
  );

  if (pnl.max_loss_per_contract <= 0) {
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "PRICING_INVALID",
        user_message: "Calculated max loss per contract is $0 or negative. Something is wrong with the pricing.",
        fallback_params: criteria,
      },
    };
  }

  const maxRiskPct = criteria.positionSize === "FULL" ? 0.02 : 0.01;
  const maxRiskPerTrade = account.netLiquidatingValue * maxRiskPct;
  const riskBased = Math.floor(maxRiskPerTrade / pnl.max_loss_per_contract);

  let bprPerContract: number;
  if (isDebit) {
    bprPerContract = executableAmount * 100;
  } else {
    bprPerContract = (actualWidth - executableAmount) * 100;
  }

  const commissionBuffer = 2.0;
  const adjustedBP = Math.max(0, account.availableBuyingPower - commissionBuffer);
  const bpBased = bprPerContract > 0 ? Math.floor(adjustedBP / bprPerContract) : 0;

  let recommendedContracts = Math.min(riskBased, bpBased);

  if (recommendedContracts <= 0) {
    recommendedContracts = 1;

    if (pnl.max_loss_per_contract > maxRiskPerTrade) {
      warnings.push(
        `Trade risk ($${pnl.max_loss_per_contract} per contract) exceeds your per-trade risk limit ($${Math.round(maxRiskPerTrade)}). Showing minimum 1 contract.`
      );
    }
    if (bprPerContract > account.availableBuyingPower) {
      warnings.push(
        `Insufficient buying power for this trade. Available: $${Math.round(account.availableBuyingPower)}, Required: $${Math.round(bprPerContract)}.`
      );
    }
  }

  recommendedContracts = Math.min(recommendedContracts, 50);

  const longLeg: ResolvedLeg = {
    type: contractType,
    action: "buy",
    strike: longStrike,
    bid: longBid,
    ask: longAsk,
    mid: longMid,
    executable_price: longExecPrice,
    delta: longContract.delta ?? 0,
    open_interest: longContract.openInterest ?? 0,
    volume: longContract.volume ?? 0,
    schwabSymbol: longContract.schwabSymbol,
  };

  const shortLeg: ResolvedLeg = {
    type: contractType,
    action: "sell",
    strike: shortStrike,
    bid: shortBid,
    ask: shortAsk,
    mid: shortMid,
    executable_price: shortExecPrice,
    delta: shortContract.delta ?? 0,
    open_interest: shortContract.openInterest ?? 0,
    volume: shortContract.volume ?? 0,
    schwabSymbol: shortContract.schwabSymbol,
  };

  const pricingDisplay = pricingType === "debit"
    ? `Estimated fill: $${executableAmount.toFixed(2)} debit (mid: $${midAmount.toFixed(2)})`
    : `Estimated fill: $${executableAmount.toFixed(2)} credit (mid: $${midAmount.toFixed(2)})`;

  const now = new Date();
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const etParts = etFormatter.formatToParts(now);
  const getP = (t: string) => etParts.find(p => p.type === t)?.value ?? "00";
  const asOfTimestamp = `${getP("year")}-${getP("month")}-${getP("day")}T${getP("hour")}:${getP("minute")}:${getP("second")}-04:00`;

  const trade: ResolvedTrade = {
    schema_version: "1.0.0",
    ticker: criteria.ticker,
    strategy: STRATEGY_LABELS[criteria.strategyType] ?? criteria.strategyType,
    direction: criteria.direction === "BEARISH" ? "BEARISH" : "BULLISH",
    expiration: selectedExpiration,
    dte,
    legs: [longLeg, shortLeg],
    pricing: {
      type: pricingType,
      executable_amount: executableAmount,
      mid_amount: midAmount,
      display: pricingDisplay,
    },
    risk: pnl,
    sizing: {
      recommended_contracts: recommendedContracts,
      total_risk: pnl.max_loss_per_contract * recommendedContracts,
      total_max_gain: pnl.max_gain_per_contract * recommendedContracts,
      size_modifier: criteria.positionSize,
      account_net_liq: account.netLiquidatingValue,
      available_buying_power: account.availableBuyingPower,
      max_risk_per_trade: Math.round(maxRiskPerTrade),
    },
    warnings,
    as_of_timestamp: asOfTimestamp,
    chain_source: chainSource,
    source: scannerData ? "scanner" : "manual",
    micro_override: scannerData?.microOverrideEligible ?? false,
    scanner_score: scannerData?.totalScore ?? null,
  };

  const schemaError = validateSchema(trade);
  if (schemaError) {
    return {
      resolved: false,
      error: {
        error: true,
        error_code: "PRICING_INVALID",
        user_message: `Schema validation failed: ${schemaError}. The resolved trade cannot be displayed.`,
        fallback_params: criteria,
      },
    };
  }

  return { resolved: true, trade };
}
