/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  OptionsChainOrderSheet,
  legsFromChainSelection,
  type OptionsChainOrderSheetProps,
} from "./OptionsChainOrderSheet";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import type { StrategyLeg } from "./StrategyBuilder";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";

const { sendAllowedMock } = vi.hoisted(() => ({
  sendAllowedMock: vi.fn(() => true),
}));
vi.mock("@/lib/active-trader/atOrderSend", () => ({
  atOrderSendAllowed: sendAllowedMock,
  atOrderSendUnavailableReason: () =>
    sendAllowedMock() ? null : "Preview only. Live routing is off.",
}));

vi.mock("@/lib/store", () => ({
  useTerminalStore: (sel: (s: { symbol: string; streamPrices: Record<string, { last: number }> }) => unknown) =>
    sel({ symbol: "SPY", streamPrices: { SPY: { last: 600 } } }),
}));

const schwabAccountMock = { tradingHash: "hash-1" as string | null };
vi.mock("@/lib/schwab-account-store", () => ({
  useSchwabAccountStore: (sel: (s: { accounts: unknown[]; tradingAccountHash: () => string | null }) => unknown) =>
    sel({ accounts: [], tradingAccountHash: () => schwabAccountMock.tradingHash }),
}));

vi.mock("@/lib/options-stream-store", () => {
  const state = { ticks: {} as Record<string, never> };
  return {
    useOptionsStreamStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
      getState: () => state,
      subscribe: () => () => {},
    }),
  };
});

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

describe("legsFromChainSelection", () => {
  it("prefers streamKey when schwabSymbol is absent (AT ladder)", () => {
    const legs = legsFromChainSelection(
      [
        {
          key: "k1",
          contract: {
            strike: 7340,
            expiration: "not-a-parseable-date",
            streamKey: ".SPXW251118C07340000",
          },
          type: "CALL",
          side: "ask",
        },
      ],
      "$SPX",
      [],
      buildSchwabOptionKey,
      null,
    );
    expect(legs).toHaveLength(1);
    expect(legs[0]!.schwabSymbol).toBe(".SPXW251118C07340000");
  });
});

