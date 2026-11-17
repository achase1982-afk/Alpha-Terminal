import type { OptionChainResponse } from "@workspace/api-client-react";
import {
  type TicketBaselineFixtureOverride,
  type TicketBaselineScene,
  setTicketBaselineFixtureOverride,
  TICKET_BASELINE_FIXTURE_MARKER,
} from "@/lib/dev-only/ticketBaselineFixtureBridge";
import {
  type ChainOrderFixtureOverride,
  setChainOrderFixtureOverride,
} from "@/lib/dev-only/chainOrderFixtureBridge";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { useUICustomizationStore } from "@/lib/ui-customization-store";
import {
  FIXTURE_SPY_CALL_600,
  FIXTURE_SPY_SPOT,
  buildSpyChainOrderFixtureContracts,
  buildSpyChainOrderFixtureTicks,
} from "./spyChainOrderFixture";

const AAPL_SPOT = 230.12;

function isChainScene(scene: TicketBaselineScene): boolean {
  return (
    scene === "chain-1-leg-collapsed" ||
    scene === "chain-1-leg-expanded" ||
    scene === "chain-confirm"
  );
}

function seedSchwabAccounts(marker: string): void {
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
    shortOptionMarketValue: 0,
    longOptionMarketValue: 0,
    shortMarketValue: 0,
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
        hashValue: `${marker}-hash`,
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
    accountsFingerprint: marker,
    defaultTradingAccountHash: `${marker}-hash`,
  });
}

function seedTokens(): void {
  const { setSymbol, setTokens, setTraderTokens } = useTerminalStore.getState();
  setTokens("ticket-baseline-fixture-dev", "");
  setTraderTokens("ticket-baseline-fixture-dev", "");
  setSymbol("AAPL");
}

function seedStreamQuote(sym: string, spot: number): void {
  useTerminalStore.setState((s) => ({
    preTradeEnabled: false,
    streamPrices: {
      ...s.streamPrices,
      [sym]: {
        symbol: sym,
        last: spot,
        regularLast: spot,
        extendedLast: null,
        bid: spot - 0.03,
        ask: spot + 0.03,
        bidSize: 2,
        askSize: 2,
        change: 1.24,
        changePct: 0.54,
        volume: 48_200_000,
        high: spot + 1.8,
        low: spot - 2.1,
        close: spot - 0.9,
        ts: Date.now(),
      },
    },
  }));
}

function seedSpyOptionTick(): void {
  const mergeTick = useOptionsStreamStore.getState().mergeTick;
  mergeTick({
    key: FIXTURE_SPY_CALL_600,
    bid: 3.72,
    ask: 3.8,
    last: 3.76,
    bidSize: null,
    askSize: null,
    volume: null,
    openInterest: null,
    delta: 0.52,
    gamma: 0.04,
    theta: -0.08,
    vega: 0.15,
    iv: 0.22,
    mark: 3.76,
    change: null,
    ts: Date.now(),
  });
}

function buildSpyChain(): OptionChainResponse {
  const { calls, puts } = buildSpyChainOrderFixtureContracts();
  return { calls, puts, underlyingPrice: FIXTURE_SPY_SPOT } as OptionChainResponse;
}

function registerChainFixture(scene: TicketBaselineScene): void {
  const collapsed = scene === "chain-1-leg-collapsed";
  const openReviewOnMount = scene === "chain-confirm";
  const chain: ChainOrderFixtureOverride = {
    enabled: true,
    scene: openReviewOnMount ? "confirm" : "1-leg",
    marker: TICKET_BASELINE_FIXTURE_MARKER,
    symbol: "SPY",
    chain: buildSpyChain(),
    underlyingPrice: FIXTURE_SPY_SPOT,
    selectedLegs: [{ strike: 600, type: "CALL", side: "ask" }],
    openReviewOnMount,
    sheetCollapsed: collapsed,
  };
  setChainOrderFixtureOverride(chain);
  useOptionsSettingsStore.getState().setStrikeCount(10);
  useTerminalStore.getState().setSymbol("SPY");
  seedStreamQuote("SPY", FIXTURE_SPY_SPOT);
  const mergeTick = useOptionsStreamStore.getState().mergeTick;
  for (const t of buildSpyChainOrderFixtureTicks()) mergeTick(t);
}

function terminalSeedForScene(scene: TicketBaselineScene): TicketBaselineFixtureOverride["terminal"] {
  if (isChainScene(scene)) {
    return { orderOpen: false, orderSide: "BUY", contextTab: "options" };
  }
  switch (scene) {
    case "stock-sell":
      return { orderOpen: true, orderSide: "SELL", contextTab: "news" };
    case "stock-buy":
    case "stock-buy-confirm":
      return { orderOpen: true, orderSide: "BUY", contextTab: "news" };
    case "option-bto":
    case "option-bto-confirm":
      return {
        orderOpen: true,
        orderSide: "BUY",
        contextTab: "news",
        orderOptionSymbol: FIXTURE_SPY_CALL_600,
        orderOptionInstruction: "BUY_TO_OPEN",
      };
    case "option-stc":
      return {
        orderOpen: true,
        orderSide: "SELL",
        contextTab: "news",
        orderOptionSymbol: FIXTURE_SPY_CALL_600,
        orderOptionInstruction: "SELL_TO_CLOSE",
        orderIsClose: true,
      };
    default:
      return { orderOpen: true, orderSide: "BUY", contextTab: "news" };
  }
}

export function registerTicketBaselineFixtureFromLocation(): void {
  if (!import.meta.env.DEV) return;

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const scene = (params.get("scene") ?? "stock-buy") as TicketBaselineScene;

  seedTokens();
  seedSchwabAccounts(TICKET_BASELINE_FIXTURE_MARKER);
  useSchwabAccountStore.getState().setOrderTicketAccountHash(`${TICKET_BASELINE_FIXTURE_MARKER}-hash`);
  useUICustomizationStore.getState().setHeaderMode("expanded");

  if (isChainScene(scene)) {
    registerChainFixture(scene);
  } else if (scene.startsWith("option-") || scene.startsWith("stock-")) {
    if (scene.startsWith("option-")) {
      useTerminalStore.getState().setSymbol("SPY");
      seedStreamQuote("SPY", FIXTURE_SPY_SPOT);
      seedSpyOptionTick();
    } else {
      useTerminalStore.getState().setSymbol("AAPL");
      seedStreamQuote("AAPL", AAPL_SPOT);
    }
    setChainOrderFixtureOverride(null);
  }

  const override: TicketBaselineFixtureOverride = {
    enabled: true,
    marker: TICKET_BASELINE_FIXTURE_MARKER,
    scene,
    terminal: terminalSeedForScene(scene),
  };
  setTicketBaselineFixtureOverride(override);
}