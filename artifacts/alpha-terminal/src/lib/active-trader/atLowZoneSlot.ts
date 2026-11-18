/**
 * Low-side reference zone (upper edge). Display only — no order rules.
 */

import {
  computeLowZoneTop,
  formatRefZoneHalf,
  SPX_REF_ZONE_K_DEFAULT,
} from "@/lib/active-trader/spxRefZone";

export type LowZoneSlotDisplay =
  | { status: "hidden" }
  | { status: "unavailable" }
  | { status: "value"; top: number };

export function resolveLowZoneSlotDisplay(
  sessionLow: number | null,
  opts?: { showSlot?: boolean; k?: number },
): LowZoneSlotDisplay {
  if (opts?.showSlot === false) return { status: "hidden" };
  if (sessionLow == null || !Number.isFinite(sessionLow) || sessionLow <= 0) {
    return { status: "unavailable" };
  }
  const top = computeLowZoneTop(sessionLow, opts?.k ?? SPX_REF_ZONE_K_DEFAULT);
  if (top == null) return { status: "unavailable" };
  return { status: "value", top };
}

export function lowZoneSlotLabel(display: LowZoneSlotDisplay): string {
  if (display.status === "hidden") return "";
  if (display.status === "unavailable") return "Low zone —";
  return `Low zone ${formatRefZoneHalf(display.top)}`;
}