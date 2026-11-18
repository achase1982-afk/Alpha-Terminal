/**
 * Low-side zone display (upper edge / band). Quant definition pending (Quinn).
 * No default offset or formula is shipped in production.
 */

export const AT_LOW_ZONE_NUMBERS_ENABLED = false;

export type LowZoneSlotDisplay =
  | { status: "hidden" }
  | { status: "pending" }
  | { status: "range"; low: number; high: number };

/**
 * Isolated hook point for the confirmed low-zone formula (offset, sample window, rounding).
 * Returns `pending` until `AT_LOW_ZONE_NUMBERS_ENABLED` and Quinn's definition lands here.
 */
export function resolveLowZoneSlotDisplay(
  _sessionLow: number | null,
  opts?: { showSlot?: boolean },
): LowZoneSlotDisplay {
  if (opts?.showSlot === false) return { status: "hidden" };
  if (!AT_LOW_ZONE_NUMBERS_ENABLED) return { status: "pending" };
  return { status: "pending" };
}