/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileEdgeSearch } from "./MobileEdgeSearch";
import {
  installPwaKeyboardSession,
  isUserKeyboardSession,
  noteKeyboardGesture,
  resetPwaKeyboardSessionForTests,
} from "@/hooks/pwaKeyboardSession";
import { nudgeStuckLayoutViewport } from "@/hooks/useViewportShell";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

afterEach(() => {
  cleanup();
  resetPwaKeyboardSessionForTests();
  vi.useRealTimers();
  setHidden(false);
});

describe("MobileEdgeSearch app switch", () => {
  it("drops the ticker field when the installed app is backgrounded", () => {
    render(<MobileEdgeSearch />);
    const button = screen.getByRole("button", { name: "Search ticker" });
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 20, clientY: 40 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 20, clientY: 40 });

    expect(screen.getByLabelText("Ticker symbol")).toBeTruthy();

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.queryByLabelText("Ticker symbol")).toBeNull();
    expect(isUserKeyboardSession()).toBe(false);
  });

  it("blurs a field iOS restores on resume, and keeps a field the member taps", () => {
    vi.useFakeTimers();
    installPwaKeyboardSession();
    const restored = document.createElement("input");
    const tapped = document.createElement("input");
    document.body.append(restored, tapped);

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      restored.focus();
    });

    expect(document.activeElement).not.toBe(restored);
    expect(isUserKeyboardSession()).toBe(false);

    act(() => {
      noteKeyboardGesture();
      tapped.focus();
    });

    expect(document.activeElement).toBe(tapped);
    expect(isUserKeyboardSession()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(document.activeElement).toBe(tapped);
    expect(isUserKeyboardSession()).toBe(true);
  });
});

describe("nudgeStuckLayoutViewport", () => {
  it("asks WebKit to recompute a phone viewport that is still keyboard-short", () => {
    const queries: string[] = [];
    window.matchMedia = ((query: string) => {
      queries.push(query);
      return {
        matches: query.includes("pointer: coarse") || query.includes("display-mode: standalone"),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      };
    }) as typeof window.matchMedia;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 550 });
    Object.defineProperty(window.screen, "height", { configurable: true, value: 956 });
    Object.defineProperty(window.screen, "width", { configurable: true, value: 440 });

    const meta = document.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content";
    document.head.appendChild(meta);

    expect(nudgeStuckLayoutViewport()).toBe(true);
    expect(meta.content).toContain("interactive-widget=resizes-content");

    window.matchMedia = ((query: string) => {
      queries.push(query);
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      };
    }) as typeof window.matchMedia;
    expect(nudgeStuckLayoutViewport()).toBe(false);
    meta.remove();
  });
});
