/** Default peek (~38% viewport) keeps ATM ladder rows tappable above the order sheet. */
export const AT_SHEET_PEEK_VH =
  "min(38vh, calc(100dvh - 168px - env(safe-area-inset-bottom, 0px)))";

export const AT_SHEET_FULL_VH =
  "min(58vh, calc(100dvh - 168px - env(safe-area-inset-bottom, 0px)))";

export function atSheetPeekHeightPx(): number {
  if (typeof window === "undefined") return 380;
  return Math.round(window.innerHeight * 0.38) + 88;
}

/** Scroll padding when the docked build ticket is visible (above bottom nav). */
export function atDockedTicketScrollPadPx(legCount: number): number {
  if (legCount <= 0) return 0;
  return legCount > 2 ? 188 : 156;
}