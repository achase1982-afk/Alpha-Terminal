/**
 * Low-side zone display (ref upper edge). K=35 fixed this release (display-only).
 */

import {
  SPX_LOW_ZONE_K_DEFAULT,
  computeLowZoneTop,
  formatLowZoneRefDisplay,
} from "@/lib/active-trader/spxLowZone";

export const AT_LOW_ZONE_NUMBERS_ENABLED = true;

export type LowZoneSlotDisplay =
  | { status: "hidden" }
  | { status: "pending" }
  | { status: "ref"; top: number; topLabel: string }
  | { status: "range"; low: number; high: number };

/**
 * Low zone (ref) = session low + K (fixed {@link SPX_LOW_ZONE_K_DEFAULT}).
 * `k` is not user-adjustable in UI this release.
 */
export function resolveLowZoneSlotDisplay(
  sessionLow: number | null,
  opts?: { showSlot?: boolean },
): LowZoneSlotDisplay {
  if (opts?.showSlot === false) return { status: "hidden" };
  if (!AT_LOW_ZONE_NUMBERS_ENABLED) return { status: "pending" };
  if (sessionLow == null || !Number.isFinite(sessionLow) || sessionLow <= 0) {
    return { status: "pending" };
  }
  const top = computeLowZoneTop(sessionLow, SPX_LOW_ZONE_K_DEFAULT);
  if (top == null) return { status: "pending" };
  return { status: "ref", top, topLabel: formatLowZoneRefDisplay(top) };
}