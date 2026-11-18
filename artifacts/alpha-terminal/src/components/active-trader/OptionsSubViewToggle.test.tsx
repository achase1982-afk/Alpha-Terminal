/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OptionsSubViewToggle } from "./OptionsSubViewToggle";

describe("OptionsSubViewToggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders segmented switch with ≥44px tap target and no visible select", () => {
    const { container } = render(<OptionsSubViewToggle view="chain" onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Options view" });
    const box = toggle as HTMLButtonElement;
    expect(box.style.minHeight).toBe("44px");
    expect(container.querySelector('[data-at-subview-segment="chain"]')?.textContent).toBe("Chain");
    expect(container.querySelector('[data-at-subview-segment="at"]')?.textContent).toBe("AT");
    expect(container.querySelector("svg")).toBeNull();
    const fallback = container.querySelector("[data-at-subview-select-fallback]") as HTMLSelectElement;
    expect(fallback.className).toContain("sr-only");
  });

  it("flips view when tapping anywhere on the control", () => {
    const onChange = vi.fn();
    render(<OptionsSubViewToggle view="chain" onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Options view" }));
    expect(onChange).toHaveBeenCalledWith("at");
  });

  it("exposes subview value for automation", () => {
    const { container } = render(<OptionsSubViewToggle view="chain" onChange={vi.fn()} />);
    expect(container.querySelector("[data-at-subview-value]")?.getAttribute("data-at-subview-value")).toBe("chain");
  });
});