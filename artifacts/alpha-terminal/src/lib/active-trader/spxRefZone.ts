/**
 * SPX display-only session reference zones (Low zone top / High zone bottom).
 * K offset is a historical reference — not keep-away or order logic.
 */

export const SPX_REF_ZONE_K_DEFAULT = 35;

export const SPX_REF_ZONE_TOOLTIP =
  "±35 pt reference bands from running session low/high (half-point rounded). Historical desk reference only — not protection or a forecast.";

export function roundToHalfPoint(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 2) / 2;
}

/** Upper edge of low-side reference band: sessionLow + K. */
export function computeLowZoneTop(sessionLow: number, k = SPX_REF_ZONE_K_DEFAULT): number | null {
  if (!Number.isFinite(sessionLow) || sessionLow <= 0) return null;
  return roundToHalfPoint(sessionLow + k);
}

/** Lower edge of high-side reference band: sessionHigh − K. */
export function computeHighZoneBottom(sessionHigh: number, k = SPX_REF_ZONE_K_DEFAULT): number | null {
  if (!Number.isFinite(sessionHigh) || sessionHigh <= 0) return null;
  return roundToHalfPoint(sessionHigh - k);
}

/** Half-point labels for zone refs only. */
export function formatRefZoneHalf(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = roundToHalfPoint(n);
  const frac = Math.abs(rounded * 2) % 2 === 1;
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: frac ? 1 : 0,
    maximumFractionDigits: frac ? 1 : 0,
  });
}

/** Session low/high at feed precision (not half-point snapped). */
export function formatSessionFeedLevel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const frac = Math.abs(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: frac ? 2 : 0,
    maximumFractionDigits: frac ? 2 : 0,
  });
}