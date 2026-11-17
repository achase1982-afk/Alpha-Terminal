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

/** Best-effort root symbol from a Schwab OCC option key. */
export function parseOccUnderlyingRoot(symbol: string): string | null {
  const m = symbol.trim().match(/^([A-Z.$]{1,6})\s+\d{6}[CP]/i);
  if (!m?.[1]) return null;
  return m[1].replace(/^\$/, "").toUpperCase();
}

/** YYMMDD segment after root in OCC (for grouping expiries). */
export function parseOccExpiryKey(symbol: string): string | null {
  const m = symbol.trim().match(/^[A-Z.$]{1,6}\s+(\d{6})[CP]/i);
  return m?.[1] ?? null;
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

/** Sort strikes NTM within each expiry, then interleave nearest expiries (round-robin). */
export function sortChainKeysNearTheMoneyInterleaved(keys: string[], spot: number | null): string[] {
  if (spot == null || !Number.isFinite(spot) || keys.length <= 1) {
    return sortOptionKeysNearTheMoney(keys, spot);
  }
  const byExp = new Map<string, string[]>();
  for (const k of keys) {
    const exp = parseOccExpiryKey(k) ?? "";
    const list = byExp.get(exp) ?? [];
    list.push(k);
    byExp.set(exp, list);
  }
  for (const [exp, list] of byExp) {
    byExp.set(exp, sortOptionKeysNearTheMoney(list, spot));
  }
  const expOrder = [...byExp.entries()]
    .map(([exp, list]) => {
      const atm = list[0];
      const strike = atm ? parseOccOptionStrike(atm) : null;
      const dist = strike == null ? Number.POSITIVE_INFINITY : Math.abs(strike - spot);
      return { exp, dist, list };
    })
    .sort((a, b) => a.dist - b.dist || a.exp.localeCompare(b.exp));
  const out: string[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const row of expOrder) {
      const next = row.list.shift();
      if (next) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
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
