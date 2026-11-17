/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { evaluateTicketPreTradeGate } from "@workspace/order-ticket-math";
import { OrderTicket } from "./OrderTicket";

const terminalState = {
  symbol: "AAPL",
  accessToken: "tok",
  preTradeEnabled: true,
  preTradeBlockOnRed: false,
  preTradeMinRR: 2,
  preTradeMaxPositionPct: 3,
  preTradeMinDTE: 1,
  stratMinPoP: 50,
  accountSize: 30_000,
};

let mockTicks: Record<string, { bid: number; ask: number; last: number; ts: number; delta: number }> = {
  "AAPL  250117C00200000": { bid: 2.5, ask: 2.7, last: 2.6, ts: 1, delta: 0.4 },
};

vi.mock("@/lib/store", () => ({
  useTerminalStore: (sel: (s: typeof terminalState) => unknown) => sel(terminalState),
}));

vi.mock("@/hooks/useQuote", () => ({
  useQuote: () => ({
    data: {
      symbol: "AAPL",
      last: 100,
      bid: 99.95,
      ask: 100.05,
    },
  }),
}));

vi.mock("@/stores/marketPulseStore", () => ({
  useMarketPulseStore: (sel: (s: { pulseData: null }) => unknown) => sel({ pulseData: null }),
}));

vi.mock("@/lib/portfolio-stream-store", () => ({
  usePortfolioStreamStore: (sel: (s: { accounts: []; balances: null }) => unknown) =>
    sel({ accounts: [], balances: null }),
}));

const schwabStoreState = {
  accounts: [] as [],
  orderTicketAccountHash: "hash-1" as string | null,
  setOrderTicketAccountHash: vi.fn(),
  tradingAccountHash: () => "hash-1",
  refreshAccounts: vi.fn(),
};

vi.mock("@/lib/schwab-account-store", () => {
  const useSchwabAccountStore = (
    sel: (s: typeof schwabStoreState) => unknown,
  ) => sel(schwabStoreState);
  useSchwabAccountStore.getState = () => schwabStoreState;
  return { useSchwabAccountStore };
});

vi.mock("@/lib/options-stream-store", () => ({
  useOptionsStreamStore: (sel: (s: { ticks: typeof mockTicks }) => unknown) => sel({ ticks: mockTicks }),
  useOptionTick: (sym?: string) => (sym ? mockTicks[sym] : undefined),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetOptionChain: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
  humanizeFailedApiBody: (x: unknown) => String(x),
}));

vi.mock("@/lib/strategistPoller", () => ({
  startStrategistPolling: vi.fn(),
}));

const OPT = "AAPL  250117C00200000";

describe("OrderTicket component", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockTicks = {
      [OPT]: { bid: 2.5, ask: 2.7, last: 2.6, ts: 1, delta: 0.4 },
    };
    schwabStoreState.orderTicketAccountHash = "hash-1";
  });

  it("formats stock limit to cents on blur", async () => {
    render(<OrderTicket isOpen onClose={() => {}} subscribeOptionSymbols={vi.fn()} />);
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: "100.1234" } });
    fireEvent.blur(limitInput);
    await waitFor(() => {
      expect((limitInput as HTMLInputElement).value).toBe("100.12");
    });
  });

  it("uses option stream bid/ask instead of underlying for single option", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Bid.*2\.50/i)).toBeTruthy());
  });

  it("FAIL liquidity blocks Review on opening tickets", async () => {
    mockTicks[OPT] = { bid: 2.9, ask: 2.5, last: 2.6, ts: 2, delta: 0.4 };
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: "2.60" } });
    const review = await screen.findByRole("button", { name: "Review" });
    expect((review as HTMLButtonElement).disabled).toBe(true);
  });

  it("closing tickets skip FAIL submit block but still require limit/qty", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        optionInstruction="SELL_TO_CLOSE"
        isCloseOrder
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: "2.60" } });
    const review = await screen.findByRole("button", { name: "Review" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    await screen.findByText("Order Confirmation");
    const send = screen.getByRole("button", { name: /send to schwab/i });
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  it("displayed limit on review matches Mid-submitted limit", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    const midBtn = await screen.findByRole("button", { name: /^Mid/i });
    fireEvent.click(midBtn);
    const limitInput = await screen.findByPlaceholderText("0.00") as HTMLInputElement;
    await waitFor(() => expect(limitInput.value).toBe("2.60"));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByText("Order Confirmation");
    expect(screen.getByText("$2.60")).toBeTruthy();
  });

  it("FAIL disables Review and Send via gate helper", () => {
    const gate = evaluateTicketPreTradeGate({
      blockOnRed: false,
      checks: [{ id: "liq", level: "RED" }],
    });
    expect(gate.shouldBlockReview).toBe(true);
    expect(gate.shouldBlockSubmit).toBe(true);
  });
});
