/**
 * SPX display-only session reference zones (Low zone top / High zone bottom).
 * k = 0.4% of price — historical reference band, not keep-away or order logic.
 */

/** Fraction of spot: 0.004 = 0.4% (≈29 pts at 7,340). Display reference only. */
export const SPX_REF_ZONE_K_DEFAULT = 0.004;

export const SPX_REF_ZONE_TOOLTIP =
  "k=0.4% of session low/high (SPX keep-away reference from ~16y daily stats). Anthony rule: sell shorts only when spot is outside both bands — shown here as a reference only, not order logic. Display only — not a safe level.";

export function roundToHalfPoint(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 2) / 2;
}

/** Upper edge of low-side reference band: sessionLow × (1 + k). */
export function computeLowZoneTop(sessionLow: number, k = SPX_REF_ZONE_K_DEFAULT): number | null {
  if (!Number.isFinite(sessionLow) || sessionLow <= 0) return null;
  return roundToHalfPoint(sessionLow * (1 + k));
}

/** Lower edge of high-side reference band: sessionHigh × (1 − k). */
export function computeHighZoneBottom(sessionHigh: number, k = SPX_REF_ZONE_K_DEFAULT): number | null {
  if (!Number.isFinite(sessionHigh) || sessionHigh <= 0) return null;
  return roundToHalfPoint(sessionHigh * (1 - k));
}

/** Half-point labels for zone refs only. */
export function formatRefZoneHalf(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const rounded = roundToHalfPoint(n);
  const frac = Math.abs(rounded * 2) % 2 === 1;
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: frac ? 1 : 0,
    maximumFractionDigits: frac ? 1 : 0,
  });
}

/** Session low/high at feed precision (not half-point snapped). */
export function formatSessionFeedLevel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const frac = Math.abs(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: frac ? 2 : 0,
    maximumFractionDigits: frac ? 2 : 0,
  });
}