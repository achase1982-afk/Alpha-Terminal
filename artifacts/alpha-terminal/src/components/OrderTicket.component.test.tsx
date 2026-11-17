/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { evaluateTicketPreTradeGate } from "@workspace/order-ticket-math";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
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

const atBracketPrefs: ActiveTraderTemplatePrefs = {
  template: "TRG w/ bracket",
  qty: 1,
  orderType: "LIMIT",
  limitAnchor: "Mid",
  takeProfit: { enabled: true, mode: "percent", offset: 10 },
  stopLoss: { enabled: true, mode: "percent", offset: -10 },
  autoSend: { enabled: false, armed: false },
  ladderMode: "single",
  verticalWidth: 5,
  exitDuration: "GOOD_TILL_CANCEL",
  stopLossOrderType: "STOP",
  stopLimitOffset: 0.05,
};

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

  it("keeps Review disabled with empty limit when bid/ask are missing (no last fallback)", async () => {
    mockTicks[OPT] = { last: 2.6, ts: 1, delta: 0.4 } as (typeof mockTicks)[string];
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    const limitInput = await screen.findByPlaceholderText("0.00") as HTMLInputElement;
    expect(limitInput.value).toBe("");
    const review = await screen.findByRole("button", { name: "Review" });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Limit 2\.60/i)).toBeNull();
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

  it("debit vertical shows positive spread bid/mid/ask and enables Review at snapped mid", async () => {
    const buyLeg = OPT;
    const sellLeg = "AAPL  250117C00210000";
    mockTicks = {
      [buyLeg]: { bid: 3.7, ask: 3.8, last: 3.75, ts: 1, delta: 0.55 },
      [sellLeg]: { bid: 1.2, ask: 1.25, last: 1.22, ts: 1, delta: 0.35 },
    };
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        strategyLegs={[
          {
            schwabSymbol: buyLeg,
            instruction: "BUY_TO_OPEN",
            quantity: 1,
            optionType: "CALL",
            strike: 200,
            expiration: "2025-01-17",
          },
          {
            schwabSymbol: sellLeg,
            instruction: "SELL_TO_OPEN",
            quantity: 1,
            optionType: "CALL",
            strike: 210,
            expiration: "2025-01-17",
          },
        ]}
        strategyIsCredit={false}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Bid.*2\.45/i)).toBeTruthy());
    expect(screen.getByText(/Ask.*2\.60/i)).toBeTruthy();
    const midBtn = screen.getByRole("button", { name: /^Mid/i });
    fireEvent.click(midBtn);
    const limitInput = (await screen.findByPlaceholderText("0.00")) as HTMLInputElement;
    await waitFor(() => expect(limitInput.value).toBe("2.53"));
    const review = screen.getByRole("button", { name: "Review" });
    expect((review as HTMLButtonElement).disabled).toBe(false);
  });

  it("credit vertical shows positive spread NBBO", async () => {
    const sellLeg = OPT;
    const buyLeg = "AAPL  250117C00210000";
    mockTicks = {
      [sellLeg]: { bid: 3.7, ask: 3.8, last: 3.75, ts: 1, delta: 0.55 },
      [buyLeg]: { bid: 1.2, ask: 1.25, last: 1.22, ts: 1, delta: 0.35 },
    };
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        strategyLegs={[
          {
            schwabSymbol: sellLeg,
            instruction: "SELL_TO_OPEN",
            quantity: 1,
            optionType: "CALL",
            strike: 200,
            expiration: "2025-01-17",
          },
          {
            schwabSymbol: buyLeg,
            instruction: "BUY_TO_OPEN",
            quantity: 1,
            optionType: "CALL",
            strike: 210,
            expiration: "2025-01-17",
          },
        ]}
        strategyIsCredit
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Bid.*2\.45/i)).toBeTruthy());
    expect(screen.getByText(/Ask.*2\.60/i)).toBeTruthy();
  });

  it("even-money collar spread is not crossed and keeps signed mids", async () => {
    const putLeg = "AAPL  250117P00200000";
    const callLeg = "AAPL  250117C00210000";
    mockTicks = {
      [putLeg]: { bid: 1.0, ask: 1.05, last: 1.02, ts: 1, delta: -0.3 },
      [callLeg]: { bid: 1.0, ask: 1.1, last: 1.05, ts: 1, delta: 0.3 },
    };
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        strategyLegs={[
          {
            schwabSymbol: putLeg,
            instruction: "BUY_TO_OPEN",
            quantity: 1,
            optionType: "PUT",
            strike: 200,
            expiration: "2025-01-17",
          },
          {
            schwabSymbol: callLeg,
            instruction: "SELL_TO_OPEN",
            quantity: 1,
            optionType: "CALL",
            strike: 210,
            expiration: "2025-01-17",
          },
        ]}
        strategyIsCredit={false}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    const review = await screen.findByRole("button", { name: "Review" });
    fireEvent.change(await screen.findByPlaceholderText("0.00"), { target: { value: "0.03" } });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
  });

  it("Review alone does not call place-order", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
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
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByText("Order Confirmation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("double-tap Send calls place-order exactly once (Active Trader bracket)", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve(new Response(JSON.stringify({ orderId: "fixture-99" }), { status: 200 })),
            80,
          );
        }),
    );
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        initialStage="review"
        atTemplatePrefs={atBracketPrefs}
        optionSymbol={OPT}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await screen.findByText(/Trigger order summary/i);
    await waitFor(() => {
      const send = screen.getByRole("button", { name: /send to schwab/i });
      expect((send as HTMLButtonElement).disabled).toBe(false);
    });
    const send = screen.getByRole("button", { name: /send to schwab/i });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/portfolio/place-order");
  });

  it("FAIL liquidity when any leg of a multi-leg order is crossed", async () => {
    const shortLeg = OPT;
    const longLeg = "AAPL  250117C00210000";
    mockTicks = {
      [shortLeg]: { bid: 2.5, ask: 2.7, last: 2.6, ts: 1, delta: 0.4 },
      [longLeg]: { bid: 1.5, ask: 1.2, last: 1.3, ts: 1, delta: 0.3 },
    };
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        strategyLegs={[
          {
            schwabSymbol: shortLeg,
            instruction: "SELL_TO_OPEN",
            quantity: 1,
            optionType: "CALL",
            strike: 200,
            expiration: "2025-01-17",
          },
          {
            schwabSymbol: longLeg,
            instruction: "BUY_TO_OPEN",
            quantity: 1,
            optionType: "CALL",
            strike: 210,
            expiration: "2025-01-17",
          },
        ]}
        strategyIsCredit
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: "1.00" } });
    const review = await screen.findByRole("button", { name: "Review" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(true));
  });
});
