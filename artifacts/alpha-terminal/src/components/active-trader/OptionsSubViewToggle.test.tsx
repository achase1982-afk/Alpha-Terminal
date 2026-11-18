/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OptionsSubViewToggle } from "./OptionsSubViewToggle";

describe("OptionsSubViewToggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders compact visual (~102×26) with invisible ≥44px hit target", () => {
    const { container } = render(<OptionsSubViewToggle view="chain" onChange={vi.fn()} />);
    const hit = screen.getByRole("switch", { name: "Options view" });
    expect(hit.hasAttribute("data-at-subview-hit")).toBe(true);
    expect((hit as HTMLButtonElement).style.minHeight).toBe("44px");
    expect((hit as HTMLButtonElement).style.minWidth).toBe("44px");
    const visual = container.querySelector("[data-at-subview-toggle]") as HTMLElement;
    expect(visual?.getAttribute("data-at-subview-visual-w")).toBe("102");
    expect(visual?.getAttribute("data-at-subview-visual-h")).toBe("26");
    expect(container.querySelector('[data-at-subview-segment="chain"]')?.textContent).toBe("Chain");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("flips view when tapping hit layer", () => {
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