import type { EconomicsLeg } from "./orderEconomics.js";

export type PayoffLeg = EconomicsLeg & {
  assetType?: "EQUITY" | "OPTION";
};

export interface ExpirationPayoffInput {
  legs: PayoffLeg[];
  netPerShare: number;
  spreadUnits: number;
  isCredit: boolean;
  isOption: boolean;
}

export interface ExpirationPayoffResult {
  maxLoss: number | null;
  maxProfit: number;
  breakevens: number[];
}

function isEquityLeg(leg: PayoffLeg): boolean {
  return leg.assetType === "EQUITY" || leg.optionType === "EQUITY";
}

function signedContracts(leg: PayoffLeg): number {
  const q = leg.quantity ?? 1;
  return leg.instruction.startsWith("BUY") ? q : -q;
}

function legPayoffDollars(leg: PayoffLeg, S: number, spreadUnits: number): number {
  if (isEquityLeg(leg)) {
    return signedContracts(leg) * S;
  }
  const sc = signedContracts(leg);
  const intrinsic =
    leg.optionType === "CALL" ? Math.max(0, S - leg.strike) : Math.max(0, leg.strike - S);
  return sc * intrinsic * 100 * spreadUnits;
}

export function payoffDollarsAtS(input: ExpirationPayoffInput, S: number): number {
  const { legs, netPerShare, spreadUnits, isCredit, isOption } = input;
  const position = legs.reduce((s, l) => s + legPayoffDollars(l, S, spreadUnits), 0);
  const premium = netPerShare * (isOption ? 100 : 1) * spreadUnits;
  return isCredit ? position + premium : position - premium;
}

/** Per-share slope for S above all strikes: signed call qty + stock shares. */
function rightTailSlopePerShare(legs: PayoffLeg[]): number {
  let slope = 0;
  for (const leg of legs) {
    if (isEquityLeg(leg)) slope += signedContracts(leg);
    else if (leg.optionType === "CALL") slope += signedContracts(leg);
  }
  return slope;
}

function dollarTailSlope(unitSlope: number, spreadUnits: number, isOption: boolean, legs: PayoffLeg[]): number {
  const hasEquityOnly = legs.length > 0 && legs.every(isEquityLeg);
  if (hasEquityOnly || !isOption) return unitSlope;
  return unitSlope * 100 * spreadUnits;
}

function sortedBreakpoints(legs: PayoffLeg[]): number[] {
  const strikes = [...new Set(legs.filter((l) => !isEquityLeg(l)).map((l) => l.strike))].sort(
    (a, b) => a - b,
  );
  return [0, ...strikes];
}

function rootsOnSegment(s0: number, p0: number, s1: number, p1: number): number[] {
  if (s1 === s0) return p0 === 0 ? [s0] : [];
  if (p0 === 0) return [s0];
  if (p1 === 0) return [s1];
  if (p0 * p1 > 0) return [];
  return [s0 - (p0 * (s1 - s0)) / (p1 - p0)];
}

/** 1:2:1 fly worst-case vs breakpoint scan (BWB wide-wing margin). */
function oneTwoOneFlyMaxLossFloor(input: ExpirationPayoffInput): number | null {
  const { legs, netPerShare, spreadUnits, isCredit, isOption } = input;
  if (legs.length !== 3) return null;
  const optLegs = legs.filter((l) => !isEquityLeg(l));
  if (optLegs.length !== 3) return null;
  if (!optLegs.every((l) => l.optionType === optLegs[0].optionType)) return null;
  const sorted = [...optLegs].sort((a, b) => a.strike - b.strike);
  const q = (l: PayoffLeg) => l.quantity ?? 1;
  if (!(q(sorted[0]) === 1 && q(sorted[1]) === 2 && q(sorted[2]) === 1)) return null;
  const wLo = sorted[1].strike - sorted[0].strike;
  const wHi = sorted[2].strike - sorted[1].strike;
  if (wLo <= 0 || wHi <= 0) return null;
  const mult = isOption ? 100 * spreadUnits : spreadUnits;
  const symmetric = Math.abs(wLo - wHi) < 1e-6;
  if (symmetric) {
    return isCredit ? Math.max(0, wLo - netPerShare) * mult : Math.max(0, netPerShare) * mult;
  }
  const narrow = Math.min(wLo, wHi);
  const wide = Math.max(wLo, wHi);
  return isCredit
    ? Math.max(0, wide - netPerShare) * mult
    : Math.max(netPerShare, narrow + netPerShare) * mult;
}

export function analyzeExpirationPayoff(input: ExpirationPayoffInput): ExpirationPayoffResult {
  const { legs, spreadUnits, isOption } = input;
  const points = sortedBreakpoints(legs);

  const unitRight = rightTailSlopePerShare(legs);
  const dollarRight = dollarTailSlope(unitRight, spreadUnits, isOption, legs);

  if (dollarRight < 0) {
    return { maxLoss: null, maxProfit: Number.POSITIVE_INFINITY, breakevens: [] };
  }

  const samples = points.map((s) => ({ s, p: payoffDollarsAtS(input, s) }));

  let minP = samples[0].p;
  let maxP = samples[0].p;
  for (const { p } of samples) {
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }

  let maxLoss = Math.max(0, -minP);
  const flyFloor = oneTwoOneFlyMaxLossFloor(input);
  if (flyFloor != null && input.isCredit) maxLoss = Math.max(maxLoss, flyFloor);

  const maxProfit = dollarRight > 0 ? Number.POSITIVE_INFINITY : Math.max(0, maxP);

  const breakevens: number[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    breakevens.push(
      ...rootsOnSegment(samples[i].s, samples[i].p, samples[i + 1].s, samples[i + 1].p),
    );
  }

  const last = samples[samples.length - 1];
  if (last && dollarRight !== 0) {
    const root = last.s - last.p / dollarRight;
    if (root > last.s && Number.isFinite(root)) breakevens.push(root);
  }

  const uniq = [...new Set(breakevens.filter((b) => Number.isFinite(b) && b >= 0))].sort(
    (a, b) => a - b,
  );

  return { maxLoss, maxProfit, breakevens: uniq };
}