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
/**
 * Ladder rows are a fixed height, so everything the scroll handler needs is
 * arithmetic on `scrollTop`. The functions above walk every row and read its
 * box, which is fine for a one-off recenter but not on every scroll event.
 */
export type AtLadderViewport = {
  scrollTop: number;
  /** Height of the scrollport that is not covered by the order sheet. */
  viewportPx: number;
  rowHeight: number;
  rowCount: number;
};

/** First and last row index that intersect the viewport, or null when there are no rows. */
export function atLadderVisibleRowRange(v: AtLadderViewport): { first: number; last: number } | null {
  if (v.rowCount <= 0 || v.rowHeight <= 0) return null;
  const clamp = (i: number) => Math.min(v.rowCount - 1, Math.max(0, i));
  const first = clamp(Math.floor(v.scrollTop / v.rowHeight));
  const last = clamp(Math.floor((v.scrollTop + Math.max(1, v.viewportPx) - 1) / v.rowHeight));
  return { first, last: Math.max(first, last) };
}

/** `scrollTop` that puts row `index` centered on the band at `bandFraction` of the viewport. */
export function atLadderScrollTopForRow(
  index: number,
  v: Pick<AtLadderViewport, "viewportPx" | "rowHeight" | "rowCount">,
  bandFraction = 0.42,
): number {
  const rowCenter = index * v.rowHeight + v.rowHeight / 2;
  const max = Math.max(0, v.rowCount * v.rowHeight - v.viewportPx);
  return Math.min(max, Math.max(0, Math.round(rowCenter - v.viewportPx * bandFraction)));
}

/** Distance in px from the row's center to the band center; the recenter pill keys off this. */
export function atLadderRowOffsetFromBand(index: number, v: AtLadderViewport, bandFraction = 0.42): number {
  const rowCenter = index * v.rowHeight + v.rowHeight / 2 - v.scrollTop;
  return rowCenter - v.viewportPx * bandFraction;
}

/** True when row `index` is fully inside the viewport. */
export function atLadderRowFullyVisible(index: number, v: AtLadderViewport, slackPx = 1): boolean {
  const top = index * v.rowHeight - v.scrollTop;
  return top >= -slackPx && top + v.rowHeight <= v.viewportPx + slackPx;
}

/**
 * Extra scroll needed so row `index` clears the bottom edge of the viewport
 * (the top edge of the order sheet). 0 when it already does.
 */
export function atLadderNudgeToClearSheet(index: number, v: AtLadderViewport, marginPx = 6): number {
  const bottom = (index + 1) * v.rowHeight - v.scrollTop;
  const limit = v.viewportPx - marginPx;
  return bottom > limit ? Math.ceil(bottom - limit) : 0;
}

/**
 * When the strike list changes (a page was added above, or the window moved),
 * how far `scrollTop` must shift so the strikes on screen stay where they are.
 */
export function atLadderScrollShiftForRows(
  prevStrikes: readonly number[],
  nextStrikes: readonly number[],
  rowHeight: number,
): number {
  if (prevStrikes.length === 0 || nextStrikes.length === 0) return 0;
  const prevTop = prevStrikes[0]!;
  const nextTop = nextStrikes[0]!;
  if (prevTop === nextTop) return 0;
  const addedAbove = nextStrikes.indexOf(prevTop);
  if (addedAbove > 0) return addedAbove * rowHeight;
  const removedAbove = prevStrikes.indexOf(nextTop);
  if (removedAbove > 0) return -removedAbove * rowHeight;
  return 0;
}
