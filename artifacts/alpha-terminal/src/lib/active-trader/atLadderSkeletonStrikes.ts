/** Placeholder ladder strikes centered on live spot (not hard-coded fixture ATM). */
export function atLadderSkeletonStrikes(underlyingPrice: number | null, step = 5, count = 11): number[] {
  const half = Math.floor(count / 2);
  const center =
    underlyingPrice != null && Number.isFinite(underlyingPrice)
      ? Math.round(underlyingPrice / step) * step
      : 7340;
  const out: number[] = [];
  for (let i = half; i >= -half; i--) {
    out.push(center + i * step);
  }
  return out;
}