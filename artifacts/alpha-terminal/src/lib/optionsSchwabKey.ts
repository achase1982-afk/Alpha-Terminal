export function buildSchwabOptionKey(underlying: string, expiration: string, strike: number, type: "C" | "P"): string {
  const d = new Date(expiration.split(":")[0].trim());
  if (Number.isNaN(d.getTime())) return "";
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  const sym = underlying.toUpperCase().replace(/^\$/, "").padEnd(6, " ");
  return `${sym}${yy}${mm}${dd}${type}${strikePadded}`;
}

export function findAtmStrikeIndex(strikes: number[], lastPrice: number | null): number {
  if (lastPrice == null || strikes.length === 0) return -1;
  let best = 0;
  let bestDist = Math.abs(strikes[0] - lastPrice);
  for (let i = 1; i < strikes.length; i++) {
    const d = Math.abs(strikes[i] - lastPrice);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

export function formatCompactQty(val: number | null | undefined): string {
  if (val == null || Number.isNaN(val)) return "\u2014";
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(Math.round(val));
}