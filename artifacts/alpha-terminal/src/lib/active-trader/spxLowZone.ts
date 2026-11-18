/**
 * Low zone (ref) = session low + K (fixed K=35 this release).
 * Display-only — not used for keep-away or order rules.
 * Only the derived Low zone (ref) top is rounded to 0.5; day low keeps feed precision.
 */

/** Fixed offset for Low zone (ref); not exposed in UI/settings this release. */
export const SPX_LOW_ZONE_K_DEFAULT = 35;

export const SPX_LOW_ZONE_TOOLTIP =
  "Day low updates from Schwab L1 stream field 11 (same SSE feed as the AT header; not minute-bar REST polling). Low zone (ref) = day low + 35 (K fixed at 35 this release). +35 is a historical reference from FINAL daily lows (2026 YTD $SPX daily candles, close minus same-session low: median 29.5, mean 36.6, p25 14.9, p10 7.3, n=221). It is NOT a forecast based on the running intraday low (e.g. at 2 p.m.). Display only — not a safe level.";

const ET = "America/New_York";

export function readEtClock(now: Date): {
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

export function isAfter1PmEt(now: Date): boolean {
  const { hour, minute } = readEtClock(now);
  return hour * 60 + minute >= 13 * 60;
}

export function roundToHalfPoint(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 2) / 2;
}

/** @param k Test-only override; production always uses {@link SPX_LOW_ZONE_K_DEFAULT}. */
export function computeLowZoneTop(sessionLow: number, k: number = SPX_LOW_ZONE_K_DEFAULT): number | null {
  if (!Number.isFinite(sessionLow) || sessionLow <= 0) return null;
  return roundToHalfPoint(sessionLow + k);
}

export function formatAsOfEtLabel(barTime: Date | null | undefined): string | null {
  if (barTime == null || Number.isNaN(barTime.getTime())) return null;
  const { hour, minute } = readEtClock(barTime);
  const mm = String(minute).padStart(2, "0");
  return `as of ${hour}:${mm} ET`;
}

export function formatAsOfEtLabelFromMs(tsMs: number | null | undefined): string | null {
  if (tsMs == null || !Number.isFinite(tsMs) || tsMs <= 0) return null;
  return formatAsOfEtLabel(new Date(tsMs));
}

/** Low zone (ref) top — half-point rounded for display. */
export function formatLowZoneRefDisplay(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = roundToHalfPoint(n);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
