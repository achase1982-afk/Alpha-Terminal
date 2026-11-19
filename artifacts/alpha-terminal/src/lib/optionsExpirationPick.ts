import { equityOptionsSessionEnded } from "@workspace/order-ticket-math";

/** Minimal shape for pickers — matches OptionsTab `ExpirationGroup` / AT chrome rows. */
export type ExpirationDteRow = { expiration: string; dte: number };

function isTradableDte(dte: number, nowMs: number): boolean {
  return dte > 0 || (dte === 0 && !equityOptionsSessionEnded(nowMs));
}

/** Nearest unexpired session (groups must be sorted by dte ascending). */
export function nearestTradableExpiration<T extends ExpirationDteRow>(
  groups: T[],
  nowMs = Date.now(),
): T | null {
  if (!groups.length) return null;
  return groups.find((g) => isTradableDte(g.dte, nowMs)) ?? null;
}

export function hasTradableExpirations(groups: ExpirationDteRow[], nowMs = Date.now()): boolean {
  return groups.some((g) => isTradableDte(g.dte, nowMs));
}

/** Active Trader expiry pill — hide expired series. */
export function filterAtExpiryPillGroups<T extends ExpirationDteRow>(
  groups: T[],
  nowMs = Date.now(),
): T[] {
  return groups.filter((g) => isTradableDte(g.dte, nowMs));
}