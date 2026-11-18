/**
 * Low zone (ref) upper edge — Quinn fixed-K release (session low + K, zone top rounded 0.5 only).
 * Display-only; separate from Keep-away thresholds.
 */

export const AT_LOW_ZONE_NUMBERS_ENABLED = true;

/** Fixed 2026 YTD reference offset (not a runtime-tuned forecast). */
export const SPX_LOW_ZONE_K_REF = 35;

export const LOW_ZONE_REF_TOOLTIP =
  "K=35 is a fixed 2026 YTD reference from final daily lows (2026 YTD $SPX daily candles, close minus same-session low: median 29.5, mean 36.6, p25 14.9, p10 7.3, n=221). Historical reference from final daily lows — not a forecast of the running intraday low. Display only — not a safe level.";

export type LowZoneSlotDisplay =
  | { status: "hidden" }
  | { status: "pending" }
  | { status: "band"; dayLow: number; top: number };

export function isAfter1PmEt(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return h * 60 + m >= 13 * 60;
}

export function roundLowZoneTop(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 2) / 2;
}

export function computeLowZoneTopRef(sessionLow: number, k = SPX_LOW_ZONE_K_REF): number | null {
  if (!Number.isFinite(sessionLow) || sessionLow <= 0) return null;
  const raw = sessionLow + k;
  const rounded = roundLowZoneTop(raw);
  return Number.isFinite(rounded) ? rounded : null;
}

export function resolveLowZoneSlotDisplay(
  sessionLow: number | null,
  opts?: { showSlot?: boolean },
): LowZoneSlotDisplay {
  if (opts?.showSlot === false) return { status: "hidden" };
  if (!AT_LOW_ZONE_NUMBERS_ENABLED) return { status: "pending" };
  if (sessionLow == null) return { status: "pending" };
  const top = computeLowZoneTopRef(sessionLow);
  if (top == null) return { status: "pending" };
  return { status: "band", dayLow: sessionLow, top };
}

export function formatLowZoneTopDisplay(top: number): string {
  const frac = Math.abs(top * 2) % 2 === 1;
  return top.toLocaleString("en-US", {
    minimumFractionDigits: frac ? 1 : 0,
    maximumFractionDigits: frac ? 1 : 0,
  });
}