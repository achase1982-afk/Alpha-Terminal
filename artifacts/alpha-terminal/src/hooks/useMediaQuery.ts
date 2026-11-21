import { useState, useEffect } from "react";
import { terminalLayoutMedia, TERMINAL_TABLET_MIN_PX, TERMINAL_DESKTOP_MIN_PX } from "@/lib/layout/breakpoints";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** @deprecated Prefer `useTerminalLayout().isWide` for shell chrome. */
export function useIsTablet(): boolean {
  return useMediaQuery(terminalLayoutMedia.notMobileShell);
}

/** @deprecated Prefer `useTerminalLayout().isThreePanel` for markets layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery(terminalLayoutMedia.threePanel);
}

/** Tailwind md alignment only — not the terminal mobile shell gate. */
export function useIsTailwindMd(): boolean {
  return useMediaQuery(`(min-width: ${TERMINAL_TABLET_MIN_PX}px)`);
}

/** Legacy 1024px desktop utilities. */
export function useIsLegacyDesktop(): boolean {
  return useMediaQuery(`(min-width: ${TERMINAL_DESKTOP_MIN_PX}px)`);
}