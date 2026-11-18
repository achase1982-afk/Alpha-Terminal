/** Minimal shape for pickers — matches OptionsTab `ExpirationGroup` / AT chrome rows. */
export type ExpirationDteRow = { expiration: string; dte: number };

/** Nearest expiration with dte >= 0 (groups must be sorted by dte ascending). */
export function nearestTradableExpiration<T extends ExpirationDteRow>(groups: T[]): T | null {
  if (!groups.length) return null;
  return groups.filter((g) => g.dte >= 0)[0] ?? null;
}

export function hasTradableExpirations(groups: ExpirationDteRow[]): boolean {
  return groups.some((g) => g.dte >= 0);
}

/** Active Trader expiry pill — hide expired series. */
export function filterAtExpiryPillGroups<T extends ExpirationDteRow>(groups: T[]): T[] {
  return groups.filter((g) => g.dte >= 0);
}