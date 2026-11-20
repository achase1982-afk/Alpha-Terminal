function nearestStrikeRow(
  container: HTMLElement,
  underlyingPrice: number,
  strikeAttr: string,
): HTMLElement | null {
  const strikes = [...container.querySelectorAll<HTMLElement>(`[${strikeAttr}]`)];
  if (!strikes.length) return null;
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const el of strikes) {
    const raw = el.getAttribute(strikeAttr);
    const strike = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(strike)) continue;
    const d = Math.abs(strike - underlyingPrice);
    if (d < bestDist) {
      bestDist = d;
      best = el;
    }
  }
  return best;
}

/**
 * Scroll so `rowEl` is vertically centered in the scrollport above `bottomInsetPx`
 * (e.g. order sheet). Uses instant scroll by default — accurate recenter, not smooth drift.
 */
export function scrollRowToViewportCenter(
  container: HTMLElement | null,
  rowEl: HTMLElement | null,
  opts?: { bottomInsetPx?: number; behavior?: ScrollBehavior },
): void {
  if (!container || !rowEl) return;
  const bottomInsetPx = opts?.bottomInsetPx ?? 0;
  const behavior = opts?.behavior ?? "auto";
  const viewportH = container.clientHeight;
  const effectiveH = Math.max(1, viewportH - bottomInsetPx);
  const cRect = container.getBoundingClientRect();
  const tRect = rowEl.getBoundingClientRect();
  const rowCenterInViewport = tRect.top + tRect.height / 2 - cRect.top;
  const targetCenter = effectiveH / 2;
  const delta = rowCenterInViewport - targetCenter;
  const maxScroll = Math.max(0, container.scrollHeight - viewportH);
  const next = Math.min(maxScroll, Math.max(0, container.scrollTop + delta));
  if (behavior === "smooth") container.scrollTo({ top: next, behavior: "smooth" });
  else container.scrollTop = next;
}

/** True when `rowEl` is not centered in the visible band above `bottomInsetPx`. */
export function rowOffViewportCenter(
  container: HTMLElement | null,
  rowEl: HTMLElement | null,
  tolerancePx = 56,
  bottomInsetPx = 0,
): boolean {
  if (!container || !rowEl) return false;
  const effectiveH = Math.max(1, container.clientHeight - bottomInsetPx);
  const cRect = container.getBoundingClientRect();
  const tRect = rowEl.getBoundingClientRect();
  const rowCenterInViewport = tRect.top + tRect.height / 2 - cRect.top;
  return Math.abs(rowCenterInViewport - effectiveH / 2) > tolerancePx;
}

/** Scroll a strike-keyed viewport so the row nearest underlying is centered on spot. */
export function scrollViewportToNearestStrike(
  container: HTMLElement | null,
  underlyingPrice: number | null,
  strikeAttr: string,
  bottomInsetPx = 0,
  behavior: ScrollBehavior = "auto",
): void {
  if (!container || underlyingPrice == null || !Number.isFinite(underlyingPrice)) return;
  const best = nearestStrikeRow(container, underlyingPrice, strikeAttr);
  if (!best) return;
  scrollRowToViewportCenter(container, best, { bottomInsetPx, behavior });
}

/** True when the nearest strike row is outside the centered band (show recenter affordance). */
export function viewportNearestStrikeOffCenter(
  container: HTMLElement | null,
  underlyingPrice: number | null,
  strikeAttr: string,
  tolerancePx = 56,
  bottomInsetPx = 0,
): boolean {
  if (!container || underlyingPrice == null || !Number.isFinite(underlyingPrice)) return false;
  const best = nearestStrikeRow(container, underlyingPrice, strikeAttr);
  if (!best) return false;
  return rowOffViewportCenter(container, best, tolerancePx, bottomInsetPx);
}

/** ATM / spot row in the options chain (gold strike rail when present). */
export function resolveChainAtmRow(
  container: HTMLElement | null,
  underlyingPrice: number | null,
): HTMLElement | null {
  if (!container) return null;
  const spotEl = container.querySelector<HTMLElement>('[data-chain-spot-strike="1"]');
  if (spotEl) {
    return (
      spotEl.closest<HTMLElement>("[data-chain-strike-rail]") ??
      spotEl.closest<HTMLElement>("[data-chain-strike]")
    );
  }
  if (underlyingPrice == null || !Number.isFinite(underlyingPrice)) return null;
  return nearestStrikeRow(container, underlyingPrice, "data-chain-strike");
}

/** Scroll the options chain so the ATM / spot strike row is vertically centered. */
export function scrollChainViewportToAtm(
  container: HTMLElement | null,
  underlyingPrice: number | null,
  bottomInsetPx = 0,
  behavior: ScrollBehavior = "auto",
): void {
  const row = resolveChainAtmRow(container, underlyingPrice);
  scrollRowToViewportCenter(container, row, { bottomInsetPx, behavior });
}

/** True when the chain ATM row is outside the centered band (show Recenter). */
export function chainAtmRowOffCenter(
  container: HTMLElement | null,
  underlyingPrice: number | null,
  tolerancePx = 56,
  bottomInsetPx = 0,
): boolean {
  const row = resolveChainAtmRow(container, underlyingPrice);
  if (!row) return false;
  return rowOffViewportCenter(container, row, tolerancePx, bottomInsetPx);
}

/** Scroll the ladder body so the spot line (or nearest strike) is vertically centered. */
export function scrollAtLadderToSpot(
  container: HTMLElement | null,
  underlyingPrice: number | null,
  bottomInsetPx = 0,
): void {
  scrollViewportToNearestStrike(container, underlyingPrice, "data-at-strike", bottomInsetPx, "auto");
}

/** True when the spot/ATM row is outside the centered band (show recenter affordance). */
export function atLadderSpotOffCenter(
  container: HTMLElement | null,
  underlyingPrice: number | null,
  tolerancePx = 56,
  bottomInsetPx = 0,
): boolean {
  return viewportNearestStrikeOffCenter(container, underlyingPrice, "data-at-strike", tolerancePx, bottomInsetPx);
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

/**
 * `scrollTop` that puts row `index` on the band at `bandFraction` of the
 * viewport, snapped to a whole row so the first row sits flush under the
 * column header instead of being cut by it.
 */
export function atLadderScrollTopForRow(
  index: number,
  v: Pick<AtLadderViewport, "viewportPx" | "rowHeight" | "rowCount">,
  bandFraction = 0.42,
): number {
  const rowCenter = index * v.rowHeight + v.rowHeight / 2;
  const max = Math.max(0, v.rowCount * v.rowHeight - v.viewportPx);
  const snapped = Math.round((rowCenter - v.viewportPx * bandFraction) / v.rowHeight) * v.rowHeight;
  return Math.min(max, Math.max(0, snapped));
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
