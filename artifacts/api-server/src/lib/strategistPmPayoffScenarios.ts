import { bsPrice } from "./bsmIV.js";
import type { ConvictionDeskResult, DeskLeg, DeskResult } from "./strategistDeskSchemas.js";

const RISK_FREE = 0.045;

export type PayoffScenario = {
  underlyingPrice: number;
  spreadValue: number;
  pnl: number;
  pnlColor: "green" | "red" | "neutral";
};

export type PayoffScenariosSummary = {
  peakPnl: number;
  peakPnlPrice: number;
  profitZoneLow: number | null;
  profitZoneHigh: number | null;
  upsideBreakdown: number | null;
  downsideBreakdown: number | null;
};

export type DeskPayoffScenarioResult = {
  scenarios: PayoffScenario[];
  scenariosSummary: PayoffScenariosSummary;
};

function linearInterpPriceAtPnl(a: PayoffScenario, b: PayoffScenario, targetPnl: number): number | null {
  const dp = b.pnl - a.pnl;
  if (Math.abs(dp) < 1e-10) return null;
  const t = (targetPnl - a.pnl) / dp;
  if (t < -1e-6 || t > 1 + 1e-6) return null;
  const u = Math.max(0, Math.min(1, t));
  return a.underlyingPrice + u * (b.underlyingPrice - a.underlyingPrice);
}

function parseYmd(iso: string): Date | null {
  const clean = iso.split(":")[0].trim();
  const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function yearsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms / (365 * 24 * 60 * 60 * 1000);
}

/** ATM IV (decimal) for expiration `target`, from termStructure5pt (IV in percent). */
function ivForExpiry(
  term: Array<{ expiry: string; daysToExpiry: number; atmIV: number | null }>,
  targetIso: string,
): number | null {
  const target = parseYmd(targetIso);
  if (!target || term.length === 0) return null;

  const exact = term.find((row) => row.expiry.split(":")[0].trim() === targetIso.split(":")[0].trim());
  if (exact?.atmIV != null && Number.isFinite(exact.atmIV)) {
    return exact.atmIV / 100;
  }

  let best: { d: number; iv: number } | null = null;
  for (const row of term) {
    if (row.atmIV == null || !Number.isFinite(row.atmIV)) continue;
    const d = parseYmd(row.expiry);
    if (!d) continue;
    const dist = Math.abs(d.getTime() - target.getTime());
    if (!best || dist < best.d) {
      best = { d: dist, iv: row.atmIV / 100 };
    }
  }
  return best?.iv ?? null;
}

function intrinsic(call: boolean, S: number, K: number): number {
  return call ? Math.max(0, S - K) : Math.max(0, K - S);
}

function isSellAction(action: string): boolean {
  const a = action.toLowerCase();
  return a === "sell" || a.startsWith("sell");
}

function legOptionValue(args: {
  S: number;
  strike: number;
  isCall: boolean;
  legExpIso: string;
  frontDate: Date;
  sigma: number;
  r: number;
}): number {
  const { S, strike, isCall, legExpIso, frontDate, sigma, r } = args;
  const legEnd = parseYmd(legExpIso);
  if (!legEnd) return NaN;

  if (legEnd.getTime() <= frontDate.getTime()) {
    return intrinsic(isCall, S, strike);
  }

  const T = yearsBetween(frontDate, legEnd);
  if (T <= 0) return intrinsic(isCall, S, strike);
  if (!Number.isFinite(sigma) || sigma <= 0) return NaN;
  return bsPrice(S, strike, T, r, sigma, isCall);
}

