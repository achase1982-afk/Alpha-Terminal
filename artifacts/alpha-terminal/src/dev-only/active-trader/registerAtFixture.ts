import type { OptionChainResponse } from "@workspace/api-client-react";
import {
  type AtFixtureOverride,
  setAtFixtureOverride,
} from "@/lib/active-trader/atFixtureBridge";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import {
  FIXTURE_CLASSIFIED_PCT,
  FIXTURE_HEADLINE,
  FIXTURE_REGIME,
  FIXTURE_SPX_SPOT,
  FIXTURE_ZONE_MODEL,
  buildSpxFixtureGroups,
  buildSpxFixtureTicks,
  seedSpxFixtureFlow,
} from "./spxFixture";
import type { OptionsContract } from "@/components/OptionsTab";

function buildFixtureChainResponse(): OptionChainResponse {
  const groups = buildSpxFixtureGroups();
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  for (const row of groups[0].rows) {
    if (row.call) calls.push(row.call);
    if (row.put) puts.push(row.put);
  }
  return {
    calls,
    puts,
    underlyingPrice: FIXTURE_SPX_SPOT,
  } as OptionChainResponse;
}

export function registerAtFixtureFromLocation(): void {
  if (!import.meta.env.DEV) return;

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const scene = (params.get("scene") ?? "default") as AtFixtureOverride["scene"];
  const initialSubView = scene === "chain" ? "chain" : "at";

  setAtFixtureOverride({
    enabled: true,
    scene,
    symbol: "SPX",
    initialSubView,
    chain: buildFixtureChainResponse(),
    underlyingPrice: FIXTURE_SPX_SPOT,
    tapStrike: scene === "strip" || scene === "confirm" ? 7545 : undefined,
    openReviewOnMount: scene === "confirm",
    presentation: {
      regimeLabel: FIXTURE_REGIME.label,
      regimeDegraded: FIXTURE_REGIME.degraded,
      zones: FIXTURE_ZONE_MODEL,
      classifiedPct: FIXTURE_CLASSIFIED_PCT,
      headline: FIXTURE_HEADLINE,
      sessionLabel: "Cash session",
      skipNetwork: true,
    },
  });

  const { setSymbol, setTokens, setTraderTokens } = useTerminalStore.getState();
  useOptionsSettingsStore.getState().setStrikeCount(20);
  setSymbol("SPX");
  setTokens("at-fixture-dev-token", "");
  setTraderTokens("at-fixture-dev-token", "");

  useTerminalStore.setState((s) => ({
    streamPrices: {
      ...s.streamPrices,
      SPX: {
        symbol: "SPX",
        last: FIXTURE_SPX_SPOT,
        regularLast: FIXTURE_SPX_SPOT,
        extendedLast: null,
        bid: FIXTURE_SPX_SPOT - 0.25,
        ask: FIXTURE_SPX_SPOT + 0.25,
        bidSize: 1,
        askSize: 1,
        change: 12.4,
        changePct: 0.16,
        volume: 1_240_000,
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
        hashValue: "at-fixture-hash",
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
    accountsFingerprint: "at-fixture",
    defaultTradingAccountHash: "at-fixture-hash",
  });

  resetFlowAndTicks();
}

export function resetFlowAndTicks(): void {
  const mergeTick = useOptionsStreamStore.getState().mergeTick;
  for (const t of buildSpxFixtureTicks()) mergeTick(t);
  seedSpxFixtureFlow();
}