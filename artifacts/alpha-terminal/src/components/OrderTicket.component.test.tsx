/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { evaluateTicketPreTradeGate } from "@workspace/order-ticket-math";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { OrderTicket } from "./OrderTicket";

const { orderSendGate } = vi.hoisted(() => ({ orderSendGate: { allowed: true } }));
vi.mock("@/lib/active-trader/atOrderSend", () => ({
  atOrderSendAllowed: () => orderSendGate.allowed,
}));

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

const OPT = "AAPL  250117C00200000";
const OPT_PUT = "AAPL  250117P00200000";

let mockTicks: Record<string, { bid: number; ask: number; last: number; ts: number; delta: number }> = {
  [OPT]: { bid: 2.5, ask: 2.7, last: 2.6, ts: 1, delta: 0.4 },
  [OPT_PUT]: { bid: 2.5, ask: 2.7, last: 2.6, ts: 1, delta: -0.4 },
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
      [OPT_PUT]: { bid: 2.5, ask: 2.7, last: 2.6, ts: 1, delta: -0.4 },
    };
    schwabStoreState.orderTicketAccountHash = "hash-1";
    orderSendGate.allowed = true;
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

  it("offers bracket exits on a regular stock ticket and previews them on review", async () => {
    render(<OrderTicket isOpen onClose={() => {}} subscribeOptionSymbols={vi.fn()} />);
    const bracket = await screen.findByTestId("regular-ticket-bracket-controls");
    const exits = within(bracket).getAllByRole("checkbox");
    expect(exits).toHaveLength(2);
    expect(exits.every((checkbox) => checkbox.getAttribute("data-state") === "unchecked")).toBe(true);
    fireEvent.click(exits[0]!);
    fireEvent.click(exits[1]!);
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: "100.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByText("Order Confirmation");
    expect(screen.getByText("Take profit")).toBeTruthy();
    expect(screen.getByText("Stop loss")).toBeTruthy();
  });

  it("offers bracket exits for an opening stock short", async () => {
    render(
      <OrderTicket
        isOpen
        initialSide="SELL"
        onClose={() => {}}
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("regular-ticket-bracket-controls")).toBeTruthy();
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
    const confirmation = screen.getByRole("heading", { name: "Order Confirmation" }).parentElement
      ?.parentElement;
    expect(confirmation).toBeTruthy();
    const limitLabel = within(confirmation as HTMLElement).getByText("Limit price");
    const limitRow = limitLabel.closest("div");
    expect(within(limitRow as HTMLElement).getByText("$2.60")).toBeTruthy();
  });

  async function openReviewWithLimit(limit: string) {
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: limit } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByText("Order Confirmation");
  }

  it("STC option shows gross credit, positive net credit, no BP", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        optionInstruction="SELL_TO_CLOSE"
        isCloseOrder
        initialSide="SELL"
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await openReviewWithLimit("3.00");
    expect(screen.getByText(/Gross credit/i)).toBeTruthy();
    expect(screen.getByText(/Net credit \(after est\. fees\)/i)).toBeTruthy();
    expect(screen.getByText(/\+\$299\.33/)).toBeTruthy();
    expect(screen.getByText("Not estimated")).toBeTruthy();
    expect(screen.queryByText(/Buying power \(est\.\)/i)).toBeNull();
    expect(screen.queryByText(/^Breakeven$/i)).toBeNull();
    expect(screen.queryByText(/Max profit/i)).toBeNull();
    expect(screen.queryByText(/Max loss/i)).toBeNull();
  });

  it("sell stock to close shows gross credit and no BP", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        isCloseOrder
        initialSide="SELL"
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    const qty = await screen.findByDisplayValue("1");
    fireEvent.change(qty, { target: { value: "10" } });
    await openReviewWithLimit("230");
    expect(screen.getByText(/Gross credit/i)).toBeTruthy();
    expect(screen.getByText(/\+\$2,300/)).toBeTruthy();
    expect(screen.queryByText(/Buying power \(est\.\)/i)).toBeNull();
    expect(screen.queryByText(/^Breakeven$/i)).toBeNull();
    expect(screen.queryByText(/Max profit/i)).toBeNull();
    expect(screen.queryByText(/Max loss/i)).toBeNull();
  });

  it("STO naked call shows credit proceeds but BP not estimated", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        optionInstruction="SELL_TO_OPEN"
        initialSide="SELL"
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await openReviewWithLimit("3.00");
    expect(screen.getByText(/Gross credit/i)).toBeTruthy();
    expect(screen.getAllByText("Not estimated").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/−\$0\.00/)).toBeNull();
    expect(screen.queryByText("Unlimited")).toBeNull();
    const maxLossRow = screen.getByText(/Max loss/i).closest("div");
    expect(within(maxLossRow as HTMLElement).getByText("Not estimated")).toBeTruthy();
  });

  it("STO naked put shows max loss not estimated and cash-secured collateral", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT_PUT}
        optionInstruction="SELL_TO_OPEN"
        initialSide="SELL"
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await openReviewWithLimit("3.00");
    expect(screen.getByText(/Max loss/i)).toBeTruthy();
    const maxLossRow = screen.getByText(/Max loss/i).closest("div");
    expect(within(maxLossRow as HTMLElement).getByText("Not estimated")).toBeTruthy();
    expect(screen.getByText(/Cash-secured collateral/i)).toBeTruthy();
    expect(screen.queryByText(/−\$0\.00/)).toBeNull();
  });

  it("BTO single leg shows gross debit and BP estimate", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT}
        optionInstruction="BUY_TO_OPEN"
        initialSide="BUY"
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await openReviewWithLimit("3.00");
    expect(screen.getByText(/Gross debit/i)).toBeTruthy();
    expect(screen.getByText(/Buying power \(est\.\)/i)).toBeTruthy();
    const bpHits = screen.getAllByText(/−\$300\.67/);
    expect(bpHits.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("$203.00")).toBeTruthy();
    expect(screen.getByText("Unlimited")).toBeTruthy();
    const maxLossRow = screen.getByText(/Max loss/i).closest("div");
    expect(within(maxLossRow as HTMLElement).getByText("$300.67")).toBeTruthy();
  });

  it("BTO put shows breakeven below strike minus premium", async () => {
    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        optionSymbol={OPT_PUT}
        optionInstruction="BUY_TO_OPEN"
        initialSide="BUY"
        subscribeOptionSymbols={vi.fn()}
      />,
    );
    await openReviewWithLimit("3.00");
    expect(screen.getByText("$197.00")).toBeTruthy();
    const maxLossRow = screen.getByText(/Max loss/i).closest("div");
    expect(within(maxLossRow as HTMLElement).getByText("$300.67")).toBeTruthy();
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

  it("after Active Trader close, chain ticket submits plain SINGLE (no bracket prefs)", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ orderId: "chain-1" }), { status: 200 }));

    const { rerender } = render(
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

    rerender(
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
    const send = await screen.findByRole("button", { name: /send to schwab/i });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      order?: Record<string, unknown>;
    };
    const order = payload.order ?? {};
    expect(order.orderStrategyType).toBe("SINGLE");
    expect(order.orderStrategyType).not.toBe("TRIGGER");
    expect(order.childOrderStrategies).toBeUndefined();
  });

  it("disabled send gate shows a non-live label and skips place-order", async () => {
    orderSendGate.allowed = false;
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
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
    const send = await screen.findByRole("button", { name: /sending off/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mobile AT draft: side, qty, and TP stay consistent through Review", async () => {
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    const mobileDraftPrefs: ActiveTraderTemplatePrefs = {
      ...atBracketPrefs,
      template: "Single",
      stopLoss: { ...atBracketPrefs.stopLoss, enabled: false },
    };

    render(
      <OrderTicket
        isOpen
        onClose={() => {}}
        initialSide="BUY"
        atTemplatePrefs={mobileDraftPrefs}
        optionSymbol={OPT}
        subscribeOptionSymbols={vi.fn()}
      />,
    );

    await screen.findByTestId("at-mobile-review");
    const limitInput = document.querySelector("[data-at-mobile-peek] input") as HTMLInputElement;
    fireEvent.change(limitInput, { target: { value: "2.60" } });
    fireEvent.click(screen.getByRole("button", { name: "SELL" }));
    fireEvent.click(screen.getByLabelText("Increase quantity"));
    const tp = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(tp);
    expect(tp.checked).toBe(false);

    fireEvent.click(await screen.findByTestId("at-mobile-review"));
    await screen.findByText("Order Confirmation");

    const pinned = document.querySelector("[data-at-confirm-pinned]");
    expect(pinned?.textContent ?? "").toMatch(/SELL/i);
    expect(pinned?.textContent ?? "").toMatch(/2/);

    expect(screen.queryByText(/Trigger order summary/i)).toBeNull();
    expect(screen.queryByText(/Take profit/i)).toBeNull();

    vi.unstubAllGlobals();
  });

  it("ignores stale optionInstruction after side flip: STO qty 2 no TP on Review and wire", async () => {
    vi.stubEnv("VITE_AT_ORDER_SEND", "1");
    vi.resetModules();
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
    const { OrderTicket: Ticket } = await import("./OrderTicket");

    const prefs: ActiveTraderTemplatePrefs = {
      ...atBracketPrefs,
      template: "Single",
      takeProfit: { ...atBracketPrefs.takeProfit, enabled: false },
      stopLoss: { ...atBracketPrefs.stopLoss, enabled: false },
    };

    render(
      <Ticket
        isOpen
        onClose={() => {}}
        initialSide="BUY"
        optionInstruction="BUY_TO_OPEN"
        atTemplatePrefs={prefs}
        optionSymbol={OPT}
        subscribeOptionSymbols={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    fireEvent.click(screen.getByLabelText("Increase quantity"));
    const limitInput = await screen.findByPlaceholderText("0.00");
    fireEvent.change(limitInput, { target: { value: "2.60" } });
    const review = await screen.findByRole("button", { name: "Review" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    await screen.findByText("Order Confirmation");
    expect(screen.getByText(/Sell to open/i)).toBeTruthy();
    expect(screen.queryByText(/Trigger order summary/i)).toBeNull();

    const send = await screen.findByRole("button", { name: /send to schwab/i });
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(init?.body ?? "{}")) as { order?: Record<string, unknown> };
    const legs = (payload.order?.orderLegCollection ?? []) as { instruction: string; quantity: number }[];
    expect(legs[0]?.instruction).toBe("SELL_TO_OPEN");
    expect(legs[0]?.quantity).toBe(2);
    expect(payload.order?.childOrderStrategies).toBeUndefined();

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("double-tap Send calls place-order exactly once (Active Trader bracket)", async () => {
    vi.stubEnv("VITE_AT_ORDER_SEND", "1");
    vi.resetModules();
    const { OrderTicket: Ticket } = await import("./OrderTicket");
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
      <Ticket
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
    vi.unstubAllEnvs();
    vi.resetModules();
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
