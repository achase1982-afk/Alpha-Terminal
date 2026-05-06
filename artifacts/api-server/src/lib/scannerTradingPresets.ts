/**
 * Layer 8 — curated trading presets matched against Layer 7 scores and raw Layer 2–6 fields.
 *
 * Preset order = priority for tie-breaking: first matching preset wins.
 */

import type { ScannerLayer7Scores } from "./scannerLayer7Scores.js";
import type { ScannerTechnicalLayer6Wire } from "./scannerTechnicalContext.js";

export type ScannerPresetMatchInput = ScannerLayer7Scores & {
  daysToEarnings: number | null;
  technical: ScannerTechnicalLayer6Wire | null;
};

function ok(n: number | null): n is number {
  return n != null && Number.isFinite(n);
}

function gte(a: number | null, min: number): boolean {
  return ok(a) && a >= min;
}

function between(a: number | null, lo: number, hi: number): boolean {
  return ok(a) && a >= lo && a <= hi;
}

function lte(a: number | null, max: number): boolean {
  return ok(a) && a <= max;
}

function daysBetween(d: number | null, lo: number, hi: number): boolean {
  return ok(d) && d >= lo && d <= hi;
}

export type ScannerTradingPresetName =
  | "Earnings Setup"
  | "Vol Squeeze"
  | "Momentum"
  | "Catalyst Play"
  | "Oversold Reversal";

type Rule = (ctx: ScannerPresetMatchInput) => boolean;

/**
 * Starter presets (priority order — index 0 wins over index 4 when multiple match).
 */
const PRESET_RULES: ReadonlyArray<{ name: ScannerTradingPresetName; matches: Rule }> = [
  {
    name: "Earnings Setup",
    matches: (ctx) =>
      // daysToEarnings between 1 and 14; elevated IV rank; tradeable liquidity
      daysBetween(ctx.daysToEarnings, 1, 14) &&
      gte(ctx.volatilityScore, 60) &&
      gte(ctx.liquidityScore, 50),
  },
  {
    name: "Vol Squeeze",
    matches: (ctx) =>
      // High IVR + consolidating technicals + meaningful flow
      gte(ctx.volatilityScore, 70) &&
      between(ctx.technicalScore, 40, 60) &&
      gte(ctx.flowScore, 50),
  },
  {
    name: "Momentum",
    matches: (ctx) =>
      gte(ctx.technicalScore, 70) && gte(ctx.flowScore, 60) && gte(ctx.volatilityScore, 40),
  },
  {
    name: "Catalyst Play",
    matches: (ctx) =>
      gte(ctx.catalystScore, 70) && gte(ctx.liquidityScore, 50) && gte(ctx.technicalScore, 50),
  },
  {
    name: "Oversold Reversal",
    matches: (ctx) => {
      const offHigh = ctx.technical?.off_fifty_two_week_high_pct ?? null;
      const vs200 = ctx.technical?.vs_two_hundred_ma_pct ?? null;
      // Meaningfully below 52w high; not deeply broken vs 200MA; flow confirms interest
      return lte(offHigh, -20) && gte(vs200, -10) && gte(ctx.flowScore, 50);
    },
  },
];

/**
 * Returns the first preset whose criteria all pass, or null if none match.
 */
export function matchScannerTradingPreset(ctx: ScannerPresetMatchInput): ScannerTradingPresetName | null {
  for (const { name, matches } of PRESET_RULES) {
    if (matches(ctx)) return name;
  }
  return null;
}
