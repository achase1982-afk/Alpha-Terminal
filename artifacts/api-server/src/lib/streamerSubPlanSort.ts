/** Parse OCC strike from a Schwab option key (best-effort). */
export function parseOccOptionStrike(symbol: string): number | null {
  const m = symbol.match(/[CP](\d{8,})/);
  if (!m) return null;
  const raw = m[1]!;
  const whole = parseInt(raw.slice(0, -3), 10);
  const frac = parseInt(raw.slice(-3), 10);
  if (!Number.isFinite(whole)) return null;
  return whole + frac / 1000;
}

export function sortOptionKeysNearTheMoney(keys: string[], spot: number | null): string[] {
  if (spot == null || !Number.isFinite(spot)) return [...keys];
  return [...keys].sort((a, b) => {
    const sa = parseOccOptionStrike(a);
    const sb = parseOccOptionStrike(b);
    const da = sa == null ? Number.POSITIVE_INFINITY : Math.abs(sa - spot);
    const db = sb == null ? Number.POSITIVE_INFINITY : Math.abs(sb - spot);
    return da - db || a.localeCompare(b);
  });
}

export function trimKeysFurthestFromMoney(keys: string[], limit: number, spot: number | null): string[] {
  if (keys.length <= limit) return keys;
  if (spot == null || !Number.isFinite(spot)) return keys.slice(0, limit);
  const sorted = [...keys].sort((a, b) => {
    const sa = parseOccOptionStrike(a);
    const sb = parseOccOptionStrike(b);
    const da = sa == null ? -1 : Math.abs(sa - spot);
    const db = sb == null ? -1 : Math.abs(sb - spot);
    return db - da;
  });
  return sorted.slice(0, limit);
}