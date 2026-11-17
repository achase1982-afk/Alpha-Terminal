/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrategyBuilder, type StrategyLeg } from "./StrategyBuilder";

const terminalState = {
  symbol: "SPX",
  accessToken: "tok",
  preTradeEnabled: false,
  preTradeBlockOnRed: false,
  preTradeMinRR: 2,
  preTradeMaxPositionPct: 3,
  accountSize: 30_000,
};

const buyLeg: StrategyLeg = {
  id: "l1",
  optionType: "CALL",
  direction: "BUY_TO_OPEN",
  strike: 5900,
  expiration: "2026-11-18",
  quantity: 1,
  bid: 3.76,
  ask: 3.8,
  schwabSymbol: "SPXW  261118C05900000",
};

const sellLeg: StrategyLeg = {
  id: "l2",
  optionType: "CALL",
  direction: "SELL_TO_OPEN",
  strike: 5910,
  expiration: "2026-11-18",
  quantity: 1,
  bid: 1.2,
  ask: 1.25,
  schwabSymbol: "SPXW  261118C05910000",
};

vi.mock("@/lib/store", () => ({
  useTerminalStore: (sel: (s: typeof terminalState) => unknown) => sel(terminalState),
}));

vi.mock("@/hooks/useQuote", () => ({
  useQuote: () => ({
    data: { symbol: "SPX", last: 5900, bid: 5899.5, ask: 5900.5 },
  }),
}));

vi.mock("@/stores/marketPulseStore", () => ({
  useMarketPulseStore: (sel: (s: { pulseData: null }) => unknown) => sel({ pulseData: null }),
}));

vi.mock("@/lib/schwab-account-store", () => ({
  useSchwabAccountStore: (sel: (s: { tradingAccountHash: () => string }) => unknown) =>
    sel({ tradingAccountHash: () => "hash-1" }),
}));

vi.mock("@/lib/options-stream-store", () => ({
  useOptionsStreamStore: (sel: (s: { ticks: Record<string, never> }) => unknown) => sel({ ticks: {} }),
}));

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
  humanizeFailedApiBody: (x: unknown) => String(x),
}));

vi.mock("@/lib/strategistPoller", () => ({
  startStrategistPolling: vi.fn(),
}));

describe("StrategyBuilder component", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows snapped SPX limit on confirmation when Review is tapped", async () => {
    render(
      <StrategyBuilder
        isOpen
        onClose={() => {}}
        initialLegs={[buyLeg, sellLeg]}
      />,
    );
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: "3.78" } });
    const review = await screen.findByRole("button", { name: "Review" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    await screen.findByText("Order Confirmation");
    expect(screen.getByText("$3.80")).toBeTruthy();
  });
});
