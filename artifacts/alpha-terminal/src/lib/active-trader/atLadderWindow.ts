/**
 * Active Trader loads one expiry, 20 strikes above spot and 20 below.
 * Scrolling asks for the next 20 in that direction and drops the other
 * wing from the stream, not from the rows already on screen.
 * Schwab's account stream stays under ~300 symbols. This ladder keeps
 * its own LEVELONE_OPTIONS keys under 150 so the header tape still fits.
 */

export const AT_STRIKES_PER_PAGE = 20;
export const AT_STRIKE_SIDE_CAP = 80;
export const AT_STREAM_CONTRACT_CAP = 150;
export const AT_STREAM_OVERSCAN = 8;

export type AtChainRange = "NTM" | "SAK" | "SBK";

export type AtLadderRestQuery = {
  strikeCount: number;
  range: AtChainRange;
};

export function atLadderRestQuery(above: number, below: number): AtLadderRestQuery {
  const a = Math.min(AT_STRIKE_SIDE_CAP, Math.max(AT_STRIKES_PER_PAGE, above));
  const b = Math.min(AT_STRIKE_SIDE_CAP, Math.max(AT_STRIKES_PER_PAGE, below));
  // Schwab `/chains` centers `strikeCount` around ATM (`N/2` each side).
  // Request `2 * max(above, below)` centered strikes so the scrolled side
  // genuinely receives the next 20 strikes, then trim asymmetric wings client-side.
  return { strikeCount: Math.max(a, b) * 2, range: "NTM" };
}

export function growAtLadderSide(
  above: number,
  below: number,
  edge: "up" | "down",
): { above: number; below: number } {
  if (edge === "up") {
    return { above: Math.min(AT_STRIKE_SIDE_CAP, above + AT_STRIKES_PER_PAGE), below };
  }
  return { above, below: Math.min(AT_STRIKE_SIDE_CAP, below + AT_STRIKES_PER_PAGE) };
}

export type AtChainLeg = {
  strike: number;
  expiration: string;
  schwabSymbol?: string;
  streamKey?: string;
};

export function mergeAtChainLegs<T extends AtChainLeg>(
  prev: readonly T[],
  page: readonly T[],
  expirationYmd: string | null,
): T[] {
  const map = new Map<string, T>();
  const put = (leg: T) => {
    const ymd = (leg.expiration ?? "").slice(0, 10);
    if (expirationYmd && ymd !== expirationYmd) return;
    const id = `${ymd}|${leg.strike}`;
    const existing = map.get(id);
    map.set(id, existing ? { ...existing, ...leg } : leg);
  };
  for (const leg of prev) put(leg);
  for (const leg of page) put(leg);
  return [...map.values()];
}

export function trimAtChainLegsToDepth<T extends AtChainLeg>(
  legs: readonly T[],
  spot: number | null | undefined,
  above: number,
  below: number,
): T[] {
  if (!legs.length || spot == null || !Number.isFinite(spot)) return [...legs];
  const uniqueStrikes = [...new Set(legs.map((l) => l.strike))].sort((x, y) => x - y);
  if (uniqueStrikes.length <= above + below) return [...legs];

  let atmIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < uniqueStrikes.length; i++) {
    const d = Math.abs(uniqueStrikes[i]! - spot);
    if (d < minDist) {
      minDist = d;
      atmIdx = i;
    }
  }
  const lo = Math.max(0, atmIdx - below);
  const hi = Math.min(uniqueStrikes.length - 1, atmIdx + above);
  const allowed = new Set(uniqueStrikes.slice(lo, hi + 1));
  return legs.filter((l) => allowed.has(l.strike));
}

export type AtStreamRow = {
  strike: number;
  callKey?: string | null;
  putKey?: string | null;
};

/** Contracts whose strikes intersect the scrollport, plus a few rows of overscan. */
export function selectAtStreamKeys(input: {
  rows: readonly AtStreamRow[];
  visibleMin: number;
  visibleMax: number;
  overscan?: number;
  contractCap?: number;
}): string[] {
  const overscan = input.overscan ?? AT_STREAM_OVERSCAN;
  const cap = input.contractCap ?? AT_STREAM_CONTRACT_CAP;
  const sorted = [...input.rows].sort((a, b) => a.strike - b.strike);
  if (sorted.length === 0 || cap <= 0) return [];

  let iMin = sorted.findIndex((r) => r.strike >= input.visibleMin - 1e-6);
  if (iMin < 0) iMin = sorted.length - 1;
  let iMax = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.strike <= input.visibleMax + 1e-6) iMax = i;
  }
  if (iMax < 0) iMax = 0;
  if (iMin > iMax) {
    const mid = (input.visibleMin + input.visibleMax) / 2;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const d = Math.abs(sorted[i]!.strike - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    iMin = best;
    iMax = best;
  }

  const lo = Math.max(0, iMin - overscan);
  const hi = Math.min(sorted.length - 1, iMax + overscan);
  const mid = (input.visibleMin + input.visibleMax) / 2;
  const ranked: { key: string; dist: number }[] = [];
  for (let i = lo; i <= hi; i++) {
    const row = sorted[i]!;
    const dist = Math.abs(row.strike - mid);
    if (row.callKey) ranked.push({ key: row.callKey, dist });
    if (row.putKey) ranked.push({ key: row.putKey, dist });
  }
  ranked.sort((a, b) => a.dist - b.dist || a.key.localeCompare(b.key));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item.key);
    if (out.length >= cap) break;
  }
  return out;
}

export type AtChainQueryParams = {
  symbol?: string;
  fromDate?: string;
  toDate?: string;
  range?: string;
};

/**
 * While a strike window loads, the ladder may keep showing the previous
 * response only when that response was itself a ladder window for the same
 * symbol covering the same expiry (the next page of strikes, or the first
 * load before an expiry was picked).
 *
 * The Chain view's response has a handful of strikes across many expirations.
 * As a stand-in for the ladder window it would be a 10-strike ladder with an
 * empty screen below it, so it is never accepted.
 */
export function atLadderPlaceholderOk(
  previous: AtChainQueryParams | undefined,
  next: { symbol: string; fromDate: string; toDate: string },
): boolean {
  if (!previous?.fromDate || !previous.toDate || !previous.range) return false;
  if ((previous.symbol ?? "") !== next.symbol) return false;
  return previous.fromDate <= next.fromDate && previous.toDate >= next.toDate;
}
