/** Compact $ display for glance money row (M/B, no labels). */
export function fmtGlanceMoneyUsd(n: number): string {
  const sign = n < 0 ? "−" : "+";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  if (a === 0) return "$0";
  return `${sign}$${a.toFixed(0)}`;
}

/** Unsigned $ size for “sold …” labels. */
export function fmtGlanceFlowAmount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(1)}K`;
  if (a === 0) return "0";
  return a.toFixed(0);
}

export function fmtGlanceMoneyMagnitude(n: number): string {
  const a = Math.abs(n);
  const core =
    a >= 1e9
      ? `${(a / 1e9).toFixed(1)}B`
      : a >= 1e6
        ? `${(a / 1e6).toFixed(1)}M`
        : a >= 1e3
          ? `${(a / 1e3).toFixed(0)}K`
          : a.toFixed(0);
  if (n > 0) return `+${core}`;
  if (n < 0) return `−${core}`;
  return core;
}