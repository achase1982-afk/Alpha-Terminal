/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { OptionsChainOrderSheet, type OptionsChainOrderSheetProps } from "./OptionsChainOrderSheet";
import type { StrategyLeg } from "./StrategyBuilder";
import {
  saveActiveTraderPrefs,
  type ActiveTraderTemplatePrefs,
} from "@/lib/active-trader/activeTraderPrefs";

vi.mock("@/lib/store", () => ({
  useTerminalStore: (sel: (s: { symbol: string; streamPrices: Record<string, { last: number }> }) => unknown) =>
    sel({ symbol: "SPY", streamPrices: { SPY: { last: 600 } } }),
}));

const schwabAccountMock = { tradingHash: "hash-1" as string | null };
vi.mock("@/lib/schwab-account-store", () => ({
  useSchwabAccountStore: (sel: (s: { accounts: unknown[]; tradingAccountHash: () => string | null }) => unknown) =>
    sel({ accounts: [], tradingAccountHash: () => schwabAccountMock.tradingHash }),
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
  afterEach(() => {
    schwabAccountMock.tradingHash = "hash-1";
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

  it("sendPreviewOnly: Review opens confirm; Send does not POST", async () => {
    const fetchMock = vi.mocked(fetchWithAuth);
    fetchMock.mockClear();
    renderSheet({ sendPreviewOnly: true });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    expect(review.textContent).toMatch(/sending off/i);
    fireEvent.click(review);
    expect(screen.getByTestId("chain-sheet-confirm")).toBeTruthy();
    const send = screen.getByTestId("chain-sheet-send");
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendPreviewOnly: Review enabled without trading account hash", async () => {
    schwabAccountMock.tradingHash = null;
    renderSheet({ sendPreviewOnly: true });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
  });

  it("sendPreviewOnly: localStorage bracket overrides stale explicit Single draft", async () => {
    const trg: ActiveTraderTemplatePrefs = {
      template: "TRG w/ bracket",
      qty: 1,
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
    const single: ActiveTraderTemplatePrefs = { ...trg, template: "Single", takeProfit: { enabled: false, mode: "percent", offset: 10 } };
    saveActiveTraderPrefs("equity", trg);
    renderSheet({
      sendPreviewOnly: true,
      atBracketDraft: { prefs: single, primaryInstruction: "BUY_TO_OPEN" },
    });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getByTestId("at-trigger-confirm")).toBeTruthy();
    expect(screen.getAllByTestId("at-trigger-confirm-row")).toHaveLength(2);
  });

  it("AT bracket draft: chain confirm uses localStorage prefs when prop omitted (preview-only)", async () => {
    const prefs: ActiveTraderTemplatePrefs = {
      template: "OCO",
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
    saveActiveTraderPrefs("equity", prefs);
    renderSheet({ sendPreviewOnly: true });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getByTestId("at-trigger-confirm")).toBeTruthy();
    expect(screen.getAllByTestId("at-trigger-confirm-row")).toHaveLength(3);
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
      sendPreviewOnly: true,
      atBracketDraft: { prefs, primaryInstruction: "SELL_TO_OPEN" },
    });
    const review = screen.getByTestId("chain-sheet-review");
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(screen.getByTestId("at-trigger-confirm")).toBeTruthy();
    expect(screen.getAllByTestId("at-trigger-confirm-row")).toHaveLength(2);
    expect(screen.queryByText(/Bracket review not supported/i)).toBeNull();
  });
});