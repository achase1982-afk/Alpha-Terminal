import type { OptionChainResponse } from "@workspace/api-client-react";
import {
  type AtFixtureOverride,
  setAtFixtureOverride,
} from "@/lib/active-trader/atFixtureBridge";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { saveAtSettingsPanelOpen } from "@/lib/active-trader/atSettingsPanelState";
import { loadActiveTraderPrefs, saveActiveTraderPrefs } from "@/lib/active-trader/activeTraderPrefs";
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
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import { useUICustomizationStore } from "@/lib/ui-customization-store";

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
  const sceneParam = params.get("scene") ?? "default";
  const scene = (
    sceneParam === "settings-expanded" ||
    sceneParam === "settings-collapsed" ||
    sceneParam === "position" ||
    sceneParam === "focus-off" ||
    sceneParam === "vertical" ||
    sceneParam === "strip-vertical"
      ? "default"
      : sceneParam
  ) as AtFixtureOverride["scene"];
  const settingsPanelOpen =
    sceneParam === "settings-expanded" || (sceneParam !== "settings-collapsed" && params.get("panel") === "open");
  const panelOpen = sceneParam === "settings-collapsed" ? false : settingsPanelOpen;
  const focusOff = sceneParam === "focus-off" || params.get("focus") === "off";
  const initialSubView = scene === "chain" ? "chain" : "at";

  const headerParam = params.get("header");
  if (headerParam === "full") {
    useUICustomizationStore.getState().setHeaderMode("expanded");
  } else if (headerParam === "compact") {
    useUICustomizationStore.getState().setHeaderMode("collapsed");
  }
  if (initialSubView === "at") {
    useAtChromeStore.getState().enterActiveTrader();
    if (focusOff) {
      useAtChromeStore.getState().restoreSavedHeaderMode();
    }
  }

  setAtFixtureOverride({
    enabled: true,
    scene,
    symbol: "SPX",
    initialSubView,
    chain: buildFixtureChainResponse(),
    underlyingPrice: FIXTURE_SPX_SPOT,
    tapStrike:
      sceneParam === "strip" || sceneParam === "strip-vertical" || scene === "confirm" ? 7545 : undefined,
    openReviewOnMount: scene === "confirm",
    settingsPanelOpen: panelOpen,
    verticalStripOnMount: sceneParam === "strip-vertical",
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
  const demoCallKey = buildSchwabOptionKey("SPX", "2026-11-17", 7545, "C");
  const fixturePositions = [
    {
      symbol: demoCallKey,
      instrument: { symbol: demoCallKey },
      longQuantity: 2,
      shortQuantity: 0,
      quantity: 2,
      averagePrice: 3.55,
      marketValue: 710,
    },
  ];
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
        positions: fixturePositions as never[],
      },
    ],
    accountsFingerprint: "at-fixture",
    defaultTradingAccountHash: "at-fixture-hash",
  });

  usePortfolioStreamStore.getState().setAccount({
    accountNumber: "88110495",
    hashValue: "at-fixture-hash",
    type: "MARGIN",
    isDayTrader: false,
    roundTrips: 0,
    balances: zeroBal,
    initialBalances: { accountValue: 210_000, equity: 210_000, liquidationValue: 210_000 },
    dayPL: 0,
    totalPL: 0,
    positions: fixturePositions,
  });

  saveAtSettingsPanelOpen(panelOpen);

  const atPrefs = {
    ...loadActiveTraderPrefs("index"),
    takeProfit: { enabled: true, mode: "percent" as const, offset: 10 },
    stopLoss: {
      enabled: sceneParam === "confirm",
      mode: "percent" as const,
      offset: -10,
    },
    autoSend: { enabled: false, armed: false },
    ladderMode:
      sceneParam === "vertical" || sceneParam === "strip-vertical"
        ? ("vertical" as const)
        : ("single" as const),
    verticalWidth: 5 as const,
  };
  saveActiveTraderPrefs("index", atPrefs);

  resetFlowAndTicks();
}

export function resetFlowAndTicks(): void {
  const mergeTick = useOptionsStreamStore.getState().mergeTick;
  for (const t of buildSpxFixtureTicks()) mergeTick(t);
  seedSpxFixtureFlow();
}