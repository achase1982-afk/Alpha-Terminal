/**
 * Active Trader ladder geometry + type — 1:1 with the AT mockup (visual source of truth).
 * Sampled from the mockup PNG at 3x on a 440 CSS-wide frame.
 * Spot / wall accent hues that already exist in production stay in `optionsTheme`
 * unless the mockup clearly differs (spot yellow below).
 */

/** 5-column pro ladder: call bid | call ask | strike | put bid | put ask */
export const AT_LADDER_GRID =
  "minmax(40px,1fr) minmax(40px,1fr) 96px minmax(40px,1fr) minmax(40px,1fr)";

/** Center strike column in the 440px-wide approved reference. */
export const AT_LADDER_STRIKE_COL_W = 96;

/** Row pitch — mockup 114px @3x. */
export const AT_LADDER_ROW_H = 38;

export const AT_LADDER_GROUP_HDR_H = 28;
export const AT_LADDER_COL_HDR_H = 25;
export const AT_LADDER_GUTTER_X = 6;

/** Ladder panel behind the pairs. */
export const AT_LADDER_PANEL_BG = "#060709";

/** Center strike column off-gray, not flat black. */
export const AT_LADDER_STRIKE_BG = "#292b2d";

export const AT_LADDER_THIN_SEP = "#2d3236";

/** Spot pill — mockup sampled ~#fdcb35 (brighter than theme GOLD). */
export const AT_SPOT_PILL = "#fdcb35";
export const AT_SPOT_PILL_TEXT = "#0a0a0a";

/** Premium text — mockup cool off-white ~#d4d6d7. */
export const AT_LADDER_PRICE_COLOR = "#d4d6d7";
export const AT_LADDER_PRICE_SIZE = 16;
export const AT_LADDER_PRICE_WEIGHT = 400;

/** Center strike — mockup one step above premiums. */
export const AT_LADDER_STRIKE_SIZE = 18;
export const AT_LADDER_STRIKE_WEIGHT = 500;

/** BUY / SELL under a selected premium. */
export const AT_LADDER_LEG_TAG_SIZE = 8;

/** Selected-cell outline inset / radius from mockup. */
export const AT_LADDER_SELECT_INSET = 3;
export const AT_LADDER_SELECT_MAX_W = 56;
export const AT_LADDER_SELECT_RADIUS = 5;

/**
 * Selection outline + tag colors from mockup (BUY green / SELL coral),
 * not the brighter theme UP/DOWN used in flow chrome.
 */
export const AT_LADDER_SELECT_BUY = "#5df1a0";
export const AT_LADDER_SELECT_SELL = "#ff7164";
export const AT_LADDER_GAMMA = "#d7acfd";

/** CALLS / PUTS group header colors (mockup). */
export const AT_LADDER_CALLS_HDR = "#4ec685";
export const AT_LADDER_PUTS_HDR = "#ca5c52";

/**
 * Volume heat. A pair with no socket volume stays uncolored.
 * Call volume paints green; put volume paints red. Alpha scales with intensity.
 */
export const AT_HEAT_CALL_RGB = "40, 110, 70";
export const AT_HEAT_PUT_RGB = "140, 50, 48";
export const AT_HEAT_WASH_ALPHA = 0;
export const AT_HEAT_MAX_ALPHA = 0.78;
