/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AtExpiryPicker } from "./AtExpiryPicker";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import { formatAtExpiryPill } from "@/lib/active-trader/atExpiryPill";

const AM = "2026-11-20~SPX";
const PM = "2026-11-20~SPXW";

describe("AtExpiryPicker series choices", () => {
  afterEach(() => {
    useAtChromeStore.getState().clearAtExpiryChrome();
    cleanup();
  });

  it("shows Nov 20 AM and Nov 20 PM and selects each", () => {
    const picked: string[] = [];
    useAtChromeStore.getState().setAtExpiryChrome({
      options: [
        { expiration: AM, dte: 1, pillLabel: formatAtExpiryPill(AM, 1) },
        { expiration: PM, dte: 1, pillLabel: formatAtExpiryPill(PM, 1) },
      ],
      selectedExpiration: AM,
      onSelect: (expiration) => picked.push(expiration),
    });

    render(
      <div style={{ width: 440, height: 956 }}>
        <AtExpiryPicker />
      </div>,
    );

    const trigger = screen.getByTestId("at-expiry-picker");
    expect(trigger.textContent).toContain("20 NOV AM");
    expect(trigger.getAttribute("data-at-expiry-selected")).toBe(AM);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "20 NOV 2026 · 1DTE · PM" }));
    expect(picked).toEqual([PM]);
    expect(screen.getByTestId("at-expiry-picker").getAttribute("data-at-expiry-selected")).toBe(PM);
    expect(screen.getByTestId("at-expiry-picker").textContent).toContain("20 NOV PM");

    fireEvent.click(screen.getByTestId("at-expiry-picker"));
    fireEvent.click(screen.getByRole("option", { name: "20 NOV 2026 · 1DTE · AM" }));
    expect(picked).toEqual([PM, AM]);
    expect(screen.getByTestId("at-expiry-picker").textContent).toContain("20 NOV AM");
  });
});
