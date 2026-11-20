import { describe, expect, it } from "vitest";
import { standaloneShellHeight } from "../useViewportShell";

describe("standaloneShellHeight", () => {
  it("keeps the shell on the painted page when the status bar sits above it", () => {
    // iPhone 16 Pro Max: screen 956, webview 894, opaque status bar outside the page.
    expect(
      standaloneShellHeight({
        screenHeight: 956,
        paintedHeight: 894,
        offsetTop: 0,
        topInset: 0,
        lastGoodHeight: 0,
      }),
    ).toBe(894);
  });

  it("does not lay the menu out into the unpainted band under the page", () => {
    // Same shortfall, but the top inset is real: the missing pixels are below the footer.
    expect(
      standaloneShellHeight({
        screenHeight: 956,
        paintedHeight: 894,
        offsetTop: 0,
        topInset: 62,
        lastGoodHeight: 956,
      }),
    ).toBe(894);
  });

  it("uses the full screen when the painted viewport already covers it", () => {
    expect(
      standaloneShellHeight({
        screenHeight: 956,
        paintedHeight: 956,
        offsetTop: 0,
        topInset: 62,
        lastGoodHeight: 0,
      }),
    ).toBe(956);
  });

  it("keeps the last full height when an app switch freezes the viewport short", () => {
    expect(
      standaloneShellHeight({
        screenHeight: 956,
        paintedHeight: 700,
        offsetTop: 0,
        topInset: 0,
        lastGoodHeight: 894,
      }),
    ).toBe(894);
  });
});
