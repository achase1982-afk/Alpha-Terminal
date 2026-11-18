/**
 * High-side reference zone (lower edge). Display only — no order rules.
 */

import {
  computeHighZoneBottom,
  formatRefZoneHalf,
  SPX_REF_ZONE_K_DEFAULT,
} from "@/lib/active-trader/spxRefZone";

export type HighZoneSlotDisplay =
  | { status: "hidden" }
  | { status: "unavailable" }
  | { status: "value"; bottom: number };

export function resolveHighZoneSlotDisplay(
  sessionHigh: number | null,
  opts?: { showSlot?: boolean; k?: number },
): HighZoneSlotDisplay {
  if (opts?.showSlot === false) return { status: "hidden" };
  if (sessionHigh == null || !Number.isFinite(sessionHigh) || sessionHigh <= 0) {
    return { status: "unavailable" };
  }
  const bottom = computeHighZoneBottom(sessionHigh, opts?.k ?? SPX_REF_ZONE_K_DEFAULT);
  if (bottom == null) return { status: "unavailable" };
  return { status: "value", bottom };
}

export function highZoneBottomLabel(display: HighZoneSlotDisplay): string {
  if (display.status === "hidden") return "";
  if (display.status === "unavailable") return "High zone bottom \u2014";
  return `High zone bottom ${formatRefZoneHalf(display.bottom)}`;
}