describe("OptionsChainOrderSheet", () => {
  afterEach(() => {
    schwabAccountMock.tradingHash = "hash-1";
    sendAllowedMock.mockReturnValue(true);
    localStorage.clear();
    cleanup();
  });

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

  it("does not place order on Review; Send calls place-order exactly once", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
    renderSheet();
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getByTestId("chain-sheet-confirm")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    const send = screen.getByTestId("chain-sheet-send");
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/portfolio/place-order");
  });

  it("uses the centralized send gate without a preview-only prop", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
    sendAllowedMock.mockReturnValue(false);
    renderSheet();
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getByTestId("chain-sheet-confirm")).toBeTruthy();
    const send = screen.getByTestId("chain-sheet-send");
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(send.textContent).toMatch(/send unavailable/i);
    expect(screen.getByText("Preview only. Live routing is off.")).toBeTruthy();
    fireEvent.click(send);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("spread bracket Send posts TRIGGER with NET_DEBIT child at calculated TP", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
    const prefs: ActiveTraderTemplatePrefs = {
      template: "TRG w/ bracket",
      qty: 1,
      orderType: "LIMIT",
      limitAnchor: "Mid",
      takeProfit: { enabled: true, mode: "percent", offset: 25 },
      stopLoss: { enabled: false, mode: "percent", offset: -10 },
      autoSend: { enabled: false, armed: false },
      ladderMode: "single",
      verticalWidth: 5,
      exitDuration: "GOOD_TILL_CANCEL",
      stopLossOrderType: "STOP",
      stopLimitOffset: 0.05,
    };
    const shortLeg: StrategyLeg = {
      id: "k1",
      optionType: "CALL",
      direction: "SELL_TO_OPEN",
      strike: 600,
      expiration: "2026-12-19",
      quantity: 1,
      bid: 2.85,
      ask: 2.92,
      schwabSymbol: "SPY   261219C00600000",
    };
    const longLeg: StrategyLeg = {
      id: "k2",
      optionType: "CALL",
      direction: "BUY_TO_OPEN",
      strike: 605,
      expiration: "2026-12-19",
      quantity: 1,
      bid: 1.1,
      ask: 1.15,
      schwabSymbol: "SPY   261219C00605000",
    };
    renderSheet({
      legs: [shortLeg, longLeg],
      atBracketDraft: { prefs, primaryInstruction: "SELL_TO_OPEN" },
    });
    const limit = screen.getByTestId("chain-sheet-limit") as HTMLInputElement;
    fireEvent.change(limit, { target: { value: "2.00" } });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getAllByText(/SPY 600C\/605C/)).toHaveLength(2);
    const send = screen.getByTestId("chain-sheet-send");
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const order = body.order;
    expect(order.orderStrategyType).toBe("TRIGGER");
    expect(order.complexOrderStrategyType).toBe("VERTICAL");
    expect(order.price).toBe(2);
    const child = order.childOrderStrategies[0];
    expect(child.orderType).toBe("NET_DEBIT");
    expect(child.complexOrderStrategyType).toBe("VERTICAL");
    expect(child.price).toBe(1.5);
    expect(child.orderLegCollection.map((l: { instruction: string }) => l.instruction)).toEqual([
      "BUY_TO_CLOSE",
      "SELL_TO_CLOSE",
    ]);
  });

  it("single-leg SL Send posts TRIGGER with STOP child at $1.80", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
    const prefs: ActiveTraderTemplatePrefs = {
      template: "TRG w/ bracket",
      qty: 1,
      orderType: "LIMIT",
      limitAnchor: "Mid",
      takeProfit: { enabled: false, mode: "percent", offset: 25 },
      stopLoss: { enabled: true, mode: "percent", offset: -10 },
      autoSend: { enabled: false, armed: false },
      ladderMode: "single",
      verticalWidth: 5,
      exitDuration: "GOOD_TILL_CANCEL",
      stopLossOrderType: "STOP",
      stopLimitOffset: 0.05,
    };
    renderSheet({
      atBracketDraft: { prefs, primaryInstruction: "BUY_TO_OPEN" },
    });
    const limit = screen.getByTestId("chain-sheet-limit") as HTMLInputElement;
    fireEvent.change(limit, { target: { value: "2.00" } });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    const send = screen.getByTestId("chain-sheet-send");
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const order = body.order;
    expect(order.orderStrategyType).toBe("TRIGGER");
    expect(order.price).toBe(2);
    const child = order.childOrderStrategies[0];
    expect(child.orderType).toBe("STOP");
    expect(child.stopPrice).toBe(1.8);
    expect(child.orderLegCollection[0].instruction).toBe("SELL_TO_CLOSE");
  });

  it("AT bracket draft: chain confirm shows trigger rows (Sequence)", async () => {
    const prefs: ActiveTraderTemplatePrefs = {
      template: "TRG w/ bracket",
      qty: 2,
      orderType: "LIMIT",
      limitAnchor: "Mid",
      takeProfit: { enabled: true, mode: "percent", offset: 10 },
      stopLoss: { enabled: false, mode: "percent", offset: -10 },
      autoSend: { enabled: false, armed: false },
      ladderMode: "single",
      verticalWidth: 5,
      exitDuration: "GOOD_TILL_CANCEL",
      stopLossOrderType: "STOP",
      stopLimitOffset: 0.05,
    };
    renderSheet({
      atBracketDraft: { prefs, primaryInstruction: "SELL_TO_OPEN" },
    });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getByTestId("at-trigger-confirm")).toBeTruthy();
    expect(screen.getAllByTestId("at-trigger-confirm-row")).toHaveLength(2);
    expect(screen.queryByText(/Bracket review not supported/i)).toBeNull();
  });

  it("AT take profit posts a Schwab trigger whose child is the closing instruction", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
    const prefs: ActiveTraderTemplatePrefs = {
      template: "TRG w/ bracket",
      qty: 1,
      orderType: "LIMIT",
      limitAnchor: "Mid",
      takeProfit: { enabled: true, mode: "percent", offset: 25 },
      stopLoss: { enabled: false, mode: "percent", offset: -10 },
      autoSend: { enabled: false, armed: false },
      ladderMode: "single",
      verticalWidth: 5,
      exitDuration: "GOOD_TILL_CANCEL",
      stopLossOrderType: "STOP",
      stopLimitOffset: 0.05,
      entryDuration: "DAY",
      schwabEntryType: "LIMIT",
      submission: "review",
    };
    renderSheet({ atBracketDraft: { prefs, primaryInstruction: "BUY_TO_OPEN" } });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    fireEvent.click(screen.getByTestId("chain-sheet-send"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { order: Record<string, unknown> };
    expect(body.order.orderStrategyType).toBe("TRIGGER");
    expect(body.order.duration).toBe("DAY");
    const child = (body.order.childOrderStrategies as Record<string, unknown>[])[0];
    expect(child.orderType).toBe("LIMIT");
    expect((child.orderLegCollection as { instruction: string }[])[0].instruction).toBe("SELL_TO_CLOSE");
  });
});