import type { OptionChainResponse } from "@workspace/api-client-react";
import {
  type FuturesEsFixtureOverride,
  type FuturesEsFixtureScene,
  setFuturesEsFixtureOverride,
} from "@/lib/dev-only/futuresEsFixtureBridge";
import { useTerminalStore } from "@/lib/store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import type { OptionsSubView } from "@/components/active-trader/OptionsSubViewToggle";

export const FUTURES_ES_FIXTURE_MARKER = "futures-es-fixture-dev";

const FIXTURE_LAST = 5925.25;

function buildChainError(): OptionChainResponse {
  return {
    symbol: "/ES",
    calls: [],
    puts: [],
    error: "futures_chain_unsupported",
  } as OptionChainResponse;
}

function sceneToSubView(scene: FuturesEsFixtureScene): OptionsSubView {
  return scene === "options-chain" ? "chain" : "at";
}

export function registerFuturesEsFixtureFromLocation(): void {
  if (!import.meta.env.DEV) return;

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const scene = (params.get("scene") ?? "options-chain") as FuturesEsFixtureScene;
  const initialSubView = sceneToSubView(scene);

  const streamQuote = {
    symbol: "/ES",
    last: FIXTURE_LAST,
    regularLast: FIXTURE_LAST,
    extendedLast: FIXTURE_LAST,
    bid: FIXTURE_LAST - 0.25,
    ask: FIXTURE_LAST + 0.25,
    bidSize: 42,
    askSize: 38,
    change: 12.5,
    changePct: 0.21,
    volume: 812_400,
    high: FIXTURE_LAST + 8,
    low: FIXTURE_LAST - 15,
    close: FIXTURE_LAST - 12.5,
    ts: Date.now(),
    quoteSource: "SCHWAB" as const,
  };

  const override: FuturesEsFixtureOverride = {
    enabled: true,
    marker: FUTURES_ES_FIXTURE_MARKER,
    symbol: "/ES",
    scene,
    chain: buildChainError(),
    underlyingPrice: FIXTURE_LAST,
    streamQuote,
    initialSubView,
    openTicketConfirm: scene === "ticket-confirm",
  };

  setFuturesEsFixtureOverride(override);

  const { setSymbol, setTokens, setTraderTokens } = useTerminalStore.getState();
  setSymbol("/ES");
  setTokens("futures-es-fixture-dev", "");
  setTraderTokens("futures-es-fixture-dev", "");

  useTerminalStore.setState((s) => ({
    streamPrices: {
      ...s.streamPrices,
      "/ES": streamQuote,
    },
  }));

  const zeroBal = {
    liquidationValue: 210_000,
    equity: 210_000,
    buyingPower: 125_000,
    dayTradingBuyingPower: 125_000,
    cashBalance: 42_000,
    availableFunds: 42_000,
    marginBalance: 0,
    maintenanceRequirement: 0,
    longMarketValue: 168_000,
    shortMarketValue: 0,
    longOptionMarketValue: 0,
    shortOptionMarketValue: 0,
    moneyMarketFund: 0,
    mutualFundValue: 0,
    bondValue: 0,
    pendingDeposits: 0,
    sma: 0,
  };
  useSchwabAccountStore.setState({
    accounts: [
      {
        accountNumber: "88110495",
        hashValue: "futures-es-fixture-hash",
        type: "MARGIN",
        isDayTrader: false,
        roundTrips: 0,
        balances: zeroBal,
        initialBalances: { accountValue: 210_000, equity: 210_000, liquidationValue: 210_000 },
        dayPL: 0,
        totalPL: 0,
        positions: [],
      },
    ],
    accountsFingerprint: "futures-es-fixture",
    defaultTradingAccountHash: "futures-es-fixture-hash",
  });

  if (initialSubView === "at") {
    useAtChromeStore.getState().enterActiveTrader();
  }
}