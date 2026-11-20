/** Minimal shape for pickers — matches OptionsTab `ExpirationGroup` / AT chrome rows. */
export type ExpirationDteRow = { expiration: string; dte: number };

function isTradableDte(_dte: number, _nowMs: number): boolean {
  return true;
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

export type ExpiryCatalogRow = ExpirationDteRow;

function sortExpiryCatalog(rows: ExpiryCatalogRow[]): ExpiryCatalogRow[] {
  return [...rows].sort((a, b) => a.dte - b.dte || a.expiration.localeCompare(b.expiration));
}

function sameExpiryCatalog(a: ExpiryCatalogRow[], b: ExpiryCatalogRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.expiration !== b[i]!.expiration || a[i]!.dte !== b[i]!.dte) return false;
  }
  return true;
}

/**
 * The chain's full date list and the ladder's single-expiry strike page are
 * different responses. A one-date page must not erase the dates already known.
 */
export function mergeExpiryCatalog(
  prev: ExpiryCatalogRow[],
  incoming: ExpiryCatalogRow[],
  source: "chain" | "at",
): ExpiryCatalogRow[] {
  if (!incoming.length) return prev;
  const rows = incoming.map((row) => ({ expiration: row.expiration, dte: row.dte }));
  if (source === "chain" && rows.length >= prev.length) {
    const next = sortExpiryCatalog(rows);
    return sameExpiryCatalog(prev, next) ? prev : next;
  }
  if (prev.length > rows.length) return prev;
  const merged = new Map(prev.map((row) => [row.expiration, row]));
  for (const row of rows) merged.set(row.expiration, row);
  const next = sortExpiryCatalog([...merged.values()]);
  return sameExpiryCatalog(prev, next) ? prev : next;
}

/**
 * Keep the expiry the user already chose. A strike page that came back for a
 * different date is not a reason to switch.
 */
export function resolveSelectedExpiration(input: {
  previous: string | null;
  catalog: ExpiryCatalogRow[];
  expanded: Iterable<string>;
  nowMs: number;
}): string | null {
  const tradable = filterAtExpiryPillGroups(input.catalog, input.nowMs);
  const known = (expiration: string) =>
    tradable.some((row) => row.expiration === expiration) ||
    input.catalog.some((row) => row.expiration === expiration);
  if (input.previous && known(input.previous)) return input.previous;
  if (input.previous && tradable.length <= 1) return input.previous;
  const opened = [...input.expanded];
  for (let i = opened.length - 1; i >= 0; i--) {
    const expiration = opened[i]!;
    if (known(expiration)) return expiration;
  }
  if (!tradable.length) return input.previous;
  return nearestTradableExpiration(tradable, input.nowMs)?.expiration ?? input.previous;
}