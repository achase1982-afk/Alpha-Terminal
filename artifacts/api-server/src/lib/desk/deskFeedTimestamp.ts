/** UW and similar APIs sometimes return date-only strings → UTC midnight ms; never use for feed freshness. */
export function deskCoercePollReceiptTs(candidate: number | undefined, pollMs = Date.now()): number {
  if (candidate == null || !Number.isFinite(candidate)) return pollMs;
  const d = new Date(candidate);
  const midnightUtc =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0 &&
    candidate % 86_400_000 === 0;
  if (midnightUtc) return pollMs;
  if (candidate > pollMs + 3_600_000) return pollMs;
  return candidate;
}