/** Signed spread mark-to-market per share (long structure convention). */
function spreadMarkToMarket(
  legs: DeskLeg[],
  S: number,
  frontIso: string,
  term: Array<{ expiry: string; daysToExpiry: number; atmIV: number | null }>,
  r: number,
): number {
  const frontDate = parseYmd(frontIso);
  if (!frontDate) return NaN;

  let sum = 0;
  for (const leg of legs) {
    const qty = leg.quantity != null && leg.quantity > 0 ? leg.quantity : 1;
    const typ = String(leg.type).toLowerCase();
    const isCall = typ.includes("call");
    const sigma = ivForExpiry(term, leg.expiration);
    if (sigma == null) return NaN;

    const v = legOptionValue({
      S,
      strike: leg.strike,
      isCall,
      legExpIso: leg.expiration,
      frontDate,
      sigma,
      r,
    });
    if (!Number.isFinite(v)) return NaN;

    const sign = isSellAction(leg.action) ? -1 : 1;
    sum += sign * qty * v;
  }
  return sum;
}

function roundGridPrice(spot: number, x: number): number {
  const step = spot >= 150 ? 1.0 : 0.5;
  return Math.round(x / step) * step;
}

function centerUnderlyingPrice(structureType: string, legs: DeskLeg[]): number | null {
  if (legs.length === 0) return null;
  const t = structureType.toLowerCase();

  const expDates = legs.map((l) => parseYmd(l.expiration)).filter((d): d is Date => !!d);
  if (expDates.length === 0) return null;
  const minTime = Math.min(...expDates.map((d) => d.getTime()));
  const frontIso = legs.find((l) => parseYmd(l.expiration)?.getTime() === minTime)?.expiration ?? legs[0].expiration;

  if (t.includes("calendar") || t.includes("diagonal")) {
    const atFront = legs.filter((l) => l.expiration === frontIso || parseYmd(l.expiration)?.getTime() === minTime);
    const shortLeg = atFront.find((l) => isSellAction(l.action));
    if (shortLeg) return shortLeg.strike;
    const strikes = atFront.map((l) => l.strike);
    if (strikes.length) return strikes.reduce((a, b) => a + b, 0) / strikes.length;
  }

  if (t.includes("butterfly") || t.includes("condor") || t.includes("iron")) {
    const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
    if (strikes.length >= 3) return strikes[Math.floor(strikes.length / 2)];
    if (strikes.length === 2) return (strikes[0] + strikes[1]) / 2;
  }

  if (t.includes("vertical") || t.endsWith("spread")) {
    const buys = legs.filter((l) => !isSellAction(l.action));
    const sells = legs.filter((l) => isSellAction(l.action));
    if (buys.length && sells.length) {
      const kb = buys.map((l) => l.strike);
      const ks = sells.map((l) => l.strike);
      return (Math.min(...kb) + Math.max(...ks)) / 2;
    }
  }

  const strikes = legs.map((l) => l.strike);
  return strikes.reduce((a, b) => a + b, 0) / strikes.length;
}

function earliestLegExpirationIso(legs: DeskLeg[]): string | null {
  const dated = legs
    .map((l) => ({ iso: l.expiration, d: parseYmd(l.expiration) }))
    .filter((x): x is { iso: string; d: Date } => !!x.d);
  if (dated.length === 0) return null;
  dated.sort((a, b) => a.d.getTime() - b.d.getTime());
  return dated[0].iso;
}

