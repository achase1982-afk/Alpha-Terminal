import { describe, expect, it } from "vitest";
import {
  TERMINAL_MOBILE_SHELL_MAX_PX,
  TERMINAL_THREE_PANEL_MIN_PX,
  matchesTerminalMobileShell,
  matchesTerminalThreePanel,
  terminalLayoutMedia,
} from "../breakpoints";

describe("terminal layout breakpoints", () => {
  it("forces mobile shell at and below the mobile max width", () => {
    expect(matchesTerminalMobileShell(320)).toBe(true);
    expect(matchesTerminalMobileShell(768)).toBe(true);
    expect(matchesTerminalMobileShell(TERMINAL_MOBILE_SHELL_MAX_PX)).toBe(true);
    expect(matchesTerminalMobileShell(TERMINAL_MOBILE_SHELL_MAX_PX + 1)).toBe(false);
  });

  it("enables three-panel only at sufficient width", () => {
    expect(matchesTerminalThreePanel(TERMINAL_THREE_PANEL_MIN_PX - 1)).toBe(false);
    expect(matchesTerminalThreePanel(TERMINAL_THREE_PANEL_MIN_PX)).toBe(true);
    expect(matchesTerminalThreePanel(1920)).toBe(true);
  });

  it("exposes stable media query strings", () => {
    expect(terminalLayoutMedia.mobileShell).toContain(String(TERMINAL_MOBILE_SHELL_MAX_PX));
    expect(terminalLayoutMedia.threePanel).toContain(String(TERMINAL_THREE_PANEL_MIN_PX));
  });
});