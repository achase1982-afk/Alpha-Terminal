/**
 * Shared center strike rail + quote cell typography for options chain and AT ladder.
 */
export const STRIKE_COL_W = 62;

/** Center strike rail — one step above quote cells for hierarchy. */
export const STRIKE_COL_FONT_SIZE = 16;
export const STRIKE_COL_FONT_WEIGHT = 500;

/** Bid / ask / primary quote numbers in wing cells. */
export const CHAIN_LADDER_CELL_FONT_SIZE = 15;
export const CHAIN_LADDER_CELL_FONT_WEIGHT = 450;

/** Horizontal inset so multi-digit strikes (e.g. /YM, /ES) sit comfortably in the rail. */
export const STRIKE_COL_PAD_X = 7;

/** Scale down only when the rail would feel cramped (futures / index extremes). */
export function strikeRailFontSize(strike: number): number {
  if (!Number.isFinite(strike)) return STRIKE_COL_FONT_SIZE;
  const abs = Math.abs(strike);
  if (abs >= 100_000) return STRIKE_COL_FONT_SIZE - 3;
  if (abs >= 10_000) return STRIKE_COL_FONT_SIZE - 2;
  return STRIKE_COL_FONT_SIZE;
}