/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import IpadCockpitPage from "./IpadCockpitPage";

afterEach(() => {
  cleanup();
});

describe("iPad cockpit interactions", () => {
  it("stages the bear credit, switches to bull control, and files a local working order", () => {
    render(<IpadCockpitPage />);
    expect(screen.getByTestId("verdict-hero").textContent).toBe("BEARS IN CONTROL");
    expect(screen.getByText("7,268.68")).toBeTruthy();
    expect(screen.getByRole("button", { name: /SEND CALL CREDIT · 1x @ \$2\.10 CR/ })).toBeTruthy();
    expect(screen.getByTestId("ladder-7300-C-SELL").textContent).toContain("S1");
    expect(screen.getByTestId("ladder-7305-C-BUY").textContent).toContain("B1");

    fireEvent.click(screen.getByTestId("ladder-7300-C-SELL"));
    expect(screen.queryByText("S1")).toBeNull();
    expect(screen.getByRole("button", { name: /SEND SINGLE/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "DEMO: BEAR CTRL" }));
    expect(screen.getByTestId("verdict-hero").textContent).toBe("BULLS IN CONTROL");
    expect(screen.getByText("7,322.40")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /SEND PUT CREDIT · 1x @ \$1\.90 CR/ }));
    expect(screen.getByTestId("ipad-toast").textContent).toMatch(/Order Sent/);
    expect(screen.getByRole("tab", { name: "Working (2)", selected: true })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Positions/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "CLOSE" })[0]!);
    expect(screen.getByTestId("ipad-toast").textContent).toBe("Position Closed · +$140");
    expect(screen.getByText("+$560")).toBeTruthy();
  });
});