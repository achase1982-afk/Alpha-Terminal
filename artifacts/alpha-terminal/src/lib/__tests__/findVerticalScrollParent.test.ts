/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { findVerticalScrollParent } from "../findVerticalScrollParent";

describe("findVerticalScrollParent", () => {
  it("returns the scrollable ancestor, not overflow-hidden shell", () => {
    const shell = document.createElement("main");
    shell.className = "app-content";
    Object.defineProperty(shell, "scrollHeight", { value: 800, configurable: true });
    Object.defineProperty(shell, "clientHeight", { value: 800, configurable: true });
    shell.style.overflowY = "hidden";

    const inner = document.createElement("section");
    inner.className = "tab-inner-scroll";
    Object.defineProperty(inner, "scrollHeight", { value: 2400, configurable: true });
    Object.defineProperty(inner, "clientHeight", { value: 700, configurable: true });
    inner.style.overflowY = "auto";

    const leaf = document.createElement("div");
    inner.appendChild(leaf);
    shell.appendChild(inner);
    document.body.appendChild(shell);

    expect(findVerticalScrollParent(leaf)).toBe(inner);

    document.body.removeChild(shell);
  });
});