/**
 * Shared center strike rail + quote cell typography for options chain and AT ladder.
 */
export const STRIKE_COL_W = 62;

/** Center strike rail — one step above quote cells for hierarchy. */
export const STRIKE_COL_FONT_SIZE = 16;
export const STRIKE_COL_FONT_WEIGHT = 500;
/** Spot / ATM rail: one step up, slightly heavier (not full bold). */
export const STRIKE_COL_SPOT_FONT_EXTRA_PX = 1;
export const STRIKE_COL_SPOT_FONT_WEIGHT = 550;

/** Bid / ask / primary quote numbers in wing cells (matches AT ladder). */
export const CHAIN_LADDER_CELL_FONT_SIZE = 16;
export const CHAIN_LADDER_CELL_FONT_WEIGHT = 450;
/** Cool off-white premium text — same token as `AT_LADDER_PRICE_COLOR`. */
export const CHAIN_LADDER_CELL_COLOR = "#d4d6d7";

/** Center strike rail typography — shared chain + AT. */
export const STRIKE_RAIL_LETTER_SPACING = "0.01em";
export const STRIKE_RAIL_LINE_HEIGHT = 1.05;

/** OTM wing rows — dark blue-charcoal behind the chain quote cells. */
export const CHAIN_OTM_ROW_BG = "#10151a";

/** Horizontal inset so multi-digit strikes (e.g. /YM, /ES) sit comfortably in the rail. */
export const STRIKE_COL_PAD_X = 7;

function strikeRailBaseFontSize(strike: number): number {
  if (!Number.isFinite(strike)) return STRIKE_COL_FONT_SIZE;
  const abs = Math.abs(strike);
  if (abs >= 100_000) return STRIKE_COL_FONT_SIZE - 3;
  if (abs >= 10_000) return STRIKE_COL_FONT_SIZE - 2;
  return STRIKE_COL_FONT_SIZE;
}

/** Scale down only when the rail would feel cramped (futures / index extremes). */
export function strikeRailFontSize(strike: number, spotRow = false): number {
  const base = strikeRailBaseFontSize(strike);
  return spotRow ? base + STRIKE_COL_SPOT_FONT_EXTRA_PX : base;
}

export function strikeRailFontWeight(spotRow = false): number {
  return spotRow ? STRIKE_COL_SPOT_FONT_WEIGHT : STRIKE_COL_FONT_WEIGHT;
}