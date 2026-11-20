import {
  CHAIN_LADDER_CELL_FONT_SIZE,
  CHAIN_LADDER_CELL_FONT_WEIGHT,
  STRIKE_COL_FONT_WEIGHT,
  STRIKE_COL_W,
} from "@/lib/options/strikeColumnChrome";

/**
 * Active Trader ladder geometry + type — strike rail aligned with options chain.
 */

/** 5-column pro ladder: call bid | call ask | strike | put bid | put ask */
export const AT_LADDER_GRID =
  `minmax(40px,1fr) minmax(40px,1fr) ${STRIKE_COL_W}px minmax(40px,1fr) minmax(40px,1fr)`;

/** Center strike column — same width as `STRIKE_W` in the options chain. */
export const AT_LADDER_STRIKE_COL_W = STRIKE_COL_W;

/**
 * Equity ladder with the same centered strike/price rail width as options/SPX:
 * volume | bid size | price | ask size | (transparent balance rail).
 * The final rail carries no data; it mirrors the volume lane so PRICE remains
 * mathematically centered in every viewport.
 */
export const AT_STOCK_LADDER_GRID =
  `minmax(58px,1fr) minmax(52px,1fr) ${AT_LADDER_STRIKE_COL_W}px minmax(52px,1fr) minmax(58px,1fr)`;

/** Dull green behind bid size, dull red behind ask size (equity ladder size columns). */
export const AT_STOCK_BID_BG = "#173b2a";
export const AT_STOCK_ASK_BG = "#3f1f24";

/** Row pitch. 34px keeps the 16px prices and 18px strikes, with less air above and below. */
export const AT_LADDER_ROW_H = 34;

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
export const AT_LADDER_PRICE_SIZE = CHAIN_LADDER_CELL_FONT_SIZE;
export const AT_LADDER_PRICE_WEIGHT = CHAIN_LADDER_CELL_FONT_WEIGHT;

/** Center strike — use `strikeRailFontSize(strike)` at render time. */
export const AT_LADDER_STRIKE_SIZE = 16;
export const AT_LADDER_STRIKE_WEIGHT = STRIKE_COL_FONT_WEIGHT;

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
export const AT_LADDER_CALLS_HDR = "#5df1a0";
export const AT_LADDER_PUTS_HDR = "#ff7164";

/**
 * Volume heat. No socket volume stays transparent (the cell stays black).
 * Live volume lifts a call from black to bright green, a put from black to bright red.
 */
export const AT_HEAT_CALL_RGB = "4, 8, 6";
export const AT_HEAT_PUT_RGB = "12, 5, 5";
export const AT_HEAT_WASH_ALPHA = 0;
export const AT_HEAT_MAX_ALPHA = 0.94;