function parseSpotFromDataPackage(dataPackage: string): number | null {
  try {
    const pkg = JSON.parse(dataPackage) as { price?: unknown };
    const p = pkg.price;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function impliedMoveDollarFromPkg(dataPackage: string): number | null {
  try {
    const pkg = JSON.parse(dataPackage) as {
      optionsChainSummary?: {
        impliedMove?: { dollar?: unknown } | null;
      };
    };
    const d = pkg.optionsChainSummary?.impliedMove?.dollar;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
  } catch {
    /* ignore */
  }
  return null;
}

function termFromPkg(dataPackage: string): Array<{ expiry: string; daysToExpiry: number; atmIV: number | null }> {
  try {
    const pkg = JSON.parse(dataPackage) as {
      optionsChainSummary?: { termStructure5pt?: unknown };
    };
    const t = pkg.optionsChainSummary?.termStructure5pt;
    if (!Array.isArray(t)) return [];
    return t.filter(
      (row): row is { expiry: string; daysToExpiry: number; atmIV: number | null } =>
        row != null &&
        typeof row === "object" &&
        typeof (row as { expiry?: unknown }).expiry === "string" &&
        typeof (row as { daysToExpiry?: unknown }).daysToExpiry === "number",
    );
  } catch {
    return [];
  }
}

function pnlColorFor(pnl: number): "green" | "red" | "neutral" {
  if (Math.abs(pnl) <= 0.1) return "neutral";
  return pnl > 0 ? "green" : "red";
}

/**
 * After a desk trade recommendation, compute a 7-point payoff grid at the front expiration.
 * Returns null when structure is missing, exotic, or numerically unstable.
 */
export function computeDeskPmPayoffScenarios(args: {
  deskResult: DeskResult;
  dataPackage: string;
}): DeskPayoffScenarioResult | null {
  const { deskResult, dataPackage } = args;
  const pm = deskResult.pm;
  if (pm.decision !== "trade" || !pm.structure || !pm.structure.legs?.length) return null;

  const legs = pm.structure.legs;
  const spot = parseSpotFromDataPackage(dataPackage);
  const term = termFromPkg(dataPackage);
  if (spot == null || term.length === 0) return null;

  const frontIso = earliestLegExpirationIso(legs);
  if (!frontIso) return null;

  const centerRaw = centerUnderlyingPrice(pm.structure.type ?? "", legs);
  if (centerRaw == null || !Number.isFinite(centerRaw)) return null;

  const oneMove = impliedMoveDollarFromPkg(dataPackage);
  const stepRaw = oneMove != null ? oneMove / 3 : Math.max(spot * 0.012, 0.5);

  const gridRaw: number[] = [];
  for (let k = -3; k <= 3; k++) {
    gridRaw.push(centerRaw + k * stepRaw);
  }

  const grid = gridRaw.map((x) => roundGridPrice(spot, x));

  const isCredit = pm.structure.credit_or_debit < 0;
  const entryMag = Math.abs(pm.structure.credit_or_debit);
  if (!Number.isFinite(entryMag)) return null;

  const scenarios: PayoffScenario[] = [];

  for (const S of grid) {
    const spreadValue = spreadMarkToMarket(legs, S, frontIso, term, RISK_FREE);
    if (!Number.isFinite(spreadValue)) return null;

    const pnl = isCredit ? entryMag - spreadValue : spreadValue - entryMag;
    if (!Number.isFinite(pnl)) return null;

    scenarios.push({
      underlyingPrice: S,
      spreadValue,
      pnl,
      pnlColor: pnlColorFor(pnl),
    });
  }

  let peakIdx = 0;
  for (let i = 1; i < scenarios.length; i++) {
    if (scenarios[i].pnl > scenarios[peakIdx].pnl) peakIdx = i;
  }
  const peak = scenarios[peakIdx];

  const sortedByPrice = [...scenarios].sort((x, y) => x.underlyingPrice - y.underlyingPrice);
  const winners = sortedByPrice.filter((s) => s.pnl > 0);
  const profitZoneLow = winners.length ? winners[0].underlyingPrice : null;
  const profitZoneHigh = winners.length ? winners[winners.length - 1].underlyingPrice : null;

  const stopLoss = pm.exit_plan?.stop_loss;
  const stopThresh =
    typeof stopLoss === "number" && Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : null;

  let downsideBreakdown: number | null = null;
  let upsideBreakdown: number | null = null;
  if (stopThresh != null) {
    const lossPnl = -stopThresh;
    const crossings: number[] = [];
    for (let i = 0; i < sortedByPrice.length - 1; i++) {
      const a = sortedByPrice[i];
      const b = sortedByPrice[i + 1];
      const x = linearInterpPriceAtPnl(a, b, lossPnl);
      if (x != null && Number.isFinite(x)) crossings.push(x);
    }
    const below = crossings.filter((x) => x < spot);
    const above = crossings.filter((x) => x > spot);
    if (below.length) downsideBreakdown = Math.max(...below);
    if (above.length) upsideBreakdown = Math.min(...above);
  }

  const scenariosSummary: PayoffScenariosSummary = {
    peakPnl: peak.pnl,
    peakPnlPrice: peak.underlyingPrice,
    profitZoneLow,
    profitZoneHigh,
    upsideBreakdown,
    downsideBreakdown,
  };

  return { scenarios, scenariosSummary };
}

/** Merge server payoff scenarios into desk PM output (no-op if computation fails). */
export function attachDeskPmPayoffScenarios(deskResult: DeskResult, dataPackage: string): DeskResult {
  const computed = computeDeskPmPayoffScenarios({ deskResult, dataPackage });
  if (!computed) {
    return {
      ...deskResult,
      pm: {
        ...deskResult.pm,
        scenarios: null,
        scenariosSummary: null,
      },
    };
  }
  return {
    ...deskResult,
    pm: {
      ...deskResult.pm,
      scenarios: computed.scenarios,
      scenariosSummary: computed.scenariosSummary,
    },
  };
}

function parseConvictionLegsToDeskLegs(raw: unknown): DeskLeg[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: DeskLeg[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const o = item as Record<string, unknown>;
    const type = o.type;
    const strike = o.strike;
    const action = o.action;
    const expiration = o.expiration ?? o.expiry;
    if (typeof type !== "string" || typeof action !== "string") return null;
    if (typeof expiration !== "string") return null;
    if (typeof strike !== "number" || !Number.isFinite(strike)) return null;
    const leg: DeskLeg = { type, strike, action, expiration };
    const qty = o.quantity;
    if (typeof qty === "number" && qty > 0) leg.quantity = qty;
    out.push(leg);
  }
  return out;
}

/** Merge server payoff scenarios into Conviction Desk result when chosen structure parses as standard legs. */
export function attachConvictionDeskPayoffScenarios(
  deskResult: ConvictionDeskResult,
  dataPackage: string,
): ConvictionDeskResult {
  const conv = deskResult.conviction;
  if (!conv || conv.decision.chosen == null || conv.size === "no-trade") {
    return { ...deskResult, payoffScenarios: null, payoffSummary: null };
  }
  const chosen = conv.decision.chosen;
  const legs = parseConvictionLegsToDeskLegs(chosen.legs);
  if (!legs) {
    return { ...deskResult, payoffScenarios: null, payoffSummary: null };
  }
  const stopLoss =
    typeof chosen.stop_loss === "number" && Number.isFinite(chosen.stop_loss) && chosen.stop_loss > 0
      ? chosen.stop_loss
      : 0;

  const synthetic: DeskResult = {
    mode: "solo_desk",
    ticker: deskResult.ticker,
    vol: { iv_state: "", term_structure: "", skew: "", implied_vs_realized: "", read: "" },
    flow: { dominant_flow: "", institutional_signal: "", retail_signal: "", key_strikes: [], read: "" },
    catalyst: { primary_catalyst: "", bar_to_clear: "", asymmetry: "", historical_pattern: "", read: "" },
    pm: {
      decision: "trade",
      structure: {
        type: chosen.structure,
        legs,
        expiry: chosen.expiry,
        credit_or_debit: chosen.credit_or_debit,
      },
      thesis: "",
      edge_check: "",
      deviation_from_analysts: "none",
      size: "medium",
      whose_side: "neither",
      biggest_risk: "",
      exit_plan: {
        profit_target: 0,
        stop_loss: stopLoss,
        time_stop: "",
      },
      watch_for: "",
    },
    models: deskResult.models,
  };

  const computed = computeDeskPmPayoffScenarios({ deskResult: synthetic, dataPackage });
  if (!computed) {
    return { ...deskResult, payoffScenarios: null, payoffSummary: null };
  }
  return {
    ...deskResult,
    payoffScenarios: computed.scenarios,
    payoffSummary: computed.scenariosSummary,
  };
}
