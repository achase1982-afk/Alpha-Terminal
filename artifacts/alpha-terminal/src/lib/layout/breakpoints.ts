/**
 * Canonical viewport breakpoints for the terminal shell.
 * Use these constants (and the media-query helpers) so mobile vs desktop
 * never diverges across components.
 */

/** Viewports at or below this width use the mobile shell (bottom nav, no desktop header chrome). */
export const TERMINAL_MOBILE_SHELL_MAX_PX = 899;

/** Minimum width for markets three-panel layout (watchlist + chart + context). */
export const TERMINAL_THREE_PANEL_MIN_PX = 1120;

/** Tailwind `md` alignment — fixed rails and md:* utilities still key off 768px. */
export const TERMINAL_TABLET_MIN_PX = 768;

/** Legacy desktop hook threshold (non–three-panel wide layouts). */
export const TERMINAL_DESKTOP_MIN_PX = 1024;

/** Desktop header switches to compact clock / tighter nav below this width. */
export const TERMINAL_COMPACT_HEADER_MAX_PX = 1180;

export const terminalLayoutMedia = {
  mobileShell: `(max-width: ${TERMINAL_MOBILE_SHELL_MAX_PX}px)`,
  notMobileShell: `(min-width: ${TERMINAL_MOBILE_SHELL_MAX_PX + 1}px)`,
  threePanel: `(min-width: ${TERMINAL_THREE_PANEL_MIN_PX}px)`,
  compactHeader: `(max-width: ${TERMINAL_COMPACT_HEADER_MAX_PX}px)`,
  tablet: `(min-width: ${TERMINAL_TABLET_MIN_PX}px)`,
  desktop: `(min-width: ${TERMINAL_DESKTOP_MIN_PX}px)`,
} as const;

export function matchesTerminalMobileShell(widthPx: number): boolean {
  return widthPx <= TERMINAL_MOBILE_SHELL_MAX_PX;
}

export function matchesTerminalThreePanel(widthPx: number): boolean {
  return widthPx >= TERMINAL_THREE_PANEL_MIN_PX;
}