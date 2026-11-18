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

/** True when the spot/ATM row is outside the centered band (show recenter affordance). */
export function atLadderSpotOffCenter(
  container: HTMLElement | null,
  underlyingPrice: number | null,
  tolerancePx = 56,
): boolean {
  if (!container || underlyingPrice == null || !Number.isFinite(underlyingPrice)) return false;
  const strikes = [...container.querySelectorAll<HTMLElement>("[data-at-strike]")];
  if (!strikes.length) return false;

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
  if (!best) return false;

  const cRect = container.getBoundingClientRect();
  const tRect = best.getBoundingClientRect();
  const rowCenter = tRect.top + tRect.height / 2 - cRect.top;
  const bandCenter = container.clientHeight * 0.42;
  return Math.abs(rowCenter - bandCenter) > tolerancePx;
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

/**
 * Position selected strike in the ladder band between top chrome and a bottom peek sheet,
 * keeping ~2 strike rows visible on each side when possible.
 */
export function scrollAtLadderToStrikeAboveSheet(
  container: HTMLElement | null,
  strike: number | null,
  sheetHeightPx: number,
): void {
  if (!container || strike == null || !Number.isFinite(strike)) return;
  const glance = document.querySelector<HTMLElement>("[data-at-glance-top]");
  const header = document.querySelector<HTMLElement>("[data-at-symbol-header]");
  const chromeBottom = Math.max(
    glance?.getBoundingClientRect().bottom ?? 0,
    header?.getBoundingClientRect().bottom ?? 0,
  );
  const ladderTop = container.getBoundingClientRect().top;
  const visiblePx = Math.max(120, window.innerHeight - sheetHeightPx - chromeBottom - (ladderTop - chromeBottom));
  const bandFraction = Math.min(0.38, Math.max(0.14, visiblePx / Math.max(container.clientHeight, 1) * 0.42));
  scrollAtLadderToStrike(container, strike, bandFraction);
}