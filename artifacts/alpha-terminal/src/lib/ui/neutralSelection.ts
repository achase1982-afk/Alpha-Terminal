import type { CSSProperties } from "react";

/**
 * Neutral selected-state chrome (no gold border / gold wash).
 * Search the codebase for legacy patterns: `fbbf24`, `FFB800`, `251,191,36`,
 * `border-primary`, `ring-primary`, `focus-visible:ring-primary`, `accent-[#FFB800]`.
 */

export const NEUTRAL_SEGMENT_BORDER = "#3f3f46";
export const NEUTRAL_SEGMENT_BORDER_SELECTED = "#71717a";
export const NEUTRAL_SEGMENT_BG_SELECTED = "rgba(255, 255, 255, 0.08)";
export const NEUTRAL_SEGMENT_TEXT = "#ffffff";
export const NEUTRAL_SEGMENT_TEXT_MUTED = "#a1a1aa";
export const NEUTRAL_TOGGLE_ON = "#52525b";
export const NEUTRAL_TOGGLE_OFF = "#2A2A2C";

/** Pill / segment control (e.g. Header Behavior: Auto | Compact | Full). */
export function neutralSegmentStyle(selected: boolean): CSSProperties {
  return {
    borderColor: selected ? NEUTRAL_SEGMENT_BORDER_SELECTED : NEUTRAL_SEGMENT_BORDER,
    background: selected ? NEUTRAL_SEGMENT_BG_SELECTED : "transparent",
  };
}

export function neutralSegmentLabelStyle(selected: boolean): CSSProperties {
  return {
    color: selected ? NEUTRAL_SEGMENT_TEXT : NEUTRAL_SEGMENT_TEXT,
    fontWeight: selected ? 700 : 600,
  };
}

/** Small speed / enum chips (e.g. bias scroll off | slow | normal | fast). */
export function neutralChipStyle(selected: boolean): CSSProperties {
  return {
    background: selected ? NEUTRAL_SEGMENT_BG_SELECTED : "transparent",
    color: selected ? NEUTRAL_SEGMENT_TEXT : NEUTRAL_SEGMENT_TEXT_MUTED,
    border: selected ? `1px solid ${NEUTRAL_SEGMENT_BORDER_SELECTED}` : `1px solid ${NEUTRAL_SEGMENT_BORDER}`,
  };
}

export function neutralTabUnderlineStyle(selected: boolean): CSSProperties {
  return {
    color: selected ? NEUTRAL_SEGMENT_TEXT : NEUTRAL_SEGMENT_TEXT_MUTED,
    borderColor: selected ? NEUTRAL_SEGMENT_BORDER_SELECTED : "transparent",
  };
}