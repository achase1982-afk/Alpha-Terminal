import { useEffect } from "react";
import { terminalLayoutMedia } from "@/lib/layout/breakpoints";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export type TerminalShellMode = "mobile" | "desktop" | "desktop-three-panel";

/**
 * Single source of truth for terminal chrome layout.
 * - Below mobile shell max: force mobile UI (no overlapping desktop header).
 * - Three-panel markets only when there is room for fixed rails.
 */
export function useTerminalLayout() {
  const isMobileShell = useMediaQuery(terminalLayoutMedia.mobileShell);
  const isThreePanel = useMediaQuery(terminalLayoutMedia.threePanel);
  const isCompactHeader = useMediaQuery(terminalLayoutMedia.compactHeader);

  const isWide = !isMobileShell;
  const shellMode: TerminalShellMode = isMobileShell
    ? "mobile"
    : isThreePanel
      ? "desktop-three-panel"
      : "desktop";

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.terminalShell = shellMode;
    root.dataset.terminalMobileShell = isMobileShell ? "true" : "false";
    return () => {
      delete root.dataset.terminalShell;
      delete root.dataset.terminalMobileShell;
    };
  }, [shellMode, isMobileShell]);

  return {
    isMobileShell,
    isWide,
    isThreePanel,
    isCompactHeader,
    shellMode,
  };
}