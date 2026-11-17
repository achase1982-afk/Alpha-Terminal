import type { CSSProperties } from "react";

/** Shared options chain / Active Trader palette (values unchanged from OptionsTab). */

export const COL_W = 74;
export const STRIKE_W = 44;
export const ROW_H = 40;
export const TOOLBAR_H = 32;
export const HEADER_H = 32;
export const SUB_HEADER_H = 20;

export const BG = "#000000";
export const BG_HEADER = "#060606";
export const BG_EXP_BAR = "#070707";
export const BORDER = "#1a1a1a";
export const BORDER_ROW = "#0c0c0c";
export const GOLD = "#fbbf24";
export const GOLD_DIM = "#b8941c";
export const UP = "#00d166";
export const DOWN = "#f23645";
export const WHITE = "#f0f0f0";
export const GRAY = "#a1a1aa";
export const DIM = "#52525b";
export const MUTED = "#3f3f46";

export const ITM_OCEAN = "rgba(180,140,50,0.22)";
export const OTM_PURPLE = "rgba(168,130,255,0.04)";
export const SEL_BORDER_COLOR = "#fbbf2480";

export const GAMMA_SCENARIO = "#a78bfa";

export const MONO =
  "'SFMono-Regular', 'SF Mono', ui-monospace, 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace";
export const FW_LIGHT = 400;
export const FW_NORMAL = 450;
export const FW_PREMIUM = 600;

export const noScrollbar: CSSProperties = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
  scrollSnapType: "none",
  overscrollBehavior: "contain",
};