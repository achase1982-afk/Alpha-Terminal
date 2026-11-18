/**
 * Low-side reference zone (upper edge). Display only — no order rules.
 */

import {
  computeLowZoneTop,
  formatRefZoneHalf,
  SPX_REF_ZONE_K_DEFAULT,
} from "@/lib/active-trader/spxRefZone";

export const AT_LOW_ZONE_NUMBERS_ENABLED = true;

/** Fixed 2026 YTD reference offset (not a runtime-tuned forecast). */
export const SPX_LOW_ZONE_K_REF = SPX_REF_ZONE_K_DEFAULT;

export const LOW_ZONE_REF_TOOLTIP =
  "K=35 is a fixed 2026 YTD reference from final daily lows (2026 YTD $SPX daily candles, close minus same-session low: median 29.5, mean 36.6, p25 14.9, p10 7.3, n=221). Historical reference from final daily lows — not a forecast of the running intraday low. Display only — not a safe level.";

export type LowZoneSlotDisplay =
  | { status: "hidden" }
  | { status: "unavailable" }
  | { status: "value"; top: number };

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

export function resolveLowZoneSlotDisplay(
  sessionLow: number | null,
  opts?: { showSlot?: boolean; k?: number },
): LowZoneSlotDisplay {
  if (opts?.showSlot === false) return { status: "hidden" };
  if (!AT_LOW_ZONE_NUMBERS_ENABLED) return { status: "unavailable" };
  if (sessionLow == null || !Number.isFinite(sessionLow) || sessionLow <= 0) {
    return { status: "unavailable" };
  }
  const top = computeLowZoneTop(sessionLow, opts?.k ?? SPX_REF_ZONE_K_DEFAULT);
  if (top == null) return { status: "unavailable" };
  return { status: "value", top };
}

/** @deprecated use computeLowZoneTop */
export function computeLowZoneTopRef(sessionLow: number, k = SPX_LOW_ZONE_K_REF): number | null {
  return computeLowZoneTop(sessionLow, k);
}

/** @deprecated use formatRefZoneHalf */
export function formatLowZoneTopDisplay(top: number): string {
  return formatRefZoneHalf(top);
}

export function lowZoneTopLabel(display: LowZoneSlotDisplay): string {
  if (display.status === "hidden") return "";
  if (display.status === "unavailable") return "Low zone top \u2014";
  return `Low zone top ${formatRefZoneHalf(display.top)}`;
}