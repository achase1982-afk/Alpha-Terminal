/** Scroll the ladder body so the spot line (or nearest strike) is vertically centered. */
export function scrollAtLadderToSpot(container: HTMLElement | null, underlyingPrice: number | null): void {
  if (!container || underlyingPrice == null || !Number.isFinite(underlyingPrice)) return;
  const strikes = [...container.querySelectorAll<HTMLElement>("[data-at-strike]")];
  if (!strikes.length) return;

  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const el of strikes) {
    const raw = el.getAttribute("data-at-strike");
    const strike = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(strike)) continue;
    const d = Math.abs(strike - underlyingPrice);
    if (d < bestDist) {
      bestDist = d;
      best = el;
    }
  }
  if (!best) return;

  const cRect = container.getBoundingClientRect();
  const tRect = best.getBoundingClientRect();
  const spotGap = container.querySelector<HTMLElement>("[data-at-spot-gap]");
  const targetTop =
    spotGap != null
      ? spotGap.getBoundingClientRect().top - cRect.top + container.scrollTop
      : tRect.top - cRect.top + container.scrollTop;
  const centerOffset = container.clientHeight * 0.42;
  container.scrollTop = Math.max(0, targetTop - centerOffset);
}

/** Keep a selected strike row in the visible band above chrome / trade bar. */
export function scrollAtLadderToStrike(
  container: HTMLElement | null,
  strike: number | null,
  bandFraction = 0.35,
): void {
  if (!container || strike == null || !Number.isFinite(strike)) return;
  const row = container.querySelector<HTMLElement>(`[data-at-strike="${strike}"]`);
  if (!row) return;
  const cRect = container.getBoundingClientRect();
  const tRect = row.getBoundingClientRect();
  const rowTop = tRect.top - cRect.top + container.scrollTop;
  const target = rowTop - container.clientHeight * bandFraction;
  container.scrollTop = Math.max(0, target);
}