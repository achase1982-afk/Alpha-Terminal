import type { OptionChainResponse } from "@workspace/api-client-react";
import {
  type ChainOrderFixtureOverride,
  type ChainOrderFixtureScene,
  setChainOrderFixtureOverride,
} from "@/lib/dev-only/chainOrderFixtureBridge";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import {
  FIXTURE_MARKER,
  FIXTURE_SPX_SPOT,
  buildSpxChainOrderFixtureContracts,
  buildSpxChainOrderFixtureTicks,
} from "./spxChainOrderFixture";
import type { ChainOrderFixtureLegPick } from "@/lib/dev-only/chainOrderFixtureBridge";

function scenePicks(scene: ChainOrderFixtureScene, creditVertical = false): ChainOrderFixtureLegPick[] {
  switch (scene) {
    case "1-leg":
      return [{ strike: 7540, type: "CALL", side: "ask" }];
    case "vertical":
    case "confirm":
      return creditVertical
        ? [
            { strike: 7540, type: "CALL", side: "bid" },
            { strike: 7550, type: "CALL", side: "ask" },
          ]
        : [
            { strike: 7540, type: "CALL", side: "ask" },
            { strike: 7550, type: "CALL", side: "bid" },
          ];
    case "iron-condor":
      return [
        { strike: 7525, type: "PUT", side: "ask" },
        { strike: 7530, type: "PUT", side: "bid" },
        { strike: 7550, type: "CALL", side: "bid" },
        { strike: 7555, type: "CALL", side: "ask" },
      ];
    default:
      return [];
  }
}

function buildFixtureChain(): OptionChainResponse {
  const { calls, puts } = buildSpxChainOrderFixtureContracts();
  return {
    calls,
    puts,
    underlyingPrice: FIXTURE_SPX_SPOT,
  } as OptionChainResponse;
}

export function registerChainOrderFixtureFromLocation(): void {
  if (!import.meta.env.DEV) return;

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const bracketHarness = params.get("bracket") === "1";
  const scene = (
    bracketHarness ? "vertical" : (params.get("scene") ?? "1-leg")
  ) as ChainOrderFixtureScene;
  const openReviewOnMount =
    scene === "confirm" || params.get("confirm") === "1" || bracketHarness;

  const override: ChainOrderFixtureOverride = {
    enabled: true,
    scene,
    marker: FIXTURE_MARKER,
    symbol: "SPX",
    chain: buildFixtureChain(),
    underlyingPrice: FIXTURE_SPX_SPOT,
    selectedLegs: scenePicks(scene, bracketHarness),
    openReviewOnMount,
    sheetCollapsed: false,
    mockPlaceOrder: bracketHarness && params.get("mockPlaceOrder") !== "0",
    atBracketDraft: bracketHarness
      ? {
          prefs: {
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
          },
          primaryInstruction: "SELL_TO_OPEN",
        }
      : undefined,
  };

  setChainOrderFixtureOverride(override);

  useOptionsSettingsStore.getState().setStrikeCount(20);
  const { setSymbol, setTokens, setTraderTokens } = useTerminalStore.getState();
  setSymbol("SPX");
  setTokens("chain-order-fixture-dev", "");
  setTraderTokens("chain-order-fixture-dev", "");

  useTerminalStore.setState((s) => ({
    streamPrices: {
      ...s.streamPrices,
      SPX: {
        symbol: "SPX",
        last: FIXTURE_SPX_SPOT,
        regularLast: FIXTURE_SPX_SPOT,
        extendedLast: null,
        bid: FIXTURE_SPX_SPOT - 0.35,
        ask: FIXTURE_SPX_SPOT + 0.35,
        bidSize: 1,
        askSize: 1,
        change: 18.2,
        changePct: 0.24,
        volume: 1_420_000,
        high: FIXTURE_SPX_SPOT + 18,
        low: FIXTURE_SPX_SPOT - 22,
        close: FIXTURE_SPX_SPOT - 12,
        ts: Date.now(),
      },
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
        hashValue: "chain-fixture-hash",
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
    accountsFingerprint: "chain-fixture",
    defaultTradingAccountHash: "chain-fixture-hash",
  });

  const mergeTick = useOptionsStreamStore.getState().mergeTick;
  for (const t of buildSpxChainOrderFixtureTicks()) mergeTick(t);
}