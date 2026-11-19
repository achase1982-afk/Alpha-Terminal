/**
 * Active Trader ladder geometry + type — sized to the AT mockup.
 * Spot / wall / selection chrome colors stay in `optionsTheme` (production tokens).
 */

/** 5-column pro ladder: call bid | call ask | strike | put bid | put ask (in-pair volume heat) */
export const AT_LADDER_GRID =
  "minmax(40px,1fr) minmax(40px,1fr) 84px minmax(40px,1fr) minmax(40px,1fr)";

/** Center strike column — mockup ~86 CSS px on a 440-wide phone frame. */
export const AT_LADDER_STRIKE_COL_W = 84;

/** Row pitch in the mockup (~114px @3x). */
export const AT_LADDER_ROW_H = 38;

export const AT_LADDER_GROUP_HDR_H = 20;
export const AT_LADDER_COL_HDR_H = 20;
export const AT_LADDER_PANEL_BG = "#060709";
/** Center strike column — mockup off-gray (not flat black). Sampled ~#242628. */
export const AT_LADDER_STRIKE_BG = "#242628";
export const AT_LADDER_THIN_SEP = "#171a20";
export const AT_SPOT_PILL_TEXT = "#0a0a0a";

/** Bid/ask premiums — mockup regular weight, slightly under the strike. */
export const AT_LADDER_PRICE_SIZE = 14;
export const AT_LADDER_PRICE_WEIGHT = 400;

/** Center strike — mockup medium-bold, one step above premiums. */
export const AT_LADDER_STRIKE_SIZE = 15;
export const AT_LADDER_STRIKE_WEIGHT = 600;

/** BUY / SELL under a selected premium. */
export const AT_LADDER_LEG_TAG_SIZE = 8;

/** Inset of the selected-cell outline from the grid lines (mockup thin rounded chip). */
export const AT_LADDER_SELECT_INSET = 3;
export const AT_LADDER_SELECT_RADIUS = 4;
