/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { loadActiveTraderPrefs } from "@/lib/active-trader/activeTraderPrefs";
import { AtOrderDefaultsSheet } from "./AtOrderDefaultsSheet";

describe("AtOrderDefaultsSheet", () => {
  it("matches the defaults sheet and saves a closing take profit without an open/close toggle", () => {
    const onSave = vi.fn();
    render(
      <AtOrderDefaultsSheet
        open
        prefs={loadActiveTraderPrefs("index")}
        primaryInstruction="BUY_TO_OPEN"
        windowSec={30}
        onWindowSecChange={() => {}}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("heading", { name: "Order defaults" })).toBeTruthy();
    expect(screen.getByText("Used for each new Active Trader order")).toBeTruthy();
    expect(screen.getByText("Limit")).toBeTruthy();
    expect(screen.getByText("Day")).toBeTruthy();
    expect(screen.getByText("Percent of entry debit")).toBeTruthy();
    expect(screen.getByText("25 %")).toBeTruthy();
    expect(screen.getByText("Available units: percent, dollars, standard deviations.")).toBeTruthy();
    expect(screen.getByText("Margin · BEST")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review before sending" })).toBeTruthy();
    expect(screen.queryByText(/sell to close/i)).toBeNull();
    expect(screen.queryByText(/sell to open/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.takeProfit).toMatchObject({ enabled: true, mode: "percent", offset: 25 });
    expect(saved.stopLoss.enabled).toBe(false);
    expect(saved.submission).toBe("review");
    expect(saved.schwabEntryType).toBe("LIMIT");
    expect(saved.entryDuration).toBe("DAY");
  });
});
