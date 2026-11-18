/**
 * SPX RTH session low + Low zone (ref) = sessionLow + K (default 35).
 * Display-only reference level — not used for keep-away or order rules.
 */

export const SPX_LOW_ZONE_K_DEFAULT = 35;

export const SPX_LOW_ZONE_TOOLTIP =
  "+35 is a historical reference from FINAL daily lows (2026 YTD $SPX daily candles, close minus same-session low: median 29.5, mean 36.6, p25 14.9, p10 7.3, n=221). It is NOT a forecast based on the running intraday low (e.g. at 2 p.m.). Display only — not a safe level.";

export type MinuteCandle = { datetime: string; low: number };

const ET = "America/New_York";

export function readEtClock(now: Date): {
  weekday: string;
  hour: number;
  minute: number;
  ymd: string;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { weekday, hour, minute, ymd: `${year}-${month}-${day}` };
}

export function isEtWeekday(weekday: string): boolean {
  return weekday !== "Sat" && weekday !== "Sun";
}

/** Inclusive 09:30–15:59 ET (RTH minute bars; 16:00 close is exclusive). */
export function isRthMinuteEt(hour: number, minute: number): boolean {
  const mins = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins < close;
}

export function isAfter1PmEt(now: Date): boolean {
  const { hour, minute } = readEtClock(now);
  return hour * 60 + minute >= 13 * 60;
}

export function roundToHalfPoint(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 2) / 2;
}

export function computeLowZoneTop(sessionLow: number, k = SPX_LOW_ZONE_K_DEFAULT): number | null {
  if (!Number.isFinite(sessionLow) || sessionLow <= 0) return null;
  return roundToHalfPoint(sessionLow + k);
}

/**
 * Running min of 1-minute lows on today's NY session date, RTH window only.
 * Returns null when no valid bar exists (pre-open, placeholders, bad data).
 */
export function computeRthSessionLowFromMinuteCandles(
  candles: MinuteCandle[],
  now: Date = new Date(),
): number | null {
  const { ymd: sessionYmd } = readEtClock(now);
  let minLow: number | null = null;

  for (const c of candles) {
    if (!Number.isFinite(c.low) || c.low <= 0) continue;
    const t = new Date(c.datetime);
    if (Number.isNaN(t.getTime())) continue;
    const et = readEtClock(t);
    if (et.ymd !== sessionYmd || !isEtWeekday(et.weekday)) continue;
    if (!isRthMinuteEt(et.hour, et.minute)) continue;
    minLow = minLow == null ? c.low : Math.min(minLow, c.low);
  }

  return minLow;
}

export function formatLowZoneLevel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = roundToHalfPoint(n);
  const frac = Math.abs(rounded * 2) % 2 === 1;
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: frac ? 1 : 0,
    maximumFractionDigits: frac ? 1 : 0,
  });
}