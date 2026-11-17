/**
 * Nearest strike to spot; ties prefer the lower strike (documented QA-09 rule).
 */
export function resolveAtmStrike(strikes: number[], spot: number): number | null {
  if (!strikes.length || !Number.isFinite(spot)) return null;
  let bestStrike = strikes[0];
  let bestDiff = Math.abs(strikes[0] - spot);
  for (let i = 1; i < strikes.length; i++) {
    const s = strikes[i];
    const diff = Math.abs(s - spot);
    if (diff < bestDiff || (diff === bestDiff && s < bestStrike)) {
      bestStrike = s;
      bestDiff = diff;
    }
  }
  return bestStrike;
}

export function isAtmStrike(strike: number, atmStrike: number | null, eps = 1e-4): boolean {
  if (atmStrike == null) return false;
  return Math.abs(strike - atmStrike) <= eps;
}