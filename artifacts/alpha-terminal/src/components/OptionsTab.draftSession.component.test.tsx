/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { OptionsTab } from "./OptionsTab";
import { useChainDraftSessionStore } from "@/lib/orders/chainDraftSessionStore";

const harness = vi.hoisted(() => {
  const symbol = { current: "AAPL" };
  const chrome = {
    requestedSubView: null as null | "at" | "chain",
    enterActiveTrader: () => {},
    leaveActiveTrader: () => {},
    setAtExpiryChrome: () => {},
    clearAtExpiryChrome: () => {},
    consumeRequestedSubView: () => {
      chrome.requestedSubView = null;
    },
  };
  const at = {
    onSharedDraftChange: null as
      | null
      | ((legs: Array<{ contract: Record<string, unknown>; type: "CALL" | "PUT"; expiration: string; side: "bid" | "ask" }>, qty: Map<string, number>) => void),
  };
  return { symbol, chrome, at };
});

vi.mock("@/lib/active-trader/atGlanceFeature", () => ({
  atGlanceTopEnabled: () => true,
  atGlanceFlowFixtureEnabled: () => false,
  atGlanceFlowReplayEnabled: () => false,
}));

vi.mock("@/components/dashboard/widgetSymbolContext", () => ({
  useActiveSymbol: () => harness.symbol.current,
}));

const terminalState = {
  accessToken: "tok",
  traderAccessToken: null as string | null,
  streamPrices: {} as Record<string, unknown>,
  symbol: "AAPL",
};
vi.mock("@/lib/store", () => ({
  useTerminalStore: (sel: (s: typeof terminalState) => unknown) => sel(terminalState),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: (s: typeof terminalState) => unknown) => fn,
}));

vi.mock("@/lib/options-store", () => ({
  useOptionsSettingsStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      contractType: "ALL",
      strikeCount: 10,
      setCustomStrikeInput: vi.fn(),
      setStrikeCount: vi.fn(),
    };
    return sel ? sel(state) : state;
  },
}));

vi.mock("@/lib/options-columns-store", () => ({
  useOptionsColumnsStore: () => ({ activeColumnIds: ["bid", "ask"] }),
  COLUMN_REGISTRY: [
    { id: "bid", label: "Bid" },
    { id: "ask", label: "Ask" },
  ],
}));

vi.mock("@/lib/ui-customization-store", () => ({
  useUICustomizationStore: (sel: (s: { accentColor: string }) => unknown) => sel({ accentColor: "gold" }),
  ACCENT_COLORS: { gold: "#FFB800" },
}));

vi.mock("@/lib/active-trader/atChromeStore", () => ({
  useAtChromeStore: Object.assign(
    (sel: (s: typeof harness.chrome) => unknown) => sel(harness.chrome),
    { getState: () => harness.chrome },
  ),
}));

vi.mock("@/lib/schwab-account-store", () => ({
  useSchwabAccountStore: (sel?: (s: { accounts: never[]; tradingAccountHash: () => null }) => unknown) => {
    const state = { accounts: [] as never[], tradingAccountHash: () => null };
    return sel ? sel(state) : state;
  },
}));

vi.mock("@/hooks/useChainOptionHold", () => ({
  useChainOptionHold: () => ({
    subscribeOptionSymbols: vi.fn(),
    releaseOptionHold: vi.fn(),
    holdSig: undefined,
    keys: [],
    viewId: undefined,
  }),
}));

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetQuote: () => ({ data: { symbol: "AAPL", last: 350.5, bid: 350.4, ask: 350.6 } }),
  useGetOptionChain: () => ({
    data: {
      symbol: "AAPL",
      underlyingPrice: 350.5,
      calls: [
        { strike: 350, expiration: "2026-11-21", bid: 2.5, ask: 2.7, streamKey: "AAPL_CALL_350" },
        { strike: 350, expiration: "2026-11-20", bid: 1.2, ask: 1.4, streamKey: "AAPL_CALL_350_1120" },
      ],
      puts: [
        { strike: 350, expiration: "2026-11-21", bid: 2.4, ask: 2.6, streamKey: "AAPL_PUT_350" },
      ],
    },
    isLoading: false,
    error: null,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null }),
}));

vi.mock("@/lib/options-stream-store", () => {
  const state = { ticks: {} as Record<string, never> };
  return {
    useOptionsStreamStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
      getState: () => state,
      subscribe: () => () => {},
    }),
    useOptionTick: () => undefined,
  };
});

vi.mock("@/components/active-trader/ActiveTraderView", () => ({
  ActiveTraderView: (props: {
    onSharedDraftChange?: typeof harness.at.onSharedDraftChange;
  }) => {
    harness.at.onSharedDraftChange = props.onSharedDraftChange ?? null;
    return <div data-testid="active-trader-pane" />;
  },
}));

vi.mock("@/components/OptionsChainOrderSheet", () => ({
  OptionsChainOrderSheet: (props: {
    restoredSheetSession?: { limitPrice?: string; limitLocked?: boolean };
    legs: Array<{ quantity?: number; strike?: number; optionType?: string }>;
  }) => (
    <div
      data-chain-order-sheet
      data-at-order-sheet
      data-at-limit-locked={props.restoredSheetSession?.limitLocked ? "true" : "false"}
      data-limit-price={props.restoredSheetSession?.limitPrice ?? ""}
      data-leg-qty={(props.legs ?? []).map((leg) => leg.quantity ?? 1).join(",")}
    />
  ),
  legsFromChainSelection: (
    entries: Array<{ quantity?: number; type: string; contract: { strike: number } }>,
  ) =>
    entries.map((entry) => ({
      quantity: entry.quantity ?? 1,
      strike: entry.contract.strike,
      optionType: entry.type,
    })),
}));

