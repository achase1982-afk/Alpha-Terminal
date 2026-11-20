import { describe, expect, it } from "vitest";
import { shouldTrackKeyboardViewport } from "../pwaKeyboardSession";
import { resolveBottomInputDock } from "../useVisualViewportKeyboardInset";
import { layoutViewportStuck, standaloneShellHeight } from "../useViewportShell";

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

describe("shouldTrackKeyboardViewport", () => {
  it("follows the keyboard during a typing session", () => {
    expect(
      shouldTrackKeyboardViewport({
        userSession: true,
        editableFocused: true,
        now: 5_000,
        followUntil: 0,
        followAllowed: true,
      }),
    ).toBe(true);
  });

  it("keeps following a typing session that started after the app came back", () => {
    expect(
      shouldTrackKeyboardViewport({
        userSession: true,
        editableFocused: true,
        now: 500,
        followUntil: 0,
        followAllowed: false,
      }),
    ).toBe(true);
  });

  it("does not pin the shell to a focused field left over from the previous visit", () => {
    expect(
      shouldTrackKeyboardViewport({
        userSession: false,
        editableFocused: true,
        now: 200,
        followUntil: 5_000,
        followAllowed: false,
      }),
    ).toBe(false);
  });

  it("follows the close animation only after the resume guard has ended", () => {
    expect(
      shouldTrackKeyboardViewport({
        userSession: false,
        editableFocused: false,
        now: 1_000,
        followUntil: 1_200,
        followAllowed: true,
      }),
    ).toBe(true);
    expect(
      shouldTrackKeyboardViewport({
        userSession: false,
        editableFocused: false,
        now: 1_000,
        followUntil: 1_200,
        followAllowed: false,
      }),
    ).toBe(false);
  });
});

describe("layoutViewportStuck", () => {
  it("treats a keyboard-sized gap as stuck when nobody is typing", () => {
    expect(layoutViewportStuck(956, 550, false)).toBe(true);
  });

  it("ignores the status-bar gap and an open keyboard", () => {
    expect(layoutViewportStuck(956, 894, false)).toBe(false);
    expect(layoutViewportStuck(956, 550, true)).toBe(false);
  });
});

describe("resolveBottomInputDock", () => {
  it("leaves the field on the bottom when a stale keyboard gap is not a typing session", () => {
    expect(
      resolveBottomInputDock({
        userSession: false,
        inputFocused: true,
        overlapPx: 320,
        idleBottomPx: 0,
        dockHeightPx: 72,
      }),
    ).toEqual({ dockBottomPx: 0, scrollPaddingBottomPx: 80 });
  });

  it("sits on the keyboard while the member is typing", () => {
    expect(
      resolveBottomInputDock({
        userSession: true,
        inputFocused: true,
        overlapPx: 320,
        idleBottomPx: 0,
        dockHeightPx: 72,
      }),
    ).toEqual({ dockBottomPx: 320, scrollPaddingBottomPx: 404 });
  });
});
