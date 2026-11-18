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
import {
  FIXTURE_AAPL_SPOT,
  FIXTURE_AAPL_ZONES,
  buildAaplFixtureChain,
  buildAaplFixtureTicks,
} from "./aaplFixture";
import {
  FIXTURE_NVDA_SPOT,
  FIXTURE_NVDA_OPEN,
  FIXTURE_NVDA_ZONES,
  buildNvdaFixtureChain,
  buildNvdaFixtureTicks,
} from "./nvdaFixture";
import { FIXTURE_ES_SPOT, FIXTURE_ES_ZONES, buildEsFixtureChain } from "./esFixture";
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
  const fixtureKind = (params.get("fixture") ?? "spx").toLowerCase();
  const isAapl = fixtureKind === "aapl";
  const isNvda = fixtureKind === "nvda";
  const isEs = fixtureKind === "es";
  try {
    localStorage.setItem("at_glance_top", "1");
  } catch {
    /* ignore */
  }
  const sceneParam = params.get("scene") ?? "default";
  const headerDownScene = sceneParam === "header-down";
  const scene = (
    sceneParam === "settings-expanded" ||
    sceneParam === "settings-collapsed" ||
    sceneParam === "position" ||
    sceneParam === "focus-off" ||
    sceneParam === "vertical" ||
    sceneParam === "strip-vertical" ||
    headerDownScene
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
    symbol: isEs ? "/ES" : isNvda ? "NVDA" : isAapl ? "AAPL" : "SPX",
    initialSubView,
    chain: isEs
      ? buildEsFixtureChain()
      : isNvda
        ? buildNvdaFixtureChain()
        : isAapl
          ? buildAaplFixtureChain()
          : buildFixtureChainResponse(),
    underlyingPrice: isEs ? FIXTURE_ES_SPOT : isNvda ? FIXTURE_NVDA_SPOT : isAapl ? FIXTURE_AAPL_SPOT : FIXTURE_SPX_SPOT,
    tapStrike:
      sceneParam === "strip" || sceneParam === "strip-vertical" || scene === "confirm"
        ? isAapl
          ? 350
          : 7545
        : undefined,
    openReviewOnMount: scene === "confirm",
    settingsPanelOpen: panelOpen,
    verticalStripOnMount: sceneParam === "strip-vertical",
    presentation: {
      regimeLabel: isAapl ? "mild bullish" : FIXTURE_REGIME.label,
      regimeDegraded: false,
      zones: isEs
        ? FIXTURE_ES_ZONES
        : isNvda
          ? FIXTURE_NVDA_ZONES
          : isAapl
            ? FIXTURE_AAPL_ZONES
            : FIXTURE_ZONE_MODEL,
      classifiedPct: FIXTURE_CLASSIFIED_PCT,
      headline: isAapl ? "" : FIXTURE_HEADLINE,
      sessionLabel: "Cash session",
      skipNetwork: true,
    },
  });

  const { setSymbol, setTokens, setTraderTokens } = useTerminalStore.getState();
  useOptionsSettingsStore.getState().setStrikeCount(20);
  setSymbol(isEs ? "/ES" : isNvda ? "NVDA" : isAapl ? "AAPL" : "SPX");
  setTokens("at-fixture-dev-token", "");
  setTraderTokens("at-fixture-dev-token", "");

  const spot = isEs ? FIXTURE_ES_SPOT : isNvda ? FIXTURE_NVDA_SPOT : isAapl ? FIXTURE_AAPL_SPOT : FIXTURE_SPX_SPOT;
  const sym = isEs ? "/ES" : isNvda ? "NVDA" : isAapl ? "AAPL" : "SPX";
  const close =
    headerDownScene && !isNvda && !isAapl && !isEs
      ? spot / (1 - 0.008)
      : isNvda
        ? FIXTURE_NVDA_OPEN
        : isAapl
          ? spot - 1.2
          : isEs
            ? spot - 8.5
            : spot - 12;
  const change = spot - close;
  const changePct = close !== 0 ? (change / close) * 100 : 0;
  const description = isNvda
    ? "NVIDIA CORP"
    : isAapl
      ? "APPLE INC"
      : isEs
        ? "E-MINI S&P 500"
        : "S&P 500 INDEX";
  const tick = isAapl ? 0.05 : isNvda ? 0.02 : 0.25;
  if (headerDownScene && !isNvda && !isAapl && !isEs) {
    window.setInterval(() => {
      useTerminalStore.setState((s) => {
        const row = s.streamPrices[sym];
        if (!row?.last) return s;
        const next = row.last + 0.25;
        return {
          streamPrices: {
            ...s.streamPrices,
            [sym]: { ...row, last: next, regularLast: next, ask: next + 0.25, bid: next - 0.25, ts: Date.now() },
          },
        };
      });
    }, 400);
  }

  useTerminalStore.setState((s) => ({
    streamPrices: {
      ...s.streamPrices,
      $VIX: {
        symbol: "$VIX",
        description: "CBOE VOLATILITY INDEX",
        last: 18.42,
        regularLast: 18.42,
        extendedLast: null,
        bid: 18.4,
        ask: 18.44,
        bidSize: 1,
        askSize: 1,
        change: -0.35,
        changePct: -1.86,
        volume: 0,
        high: 19.1,
        low: 18.2,
        close: 18.77,
        ts: Date.now(),
      },
      [sym]: {
        symbol: sym,
        description,
        last: spot,
        regularLast: spot,
        extendedLast: null,
        bid: spot - tick,
        ask: spot + tick,
        bidSize: isNvda ? 24 : 1,
        askSize: isNvda ? 18 : 1,
        change,
        changePct,
        volume: isNvda ? 42_800_000 : 1_240_000,
        high: headerDownScene && !isNvda && !isAapl && !isEs ? 7368 : spot + (isNvda ? 2.8 : isAapl ? 3 : 18),
        low: headerDownScene && !isNvda && !isAapl && !isEs ? 7288 : spot - (isNvda ? 3.2 : isAapl ? 4 : 22),
        close,
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
    ...loadActiveTraderPrefs(isAapl ? "equity" : "index"),
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
  saveActiveTraderPrefs(isAapl ? "equity" : "index", atPrefs);

  resetFlowAndTicks(fixtureKind);
}

export function resetFlowAndTicks(kind = "spx"): void {
  const mergeTick = useOptionsStreamStore.getState().mergeTick;
  if (kind === "aapl") {
    for (const tick of buildAaplFixtureTicks()) mergeTick(tick);
    return;
  }
  if (kind === "nvda") {
    for (const tick of buildNvdaFixtureTicks()) mergeTick(tick);
    return;
  }
  if (kind === "es") {
    for (const t of buildSpxFixtureTicks()) mergeTick(t);
    return;
  }
  for (const t of buildSpxFixtureTicks()) mergeTick(t);
  seedSpxFixtureFlow();
}