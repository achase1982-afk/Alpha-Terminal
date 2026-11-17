/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OptionsChainOrderSheet, type OptionsChainOrderSheetProps } from "./OptionsChainOrderSheet";
import type { StrategyLeg } from "./StrategyBuilder";

vi.mock("@/lib/store", () => ({
  useTerminalStore: (sel: (s: { symbol: string; streamPrices: Record<string, { last: number }> }) => unknown) =>
    sel({ symbol: "SPY", streamPrices: { SPY: { last: 600 } } }),
}));

vi.mock("@/lib/schwab-account-store", () => ({
  useSchwabAccountStore: (sel: (s: { accounts: unknown[]; tradingAccountHash: () => string }) => unknown) =>
    sel({ accounts: [], tradingAccountHash: () => "hash-1" }),
}));

vi.mock("@/lib/options-stream-store", () => ({
  useOptionsStreamStore: (sel: (s: { ticks: Record<string, never> }) => unknown) => sel({ ticks: {} }),
}));

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ orderId: "MOCK-1" }),
    }),
  ),
}));

const leg: StrategyLeg = {
  id: "k1",
  optionType: "CALL",
  direction: "BUY_TO_OPEN",
  strike: 600,
  expiration: "2026-12-19",
  quantity: 1,
  bid: 3.75,
  ask: 3.8,
  schwabSymbol: "SPY   261219C00600000",
};

function renderSheet(overrides?: Partial<OptionsChainOrderSheetProps>) {
  const props: OptionsChainOrderSheetProps = {
    legs: [leg],
    collapsed: false,
    onCollapsedChange: () => {},
    onClearAll: () => {},
    onLegQuantityChange: () => {},
    onRemoveLeg: () => {},
    ...overrides,
  };
  return render(<OptionsChainOrderSheet {...props} />);
}

describe("OptionsChainOrderSheet", () => {
  afterEach(() => cleanup());

  it("renders live summary and opens in-sheet confirm on Review", async () => {
    renderSheet();
    expect(screen.getByTestId("options-chain-order-sheet")).toBeTruthy();
    expect(screen.getByTestId("chain-sheet-limit")).toBeTruthy();
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getByTestId("chain-sheet-confirm")).toBeTruthy();
    expect(screen.getByText(/order confirmation/i)).toBeTruthy();
  });
});