vi.mock("framer-motion", () => ({
  Reorder: {
    Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

const callLeg = {
  key: "2026-11-21|350|CALL",
  contract: { strike: 350, expiration: "2026-11-21", bid: 2.5, ask: 2.7, streamKey: "AAPL_CALL_350" },
  type: "CALL" as const,
  expiration: "2026-11-21",
  side: "bid" as const,
};
const putLeg = {
  key: "2026-11-21|350|PUT",
  contract: { strike: 350, expiration: "2026-11-21", bid: 2.4, ask: 2.6, streamKey: "AAPL_PUT_350" },
  type: "PUT" as const,
  expiration: "2026-11-21",
  side: "ask" as const,
};

function seedDraft() {
  useChainDraftSessionStore.getState().setDraft("AAPL", {
    selectedLegs: [callLeg, putLeg],
    legQuantities: {
      "2026-11-21|350|CALL": 3,
      "2026-11-21|350|PUT": 3,
    },
    chainTicketOpen: true,
    sheetCollapsed: false,
    sheet: { limitPrice: "2.00", limitLocked: true },
  });
}

describe("Options draft session", () => {
  beforeEach(() => {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    harness.symbol.current = "AAPL";
    harness.chrome.requestedSubView = null;
    harness.at.onSharedDraftChange = null;
    useChainDraftSessionStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
    useChainDraftSessionStore.getState().clear();
  });

  it("keeps the locked draft when Options remounts on the same symbol", async () => {
    seedDraft();
    const first = render(<OptionsTab />);
    await waitFor(() => {
      expect(useChainDraftSessionStore.getState().selectedLegs).toHaveLength(2);
      expect(useChainDraftSessionStore.getState().sheet).toEqual({ limitPrice: "2.00", limitLocked: true });
      expect(document.querySelector("[data-at-limit-locked]")?.getAttribute("data-at-limit-locked")).toBe("true");
      expect(document.querySelector("[data-limit-price]")?.getAttribute("data-limit-price")).toBe("2.00");
      expect(document.querySelector("[data-leg-qty]")?.getAttribute("data-leg-qty")).toBe("3,3");
      expect(document.querySelectorAll("[data-limit-price]")).toHaveLength(1);
    });

    first.unmount();
    render(<OptionsTab />);

    await waitFor(() => {
      const draft = useChainDraftSessionStore.getState();
      expect(draft.symbol).toBe("AAPL");
      expect(draft.selectedLegs.map((leg) => leg.key)).toEqual([
        "2026-11-21|350|CALL",
        "2026-11-21|350|PUT",
      ]);
      expect(draft.legQuantities["2026-11-21|350|CALL"]).toBe(3);
      expect(draft.sheet.limitLocked).toBe(true);
      expect(draft.sheet.limitPrice).toBe("2.00");
      expect(document.querySelector("[data-at-limit-locked]")?.getAttribute("data-at-limit-locked")).toBe("true");
      expect(document.querySelectorAll("[data-limit-price]")).toHaveLength(1);
    });
  });

  it("clears the draft when the ticker changes", async () => {
    seedDraft();
    const view = render(<OptionsTab />);
    await waitFor(() => {
      expect(useChainDraftSessionStore.getState().selectedLegs).toHaveLength(2);
    });

    harness.symbol.current = "MSFT";
    view.rerender(<OptionsTab />);

    await waitFor(() => {
      const draft = useChainDraftSessionStore.getState();
      expect(draft.selectedLegs).toHaveLength(0);
      expect(draft.sheet.limitLocked).toBe(false);
      expect(document.querySelector("[data-chain-order-sheet]")).toBeNull();
    });
  });

  it("writes an Active Trader edit into the same draft the chain ticket reads", async () => {
    seedDraft();
    harness.chrome.requestedSubView = "at";
    const view = render(<OptionsTab />);
    await waitFor(() => {
      expect(harness.at.onSharedDraftChange).toEqual(expect.any(Function));
      expect(document.querySelector("[data-chain-order-sheet]")).toBeNull();
    });

    act(() => {
      harness.at.onSharedDraftChange?.(
        [
          {
            contract: { strike: 350, expiration: "2026-11-21", bid: 2.5, ask: 2.7 },
            type: "CALL",
            expiration: "2026-11-21",
            side: "ask",
          },
        ],
        new Map([["2026-11-21|350|CALL", 4]]),
      );
    });

    await waitFor(() => {
      const draft = useChainDraftSessionStore.getState();
      expect(draft.selectedLegs).toHaveLength(1);
      expect(draft.selectedLegs[0]?.side).toBe("ask");
      expect(draft.selectedLegs[0]?.type).toBe("CALL");
      expect(draft.legQuantities["2026-11-21|350|CALL"]).toBe(4);
    });

    view.unmount();
    harness.chrome.requestedSubView = null;
    render(<OptionsTab />);

    await waitFor(() => {
      expect(document.querySelector("[data-leg-qty]")?.getAttribute("data-leg-qty")).toBe("4");
      expect(document.querySelectorAll("[data-limit-price]")).toHaveLength(1);
    });
  });
});
