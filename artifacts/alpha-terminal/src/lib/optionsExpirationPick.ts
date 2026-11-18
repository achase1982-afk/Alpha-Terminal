/** Minimal shape for pickers — matches OptionsTab `ExpirationGroup` / AT chrome rows. */
export type ExpirationDteRow = { expiration: string; dte: number };

/** Nearest expiration with dte >= 0 (groups must be sorted by dte ascending). */
export function nearestTradableExpiration<T extends ExpirationDteRow>(groups: T[]): T | null {
  if (!groups.length) return null;
  const tradable = groups.filter((g) => g.dte >= 0);
  return tradable[0] ?? groups[0] ?? null;
}

/** Active Trader expiry pill — hide expired series. */
export function filterAtExpiryPillGroups<T extends ExpirationDteRow>(groups: T[]): T[] {
  return groups.filter((g) => g.dte >= 0);
}