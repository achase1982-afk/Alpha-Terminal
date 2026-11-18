/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OptionsTab } from "./OptionsTab";

vi.mock("@/lib/active-trader/atGlanceFeature", () => ({
  atGlanceTopEnabled: () => true,
  atGlanceFlowFixtureEnabled: () => false,
  atGlanceFlowReplayEnabled: () => false,
}));

vi.mock("@/components/dashboard/widgetSymbolContext", () => ({
  useActiveSymbol: () => "AAPL",
}));

const terminalState = { accessToken: "tok", streamPrices: {} as Record<string, unknown> };
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
  useAtChromeStore: (sel: (s: Record<string, () => void>) => unknown) =>
    sel({
      enterActiveTrader: vi.fn(),
      leaveActiveTrader: vi.fn(),
      setAtExpiryChrome: vi.fn(),
      clearAtExpiryChrome: vi.fn(),
    }),
}));

vi.mock("@/lib/schwab-account-store", () => ({
  useSchwabAccountStore: () => ({ accounts: [], tradingAccountHash: () => null }),
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
        {
          strike: 350,
          expiration: "2026-11-21",
          bid: 2.5,
          ask: 2.7,
          streamKey: "AAPL_CALL_350",
        },
      ],
      puts: [
        {
          strike: 350,
          expiration: "2026-11-21",
          bid: 2.4,
          ask: 2.6,
          streamKey: "AAPL_PUT_350",
        },
      ],
    },
    isLoading: false,
    error: null,
    isFetching: false,
    dataUpdatedAt: Date.now(),
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null }),
}));

vi.mock("@/lib/options-stream-store", () => ({
  useOptionsStreamStore: (sel: (s: { ticks: Record<string, never> }) => unknown) => sel({ ticks: {} }),
  useOptionTick: () => undefined,
}));

vi.mock("@/components/active-trader/ActiveTraderView", () => ({
  ActiveTraderView: () => <div data-at-root data-at-glance-top data-testid="active-trader-pane" />,
}));

vi.mock("framer-motion", () => ({
  Reorder: {
    Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

describe("OptionsTab subview toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Chain / Active Trader toggle when glance top is default and switches to AT", async () => {
    render(<OptionsTab />);

    expect(screen.queryByTestId("active-trader-pane")).toBeNull();

    expect(screen.getByRole("button", { name: "Active Trader" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chain" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Active Trader" }));

    await waitFor(() => {
      expect(screen.getByTestId("active-trader-pane")).toBeTruthy();
    });
  });
});