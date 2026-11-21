import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId, type ComponentProps } from "react";
import { LazyRouteView } from "@/components/LazyRouteView";
import { setLazyRecoveryTradeLatch } from "@/lib/lazyChunkRecovery";
import { Sidebar, type SidebarHandle } from "@/components/Sidebar";
import { MetricsBar } from "@/components/MetricsBar";
import { AtSymbolHeader } from "@/components/active-trader/AtSymbolHeader";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import { atGlanceTopEnabled } from "@/lib/active-trader/atGlanceFeature";
import { TradingChart } from "@/components/TradingChart";
import { MacroBar } from "@/components/MacroBar";
import { MarketDataTabs, type MarketDataTab } from "@/components/MarketDataTabs";
import { useTerminalStore, loadWatchlistsFromServer } from "@/lib/store";
import { useUICustomizationStore } from "@/lib/ui-customization-store";
import { useUIThemeSync } from "@/hooks/useUIThemeSync";
import { useGetPriceHistory } from "@workspace/api-client-react";
import type { PriceHistoryResponse } from "@workspace/api-client-react";
import { ChartControls, chartParamsFromStore, isIntradayInterval } from "@/components/ChartControls";
import { useAutoRefreshToken } from "@/hooks/useAutoRefreshToken";
import { useMarketStream } from "@/hooks/useMarketStream";
import { useSchwabSessionReconciliation } from "@/hooks/useSchwabSessionReconciliation";
import { useSchwabAccountsBootstrap } from "@/hooks/useSchwabAccountsBootstrap";
import { SchwabAccountPickerSheet } from "@/components/SchwabAccountPickerSheet";
import { useViewportShell } from "@/hooks/useViewportShell";

import type { OrderLeg } from "@/components/OrderTicket";
import type { StrategistValidationMeta } from "@/lib/store";
import type { StrategistSendToOrderPayload } from "@/components/StrategistV2Card";
import type { StrategyLeg } from "@/components/StrategyBuilder";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  OptionsChainOrderSheet,
  legsFromChainSelection,
  type EquityTicketDraft,
  type StrategistSheetDispatchResult,
} from "@/components/OptionsChainOrderSheet";
import { AtOrderDefaultsSheet } from "@/components/active-trader/AtOrderDefaultsSheet";
import {
  loadActiveTraderPrefs,
  saveActiveTraderPrefs,
  type ActiveTraderTemplatePrefs,
} from "@/lib/active-trader/activeTraderPrefs";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { parseSchwabOptionSymbol } from "@workspace/order-ticket-math";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useChainDraftSessionStore } from "@/lib/orders/chainDraftSessionStore";
import { noteAtEntry } from "@/lib/active-trader/atInstrumentMode";
import { MarketSessionClock } from "@/components/MarketSessionClock";
import { BottomNav } from "@/components/BottomNav";
import type { PortfolioSubTab } from "@/components/PortfolioView";
import { MobileEdgeSearch } from "@/components/MobileEdgeSearch";
import PushNotificationBanner from "@/components/PushNotificationBanner";
import StrategistStatusBar from "@/components/StrategistStatusBar";
import { AiSubTabs, type AiSubTab } from "@/components/ai-tab/AiSubTabs";
import type { MarketPulseDashboardHandle } from "@/components/market-pulse/MarketPulseDashboard";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { WatchlistView } from "@/components/WatchlistView";
import { peekPendingStrategistPushJobId, setPendingStrategistPushJobId } from "@/lib/strategistPushNav";
import { readStashedStrategistPushJob } from "@/lib/strategistPushCache";
import { openStrategistJobFromNotification, resumeAllRunningPollers } from "@/lib/strategistPoller";
import { loadDashboardLayoutFromServer } from "@/lib/dashboardStore";
import {
  Menu,
  RefreshCw,
  Clock,
  Search,
} from "lucide-react";
import { useTerminalLayout } from "@/hooks/useTerminalLayout";
import { TERMINAL_MOBILE_SHELL_MAX_PX } from "@/lib/layout/breakpoints";
import { useShallow } from "zustand/react/shallow";
import { getAtFixtureOverride } from "@/lib/active-trader/atFixtureBridge";
import { getChainOrderFixtureOverride } from "@/lib/dev-only/chainOrderFixtureBridge";
import { getFuturesEsFixtureOverride } from "@/lib/dev-only/futuresEsFixtureBridge";
import { FuturesTradeBlockedNotice } from "@/components/FuturesTradeBlockedNotice";
import { isFuturesDisplaySymbol } from "@/lib/futuresSchwabUi";

// ---------------------------------------------------------------------------
// Code splitting. The terminal shipped as a single ~2.6 MB chunk; the views
// below are not part of the first paint (bottom tabs, modals, the dashboard
// grid, company research, chat) and load on demand. Each wrapper keeps the
// original component name so the render sites further down are unchanged.
// Always-mounted overlays use a null fallback so nothing flashes at startup.
// ---------------------------------------------------------------------------
function LazyViewFallback() {
  return <div className="flex-1 min-h-[160px] animate-pulse rounded-md bg-card/40" aria-busy="true" />;
}
function LazyStripFallback() {
  return <div className="h-9 animate-pulse bg-card/40" aria-busy="true" />;
}

function OptionsTab(props: ComponentProps<typeof import("@/components/OptionsTab").OptionsTab>) {
  return (
    <LazyRouteView
      viewName="Options"
      freshImportOnRetry
      fallback={<LazyViewFallback />}
      loader={() => import("@/components/OptionsTab").then((m) => ({ default: m.OptionsTab }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function AiIntelligenceTab(props: ComponentProps<typeof import("@/components/AiIntelligenceTab").AiIntelligenceTab>) {
  return (
    <LazyRouteView
      viewName="AI"
      fallback={<LazyViewFallback />}
      loader={() => import("@/components/AiIntelligenceTab").then((m) => ({ default: m.AiIntelligenceTab }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function NewsTab() {
  return (
    <LazyRouteView
      viewName="News"
      freshImportOnRetry
      fallback={<LazyViewFallback />}
      loader={() => import("@/components/NewsTab").then((m) => ({ default: m.NewsTab }))}
      render={(C, key) => <C key={key} />}
    />
  );
}
function PortfolioView(props: ComponentProps<typeof import("@/components/PortfolioView").PortfolioView>) {
  return (
    <LazyRouteView
      viewName="Portfolio"
      freshImportOnRetry
      fallback={<LazyViewFallback />}
      loader={() => import("@/components/PortfolioView").then((m) => ({ default: m.PortfolioView }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function InsightsView(props: ComponentProps<typeof import("@/components/InsightsView").InsightsView>) {
  return (
    <LazyRouteView
      viewName="Insights"
      freshImportOnRetry
      fallback={<LazyViewFallback />}
      loader={() => import("@/components/InsightsView").then((m) => ({ default: m.InsightsView }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function DesktopGlance() {
  return (
    <LazyRouteView
      viewName="SPX Glance"
      fallback={<div className="absolute inset-0" style={{ background: "#0b0d11" }} />}
      loader={() => import("@/glance/GlancePage")}
      render={(C, key) => <C key={key} embedded />}
    />
  );
}
function CompanySwipablePages(props: ComponentProps<typeof import("@/components/CompanySwipablePages").CompanySwipablePages>) {
  return (
    <LazyRouteView
      viewName="Company"
      fallback={<LazyViewFallback />}
      loader={() => import("@/components/CompanySwipablePages").then((m) => ({ default: m.CompanySwipablePages }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function MarketNewsChatPanel(props: ComponentProps<typeof import("@/components/MarketNewsChatPanel").MarketNewsChatPanel>) {
  return (
    <LazyRouteView
      viewName="Chat"
      fallback={<LazyViewFallback />}
      loader={() => import("@/components/MarketNewsChatPanel").then((m) => ({ default: m.MarketNewsChatPanel }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function CompanySectionTabBar(props: ComponentProps<typeof import("@/components/CompanyResearchHub").CompanySectionTabBar>) {
  return (
    <LazyRouteView
      viewName="Company tabs"
      fallback={<LazyStripFallback />}
      loader={() => import("@/components/CompanyResearchHub").then((m) => ({ default: m.CompanySectionTabBar }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function CompanyTearSheet(props: ComponentProps<typeof import("@/components/CompanyTearSheet").CompanyTearSheet>) {
  if (!props.isOpen) return null;
  return (
    <LazyRouteView
      viewName="Company profile"
      fallback={null}
      loader={() => import("@/components/CompanyTearSheet").then((m) => ({ default: m.CompanyTearSheet }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}
function InAppBrowser() {
  return (
    <LazyRouteView
      viewName="Browser"
      fallback={null}
      loader={() => import("@/components/InAppBrowser").then((m) => ({ default: m.InAppBrowser }))}
      render={(C, key) => <C key={key} />}
    />
  );
}
function SearchOverlay(props: ComponentProps<typeof import("@/components/SearchOverlay").SearchOverlay>) {
  return (
    <LazyRouteView
      viewName="Search"
      fallback={null}
      loader={() => import("@/components/SearchOverlay").then((m) => ({ default: m.SearchOverlay }))}
      render={(C, key) => <C key={key} {...props} />}
    />
  );
}


type BottomTab = "scanner" | "markets" | "ai" | "portfolio" | "watchlist" | "dashboard" | "insights";
type ContextTab = MarketDataTab;

function normalizeOptionDirection(
  raw: string | undefined,
  fallbackSide: "BUY" | "SELL",
  isClose?: boolean,
): StrategyLeg["direction"] {
  if (
    raw === "BUY_TO_OPEN" ||
    raw === "SELL_TO_OPEN" ||
    raw === "BUY_TO_CLOSE" ||
    raw === "SELL_TO_CLOSE"
  ) {
    return raw;
  }
  if (isClose) {
    return fallbackSide === "BUY" ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE";
  }
  return fallbackSide === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_OPEN";
}

function lookupAccountEquityCloseQty(sym: string): number {
  const { accounts, tradingAccountHash } = useSchwabAccountStore.getState();
  const hash = tradingAccountHash();
  const acct = (hash ? accounts.find((a) => a.hashValue === hash) : undefined) ?? accounts[0];
  const target = sym.replace(/^\$/, "").trim().toUpperCase();
  for (const pos of acct?.positions ?? []) {
    if (pos.assetType !== "EQUITY" && pos.assetType !== "COLLECTIVE_INVESTMENT") continue;
    if (pos.symbol.trim().toUpperCase() !== target) continue;
    const net = Math.abs((pos.longQuantity ?? 0) - (pos.shortQuantity ?? 0));
    const raw = net > 0 ? net : Math.max(pos.longQuantity ?? 0, pos.shortQuantity ?? 0);
    if (raw > 0) return Math.max(1, Math.round(raw));
  }
  return 1;
}

function lookupAccountOptionClosePosition(optionSymbol: string): { quantity: number; mark?: number } {
  const { accounts, tradingAccountHash } = useSchwabAccountStore.getState();
  const hash = tradingAccountHash();
  const acct = (hash ? accounts.find((a) => a.hashValue === hash) : undefined) ?? accounts[0];
  const norm = optionSymbol.replace(/\s+/g, " ").trim();
  for (const pos of acct?.positions ?? []) {
    if (pos.assetType !== "OPTION") continue;
    if (pos.symbol.replace(/\s+/g, " ").trim() !== norm) continue;
    const net = Math.abs((pos.longQuantity ?? 0) - (pos.shortQuantity ?? 0));
    const qty = Math.max(1, Math.round(net > 0 ? net : Math.max(pos.longQuantity ?? 0, pos.shortQuantity ?? 0, 1)));
    const mark =
      pos.marketValue && qty > 0 && Number.isFinite(pos.marketValue)
        ? Math.abs(pos.marketValue) / (qty * 100)
        : undefined;
    return { quantity: qty, mark };
  }
  return { quantity: 1 };
}

function mapOrderLegsToStrategyLegs(
  underlying: string,
  legs: OrderLeg[],
  isClose?: boolean,
): StrategyLeg[] {
  return legs.map((l, i) => {
    const parsed = l.schwabSymbol ? parseSchwabOptionSymbol(l.schwabSymbol) : null;
    const rawType = (l.optionType || parsed?.optionType || "CALL").toUpperCase();
    const optionType: "CALL" | "PUT" = rawType.startsWith("P") ? "PUT" : "CALL";
    const strike = l.strike || parsed?.strike || 0;
    const expiration = l.expiration || parsed?.expiration || "";
    const schwabSymbol =
      l.schwabSymbol ||
      (expiration && strike > 0
        ? buildSchwabOptionKey(underlying, expiration, strike, optionType === "CALL" ? "C" : "P")
        : "");
    const fallbackSide: "BUY" | "SELL" = l.instruction?.toUpperCase().startsWith("SELL")
      ? "SELL"
      : "BUY";
    return {
      id: `unified-${Date.now()}-${i}-${schwabSymbol || strike}`,
      optionType,
      direction: normalizeOptionDirection(l.instruction, fallbackSide, isClose),
      strike,
      expiration,
      quantity: Math.max(1, Math.round(l.quantity || 1)),
      bid: l.bid,
      ask: l.ask,
      delta: l.delta,
      schwabSymbol,
    };
  });
}

const DESKTOP_CONTEXT_TABS: { id: MarketDataTab; label: string }[] = [
  { id: "news", label: "News" },
  { id: "options", label: "Options" },
  { id: "company", label: "Company" },
  { id: "newsChat", label: "Chat" },
];

/** Keep the header light green through brief stream flaps. Red/amber only after 8s offline. */
function useDebouncedStreamLight(status: "offline" | "connecting" | "live") {
  const [shown, setShown] = useState(status);
  useEffect(() => {
    if (status === "live") {
      setShown("live");
      return;
    }
    const t = window.setTimeout(() => setShown(status), 8_000);
    return () => window.clearTimeout(t);
  }, [status]);
  return shown;
}

function DesktopContextTabs({ activeTab, setActiveTab }: { activeTab: MarketDataTab; setActiveTab: (t: MarketDataTab) => void }) {
  return (
    <div className="flex items-stretch border-b border-zinc-800/60 overflow-x-auto bg-card">
      {DESKTOP_CONTEXT_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 min-w-[76px] py-2.5 font-mono text-xs font-bold tracking-wider transition-colors border-b-2"
            style={{
              color: isActive ? "#f4f4f5" : "#71717a",
              borderColor: isActive ? "#71717a" : "transparent",
              background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

const DESKTOP_NAV_TABS: { id: BottomTab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "markets", label: "Markets" },
  { id: "portfolio", label: "Portfolio" },
  { id: "ai", label: "AI" },
  { id: "insights", label: "Insights" },
];

const isMacLike = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Desktop-only primary navigation: real tabs in the header plus a visible
 * search field, replacing the phone-style bottom bar which was nearly
 * invisible on monitors (36px strip, 10px type).
 */
function DesktopTopNav({
  activeTab,
  onTabChange,
  onOpenSearch,
  strategistRunningCount,
  strategistUnviewedCount,
  compact,
}: {
  activeTab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  onOpenSearch: () => void;
  strategistRunningCount: number;
  strategistUnviewedCount: number;
  compact?: boolean;
}) {
  return (
    <div className="desktop-top-nav flex flex-1 items-center gap-1 min-w-0 overflow-hidden">
      <nav
        className="flex flex-1 min-w-0 items-center gap-0.5 ml-3 lg:ml-6 overflow-x-auto overscroll-x-contain"
        style={{ scrollbarWidth: "thin" }}
        aria-label="Primary"
      >
        {DESKTOP_NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const showAiDot = tab.id === "ai" && (strategistRunningCount > 0 || strategistUnviewedCount > 0);
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative shrink-0 rounded-md font-mono text-xs font-bold tracking-wider transition-colors ${
                compact ? "px-2 py-1.5" : "px-3 lg:px-4 py-1.5"
              }`}
              style={{
                color: isActive ? "#FFB800" : "#a1a1aa",
                background: isActive ? "rgba(255,184,0,0.08)" : "transparent",
              }}
            >
              {tab.label.toUpperCase()}
              {showAiDot && (
                <span
                  aria-label={strategistRunningCount > 0 ? "Strategist running" : "New strategist result"}
                  className={`absolute top-1 right-1.5 inline-block w-1.5 h-1.5 rounded-full ${strategistRunningCount > 0 ? "animate-pulse" : ""}`}
                  style={{
                    background: strategistRunningCount > 0 ? "#FFB800" : "#00d166",
                    boxShadow: strategistRunningCount > 0 ? "0 0 6px #FFB800" : "0 0 6px #00d166",
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>
      <button
        onClick={onOpenSearch}
        className="ml-1 lg:ml-auto mr-2 lg:mr-4 flex min-w-0 max-w-[7.5rem] sm:max-w-[9rem] lg:max-w-[11rem] xl:max-w-[18rem] flex-1 lg:flex-none lg:w-48 xl:w-72 items-center gap-2 rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 lg:px-3 py-1.5 text-left transition-colors hover:border-zinc-500 shrink"
        aria-label="Search symbols"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="flex-1 min-w-0 truncate font-mono text-xs text-zinc-500">Search symbols…</span>
        <kbd className="hidden xl:inline shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          {isMacLike ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
    </div>
  );
}

function PulseHeader({ pulseData, onRefresh }: { pulseData: any; onRefresh: () => void }) {
  const pulseAge = pulseData?.generatedAt ? Math.floor((Date.now() - pulseData.generatedAt) / 60_000) : null;
  const ageLabel = pulseAge === null ? null : pulseAge < 1 ? "Just now" : pulseAge < 60 ? `${pulseAge}m ago` : `${Math.floor(pulseAge / 60)}h ${pulseAge % 60}m ago`;

  return (
    <div className="flex items-center justify-between px-3 sm:px-4 lg:px-5 py-2 border-b border-card-border/30">
      <div className="flex items-center gap-2.5">
      </div>
      {pulseData && (
        <div className="flex items-center gap-3 mr-3">
          {ageLabel && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-[#8a8a8e]" />
              <span className="font-mono text-[11px] text-[#8a8a8e] tracking-wider">{ageLabel}</span>
            </div>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-[1px]"
            style={{
              background: "linear-gradient(180deg, #2A2A2C 0%, #1E1E20 100%)",
              color: "#a1a1aa",
              border: "1px solid #3a3a3c",
              borderBottom: "2px solid #1a1a1c",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function TerminalPage() {
  const { symbol, accessToken, traderAccessToken, chartPeriod, chartInterval, streamStatus } = useTerminalStore(useShallow((s) => ({ symbol: s.symbol, accessToken: s.accessToken, traderAccessToken: s.traderAccessToken, chartPeriod: s.chartPeriod, chartInterval: s.chartInterval, streamStatus: s.streamStatus })));
  const streamLight = useDebouncedStreamLight(streamStatus);
  const schwabLinked = !!(accessToken || traderAccessToken);
  useSchwabAccountsBootstrap(schwabLinked);
  const strategistJobsForBadge = useTerminalStore((s) => s.strategistJobs);
  const strategistRunningCount = Object.values(strategistJobsForBadge).filter(j => j.status === 'running').length;
  const strategistUnviewedCount = Object.values(strategistJobsForBadge).filter(j => (j.status === 'done' || j.status === 'error') && !j.viewed).length;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [historyTimedOut, setHistoryTimedOut] = useState(false);
  const [isScrolledRaw, setIsScrolledRaw] = useState(false);
  const headerMode = useUICustomizationStore((s) => s.headerMode);
  const showMiniCards = useUICustomizationStore((s) => s.showMiniCards);
  const showMobileEdgeSearch = useUICustomizationStore((s) => s.showMobileEdgeSearch);
  const isCompact = headerMode === "collapsed";
  const isScrolled = isCompact ? true : headerMode === "expanded" ? false : isScrolledRaw;
  const [portfolioSubTab, setPortfolioSubTab] = useState<PortfolioSubTab>("positions");
  const [activeBottom, setActiveBottom] = useState<BottomTab>(() => {
    const fx = import.meta.env.DEV ? getAtFixtureOverride() : null;
    if (fx?.enabled) return "markets";
    // Desktop lands on the customizable dashboard; phone opens Insights.
    const fallback: BottomTab =
      typeof window !== "undefined" &&
      window.matchMedia(`(min-width: ${TERMINAL_MOBILE_SHELL_MAX_PX + 1}px)`).matches
        ? "dashboard"
        : "insights";
    try {
      const saved = sessionStorage.getItem("alpha_session_tab") as BottomTab | null;
      const valid: BottomTab[] = ["portfolio", "markets", "ai", "watchlist", "dashboard", "insights"];
      return saved && valid.includes(saved) ? saved : fallback;
    } catch { return fallback; }
  });
  const [contextTab, setContextTab] = useState<ContextTab>(() => {
    if (import.meta.env.DEV) {
      if (getAtFixtureOverride()?.enabled) return "options";
      if (getChainOrderFixtureOverride()) return "options";
      if (getFuturesEsFixtureOverride()?.enabled) return "options";
    }
    return "news";
  });
  const atSubViewActive = useAtChromeStore((s) => s.subViewIsAt);
  const atOptionsChrome = activeBottom === "markets" && contextTab === "options" && atSubViewActive;
  const atGlanceChrome = atOptionsChrome && atGlanceTopEnabled();

  const [aiSubTab, setAiSubTab] = useState<AiSubTab>(() => {
    try {
      const savedRaw = sessionStorage.getItem("alpha_session_ai_tab");
      const saved = (savedRaw === "scanner" ? "movers" : savedRaw) as AiSubTab | null;
      const valid: AiSubTab[] = ["pulse", "strategist", "movers", "catalysts"];
      return saved && valid.includes(saved) ? saved : "pulse";
    } catch { return "pulse"; }
  });
  const [strategistDeepLinkJobId, setStrategistDeepLinkJobId] = useState<string | null>(null);
  const [futuresTradeNoticeOpen, setFuturesTradeNoticeOpen] = useState(false);
  const terminalSymbol = useTerminalStore((s) => s.symbol);
  const { subscribeOptionSymbols, subscribeEquitySymbols, releaseOptionHold } = useMarketStream();

  const [unifiedLegs, setUnifiedLegs] = useState<StrategyLeg[]>([]);
  const [unifiedEquityDraft, setUnifiedEquityDraft] = useState<EquityTicketDraft | null>(null);
  const [unifiedInitialLimit, setUnifiedInitialLimit] = useState<number | null>(null);
  const [unifiedSheetCollapsed, setUnifiedSheetCollapsed] = useState(false);
  const [unifiedSheetPeek, setUnifiedSheetPeek] = useState(true);
  const [unifiedDefaultsOpen, setUnifiedDefaultsOpen] = useState(false);
  const [unifiedDefaultsWindowSec, setUnifiedDefaultsWindowSec] = useState<30 | 60 | 300>(30);
  const unifiedOrderSymbolClass =
    terminalSymbol.toUpperCase().includes("SPX") || terminalSymbol.startsWith("$")
      ? ("index" as const)
      : ("equity" as const);
  const [unifiedOrderPrefs, setUnifiedOrderPrefs] = useState<ActiveTraderTemplatePrefs>(() =>
    loadActiveTraderPrefs(unifiedOrderSymbolClass),
  );
  useEffect(() => {
    setUnifiedOrderPrefs(loadActiveTraderPrefs(unifiedOrderSymbolClass));
  }, [unifiedOrderSymbolClass]);

  const unifiedStrategistRef = useRef<
    ((opts: { thesis?: string }) => Promise<StrategistSheetDispatchResult>) | null
  >(null);
  const [unifiedStrategistBusy, setUnifiedStrategistBusy] = useState(false);
  const [unifiedStrategistError, setUnifiedStrategistError] = useState<string | null>(null);

  const hasUnifiedDraft = unifiedLegs.length > 0 || unifiedEquityDraft != null;

  useEffect(() => {
    setLazyRecoveryTradeLatch(hasUnifiedDraft);
    return () => setLazyRecoveryTradeLatch(false);
  }, [hasUnifiedDraft]);

  const chainDraftCount = useChainDraftSessionStore((s) => s.selectedLegs.length);
  const prevChainDraftCountRef = useRef(chainDraftCount);
  useEffect(() => {
    if (chainDraftCount > 0 && prevChainDraftCountRef.current === 0 && hasUnifiedDraft) {
      setUnifiedLegs([]);
      setUnifiedEquityDraft(null);
      setUnifiedInitialLimit(null);
    }
    prevChainDraftCountRef.current = chainDraftCount;
  }, [chainDraftCount, hasUnifiedDraft]);

  useEffect(() => {
    if (unifiedEquityDraft?.symbol) {
      subscribeEquitySymbols([unifiedEquityDraft.symbol.replace(/^\$/, "").trim().toUpperCase()]);
    }
  }, [unifiedEquityDraft?.symbol, subscribeEquitySymbols]);

  useEffect(() => {
    const occKeys = Array.from(
      new Set(
        unifiedLegs
          .map((l) => l.schwabSymbol)
          .filter((k): k is string => typeof k === "string" && k.trim().length > 0),
      ),
    );
    if (occKeys.length === 0) {
      void releaseOptionHold?.("unified-order-sheet");
      return;
    }
    void subscribeOptionSymbols(occKeys, {
      purpose: "order-sheet",
      viewId: "unified-order-sheet",
      holderId: "unified-order-sheet",
    });
    return () => {
      void releaseOptionHold?.("unified-order-sheet");
    };
  }, [unifiedLegs, subscribeOptionSymbols, releaseOptionHold]);

  const clearUnifiedDraft = useCallback(() => {
    setUnifiedLegs([]);
    setUnifiedEquityDraft(null);
    setUnifiedInitialLimit(null);
    setUnifiedStrategistError(null);
  }, []);

  const navigateToStrategist = useCallback((ticker?: string) => {
    if (ticker) useTerminalStore.getState().setSymbol(ticker);
    setActiveBottom("ai");
    setAiSubTab("strategist");
  }, []);

  const openOrder = useCallback((side: "BUY" | "SELL") => {
    const sym = useTerminalStore.getState().symbol;
    if (isFuturesDisplaySymbol(sym)) {
      setFuturesTradeNoticeOpen(true);
      return;
    }
    useChainDraftSessionStore.getState().clear();
    setUnifiedLegs([]);
    setUnifiedInitialLimit(null);
    setUnifiedSheetCollapsed(false);
    setUnifiedSheetPeek(true);
    setUnifiedEquityDraft({ symbol: sym, side, quantity: 1 });
  }, []);

  const reopenValidatedOrder = useCallback((meta: StrategistValidationMeta) => {
    const t = meta.ticket;
    if (isFuturesDisplaySymbol(t.ticker)) {
      useTerminalStore.getState().setSymbol(t.ticker);
      setFuturesTradeNoticeOpen(true);
      return;
    }
    useTerminalStore.getState().setSymbol(t.ticker);
    useChainDraftSessionStore.getState().clear();
    setUnifiedSheetCollapsed(false);
    setUnifiedSheetPeek(true);
    const isClose = meta.mode === "closing";

    if (t.isMultiLeg && t.legs && t.legs.length >= 2) {
      const orderLegs: OrderLeg[] = t.legs.map((l) => ({
        schwabSymbol: "",
        instruction: l.instruction,
        quantity: l.quantity ?? Math.max(1, t.quantity || 1),
        optionType: l.optionType ?? "CALL",
        strike: l.strike ?? 0,
        expiration: l.expiration ?? "",
        bid: l.bid ?? undefined,
        ask: l.ask ?? undefined,
        delta: l.delta ?? undefined,
      }));
      setUnifiedEquityDraft(null);
      setUnifiedLegs(mapOrderLegsToStrategyLegs(t.ticker, orderLegs, isClose));
      setUnifiedInitialLimit(t.netPrice ?? t.limitPrice ?? null);
    } else if (t.isOption && (t.optionSymbol || (t.legs && t.legs.length === 1))) {
      const l0 = t.legs?.[0];
      const singleOrderLeg: OrderLeg = {
        schwabSymbol: t.optionSymbol ?? "",
        instruction: t.optionInstruction ?? l0?.instruction ?? (t.side === "SELL" ? "SELL_TO_OPEN" : "BUY_TO_OPEN"),
        quantity: l0?.quantity ?? Math.max(1, t.quantity || 1),
        optionType: l0?.optionType ?? "",
        strike: l0?.strike ?? 0,
        expiration: l0?.expiration ?? "",
        bid: l0?.bid ?? undefined,
        ask: l0?.ask ?? undefined,
        delta: l0?.delta ?? undefined,
      };
      setUnifiedEquityDraft(null);
      setUnifiedLegs(mapOrderLegsToStrategyLegs(t.ticker, [singleOrderLeg], isClose));
      setUnifiedInitialLimit(t.limitPrice ?? t.netPrice ?? null);
    } else {
      const side: "BUY" | "SELL" = t.side ?? "BUY";
      setUnifiedLegs([]);
      setUnifiedInitialLimit(null);
      setUnifiedEquityDraft({
        symbol: t.ticker,
        side,
        quantity: Math.max(1, Math.round(t.quantity || 1)),
        isClose,
        initialLimitPrice: t.limitPrice ?? null,
      });
    }
  }, []);

  const openOrderForSymbol = useCallback((
    sym: string,
    side: "BUY" | "SELL",
    optionSymbol?: string,
    optionInstruction?: string,
    strategyLegs?: OrderLeg[],
    strategyNetPrice?: number,
    _strategyIsCredit?: boolean,
    isClose?: boolean,
  ) => {
    if (isFuturesDisplaySymbol(sym)) {
      useTerminalStore.getState().setSymbol(sym);
      setFuturesTradeNoticeOpen(true);
      return;
    }
    useTerminalStore.getState().setSymbol(sym);
    useChainDraftSessionStore.getState().clear();
    setUnifiedSheetCollapsed(false);
    setUnifiedSheetPeek(true);

    if (strategyLegs && strategyLegs.length > 0) {
      setUnifiedEquityDraft(null);
      setUnifiedLegs(mapOrderLegsToStrategyLegs(sym, strategyLegs, isClose));
      setUnifiedInitialLimit(strategyNetPrice ?? null);
      return;
    }

    if (optionSymbol) {
      const held = isClose ? lookupAccountOptionClosePosition(optionSymbol) : { quantity: 1 };
      const singleLeg: OrderLeg = {
        schwabSymbol: optionSymbol,
        instruction: optionInstruction ?? (isClose ? (side === "BUY" ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE") : side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_OPEN"),
        quantity: held.quantity,
        optionType: "",
        strike: 0,
        expiration: "",
        bid: held.mark,
        ask: held.mark,
      };
      setUnifiedEquityDraft(null);
      setUnifiedLegs(mapOrderLegsToStrategyLegs(sym, [singleLeg], isClose));
      setUnifiedInitialLimit(strategyNetPrice ?? held.mark ?? null);
      return;
    }

    const qty = isClose ? lookupAccountEquityCloseQty(sym) : 1;
    setUnifiedLegs([]);
    setUnifiedInitialLimit(null);
    setUnifiedEquityDraft({
      symbol: sym,
      side,
      quantity: qty,
      isClose: Boolean(isClose),
    });
  }, []);

  const handleOptionTradeSingle = useCallback((contract: OptionsContract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
    const sym = useTerminalStore.getState().symbol;
    if (isFuturesDisplaySymbol(sym)) {
      setFuturesTradeNoticeOpen(true);
      return;
    }
    useChainDraftSessionStore.getState().clear();
    const { accounts, tradingAccountHash } = useSchwabAccountStore.getState();
    const legs = legsFromChainSelection(
      [
        {
          key: `${contract.expiration}_${contract.strike}_${type}`,
          contract,
          type,
          side: side === "BUY" ? "ask" : "bid",
        },
      ],
      sym,
      accounts,
      buildSchwabOptionKey,
      tradingAccountHash(),
    );
    setUnifiedEquityDraft(null);
    setUnifiedInitialLimit(null);
    setUnifiedSheetCollapsed(false);
    setUnifiedSheetPeek(true);
    setUnifiedLegs(legs);
  }, []);

  const handleActiveTraderReview = useCallback((contract: OptionsContract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
    const sym = useTerminalStore.getState().symbol;
    const atFixture = getAtFixtureOverride();
    if (
      isFuturesDisplaySymbol(sym) &&
      !(import.meta.env.DEV && atFixture?.enabled)
    ) {
      setFuturesTradeNoticeOpen(true);
      return;
    }
    const symClass = sym.toUpperCase().includes("SPX") || sym.startsWith("$") ? "index" : "equity";
    setUnifiedOrderPrefs(loadActiveTraderPrefs(symClass));
    useChainDraftSessionStore.getState().clear();
    const { accounts, tradingAccountHash } = useSchwabAccountStore.getState();
    const legs = legsFromChainSelection(
      [
        {
          key: `${contract.expiration}_${contract.strike}_${type}`,
          contract,
          type,
          side: side === "BUY" ? "ask" : "bid",
        },
      ],
      sym,
      accounts,
      buildSchwabOptionKey,
      tradingAccountHash(),
    );
    setUnifiedEquityDraft(null);
    setUnifiedInitialLimit(null);
    setUnifiedSheetCollapsed(false);
    setUnifiedSheetPeek(true);
    setUnifiedLegs(legs);
  }, []);

  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    const atFx = getAtFixtureOverride();
    const chainFx = getChainOrderFixtureOverride();
    const futuresFx = getFuturesEsFixtureOverride();
    if (atFx?.enabled || chainFx || futuresFx?.enabled) {
      setActiveBottom("markets");
      setContextTab("options");
    }
    if (futuresFx?.openTradeNoticeOnMount) {
      setFuturesTradeNoticeOpen(true);
    }
  }, []);

  const handleSendToOrder = useCallback((trade: {
    ticker: string;
    strategy: string;
    expiration: string;
    legs: Array<{ type: string; action: string; strike: number; bid: number; ask: number; delta: number; schwabSymbol?: string }>;
    pricing: { type: string; executable_amount: number };
    sizing: { recommended_contracts: number };
  }) => {
    if (isFuturesDisplaySymbol(trade.ticker)) {
      useTerminalStore.getState().setSymbol(trade.ticker);
      setFuturesTradeNoticeOpen(true);
      return;
    }
    useTerminalStore.getState().setSymbol(trade.ticker);
    useChainDraftSessionStore.getState().clear();

    const mapped: StrategyLeg[] = trade.legs.map((leg, i) => {
      const optionType = leg.type.toLowerCase() === "call" ? ("CALL" as const) : ("PUT" as const);
      const schwabSymbol =
        leg.schwabSymbol ||
        buildSchwabOptionKey(trade.ticker, trade.expiration, leg.strike, optionType === "CALL" ? "C" : "P");
      return {
        id: `resolved-${Date.now()}-${i}`,
        optionType,
        direction: leg.action.toLowerCase() === "buy" ? ("BUY_TO_OPEN" as const) : ("SELL_TO_OPEN" as const),
        strike: leg.strike,
        expiration: trade.expiration,
        quantity: Math.max(1, trade.sizing.recommended_contracts || 1),
        bid: leg.bid,
        ask: leg.ask,
        delta: leg.delta,
        schwabSymbol,
      };
    });

    setUnifiedEquityDraft(null);
    setUnifiedLegs(mapped);
    setUnifiedInitialLimit(
      Number.isFinite(trade.pricing?.executable_amount) ? trade.pricing.executable_amount : null,
    );
    setUnifiedSheetCollapsed(false);
    setUnifiedSheetPeek(true);
  }, []);

  const handleStrategistSendToOrder = useCallback((payload: StrategistSendToOrderPayload) => {
    if (isFuturesDisplaySymbol(payload.ticker)) {
      useTerminalStore.getState().setSymbol(payload.ticker);
      setFuturesTradeNoticeOpen(true);
      return;
    }
    useTerminalStore.getState().setSymbol(payload.ticker);
    useChainDraftSessionStore.getState().clear();
    const orderLegs: OrderLeg[] = payload.legs.map((leg) => ({
      schwabSymbol: leg.schwabSymbol,
      instruction: leg.instruction,
      quantity: leg.quantity,
      optionType: leg.optionType,
      strike: leg.strike,
      expiration: leg.expiration,
      bid: leg.bid,
      ask: leg.ask,
      delta: leg.delta,
    }));
    setUnifiedEquityDraft(null);
    setUnifiedLegs(mapOrderLegsToStrategyLegs(payload.ticker, orderLegs, false));
    setUnifiedInitialLimit(Number.isFinite(payload.netPrice) ? payload.netPrice : null);
    setUnifiedSheetCollapsed(false);
    setUnifiedSheetPeek(true);
  }, []);

  const handleUnifiedFlipSides = useCallback(() => {
    setUnifiedEquityDraft((prev) =>
      prev
        ? {
            ...prev,
            side: prev.side === "BUY" ? "SELL" : "BUY",
            instruction: undefined,
            initialLimitPrice: null,
          }
        : null,
    );
    setUnifiedLegs((prev) =>
      prev.map((l) => ({
        ...l,
        direction:
          l.direction === "BUY_TO_OPEN"
            ? "SELL_TO_OPEN"
            : l.direction === "SELL_TO_OPEN"
              ? "BUY_TO_OPEN"
              : l.direction === "BUY_TO_CLOSE"
                ? "SELL_TO_CLOSE"
                : "BUY_TO_CLOSE",
      })),
    );
    setUnifiedInitialLimit(null);
  }, []);

  const handleUnifiedLegQtyChange = useCallback((legId: string, qty: number) => {
    setUnifiedLegs((prev) =>
      prev.map((l) => (l.id === legId ? { ...l, quantity: Math.max(1, Math.min(999, qty)) } : l)),
    );
  }, []);

  const handleUnifiedRemoveLeg = useCallback((legId: string) => {
    setUnifiedLegs((prev) => prev.filter((l) => l.id !== legId));
  }, []);

  const unifiedPrimaryInstruction: SchwabInstruction = (() => {
    if (unifiedEquityDraft) {
      if (unifiedEquityDraft.instruction) return unifiedEquityDraft.instruction;
      if (unifiedEquityDraft.isClose) {
        return unifiedEquityDraft.side === "SELL" ? "SELL" : "BUY_TO_COVER";
      }
      return unifiedEquityDraft.side === "BUY" ? "BUY" : "SELL_SHORT";
    }
    return (unifiedLegs[0]?.direction ?? "BUY_TO_OPEN") as SchwabInstruction;
  })();

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyWrapRef = useRef<HTMLDivElement>(null);
  const [stickyH, setStickyH] = useState(0);
  const companyTabsId = useId();
  const [companyPage, setCompanyPage] = useState(0);
  const [companyTearSheetOpen, setCompanyTearSheetOpen] = useState(false);
  const pulseDashRef = useRef<MarketPulseDashboardHandle>(null);
  const sidebarRef = useRef<SidebarHandle>(null);
  useSchwabSessionReconciliation(sidebarRef);

  /**
   * Phone search Enter. Stock screens already follow the symbol, so they stay.
   * Portfolio, watchlist, insights, and the rest open that stock's page.
   */
  const commitMobileTicker = useCallback(() => {
    const page = sidebarRef.current?.getActivePage() ?? null;
    if (page === "Calendar") return;
    if (page != null) {
      sidebarRef.current?.clearActivePage();
      setSidebarOpen(false);
    }
    const onStockScreen =
      activeBottom === "markets" || (activeBottom === "ai" && aiSubTab === "strategist");
    if (onStockScreen) return;
    const chrome = useAtChromeStore.getState();
    chrome.leaveActiveTrader();
    chrome.requestOptionsSubView("chain");
    setActiveBottom("markets");
  }, [activeBottom, aiSubTab]);
  const { pulseData, isLoading: pulseLoading, isStreaming: pulseStreaming } = useMarketPulseStore();
  const { refresh } = useAutoRefreshToken();
  useViewportShell();
  useUIThemeSync();
  const { isWide, isThreePanel, isCompactHeader } = useTerminalLayout();
  const symbolSearchOpen = isWide ? searchOpen : mobileSearchOpen;

  useEffect(() => {
    if (isWide || !showMobileEdgeSearch) setMobileSearchOpen(false);
    if (!isWide) setSearchOpen(false);
  }, [isWide, showMobileEdgeSearch]);
  const marketsMobileShellLock = activeBottom === "markets" && !isWide;
  const mobileTabUsesInnerScroll =
    marketsMobileShellLock ||
    (activeBottom === "portfolio" && !isWide) ||
    (activeBottom === "insights" && !isWide) ||
    (activeBottom === "ai" && !isWide);

  // Load watchlists from server on mount so they're shared across devices.
  useEffect(() => {
    void loadWatchlistsFromServer();
    void loadDashboardLayoutFromServer();
  }, []);

  useEffect(() => {
    if (isWide && activeBottom === "watchlist") {
      setActiveBottom("markets");
    }
    // Dashboard is desktop-only; fall back if the viewport shrinks to phone.
    if (!isWide && activeBottom === "dashboard") {
      setActiveBottom("markets");
    }
  }, [isWide, activeBottom]);

  // Desktop: Cmd/Ctrl+K opens symbol search from anywhere (mirrors the
  // visible shortcut hint in the top-nav search field).
  useEffect(() => {
    if (!isWide) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isWide]);

  useEffect(() => {
    try { sessionStorage.setItem("alpha_session_tab", activeBottom); } catch {}
  }, [activeBottom]);

  useEffect(() => {
    try { sessionStorage.setItem("alpha_session_ai_tab", aiSubTab); } catch {}
  }, [aiSubTab]);

  // Polling lives in `strategistPoller` so it can survive AiIntelligenceTab
  // unmount, but mobile Safari can throttle timer chains while other chrome is
  // foregrounded and `visibilitychange` does not fire for in-app bottom-nav
  // switches. When the user returns to the Strategist screen, reconcile against
  // `/job/:id/final` and force-restart any stalled pollers (toast suppressed —
  // foreground recovery still uses visibility/focus in App).
  useEffect(() => {
    if (activeBottom !== "ai" || aiSubTab !== "strategist") return;
    resumeAllRunningPollers({ toastOnComplete: false });
  }, [activeBottom, aiSubTab]);

  const routeStrategistPushOpen = useCallback((jobId: string, ticker?: string) => {
    setStrategistDeepLinkJobId(jobId);
    setPendingStrategistPushJobId(jobId);
    setActiveBottom("ai");
    setAiSubTab("strategist");
    void openStrategistJobFromNotification(jobId, { ticker }).then((result) => {
      if (result.ok && result.ticker) {
        useTerminalStore.getState().setSymbol(result.ticker);
      }
    });
  }, []);

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const sb = params.get("sb");
      const jid = params.get("strategistJob");
      if (sb === "strategist" && jid && jid.trim().length > 0) {
        const id = jid.trim();
        routeStrategistPushOpen(id);
        const u = new URL(window.location.href);
        u.searchParams.delete("sb");
        u.searchParams.delete("strategistJob");
        const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : "") + u.hash;
        window.history.replaceState({}, "", next);
        return;
      }
      const stashed = await readStashedStrategistPushJob();
      const pending = peekPendingStrategistPushJobId();
      const jobId = stashed?.jobId ?? pending;
      if (jobId) {
        routeStrategistPushOpen(jobId, stashed?.ticker);
      }
    })();
  }, [routeStrategistPushOpen]);

  useEffect(() => {
    const onPushOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ jobId?: string; ticker?: string }>).detail;
      const jobId = typeof detail?.jobId === "string" ? detail.jobId.trim() : "";
      if (!jobId) return;
      routeStrategistPushOpen(jobId, detail.ticker);
    };
    window.addEventListener("strategist-push-open", onPushOpen);
    return () => window.removeEventListener("strategist-push-open", onPushOpen);
  }, [routeStrategistPushOpen]);

  useEffect(() => {
    if (isThreePanel && contextTab === "chart") {
      setContextTab("news");
    }
  }, [isThreePanel, contextTab]);

  useEffect(() => {
    if (activeBottom !== "markets" || contextTab !== "options") {
      useAtChromeStore.getState().leaveActiveTrader();
    }
  }, [activeBottom, contextTab]);

  useEffect(() => {
    setCompanyPage(0);
  }, [symbol]);

  const COLLAPSE_PX = 80;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsScrolledRaw(el.scrollTop > COLLAPSE_PX);
  }, []);

  const resolveMobileInnerScroller = useCallback((): HTMLElement | null => {
    const main = document.querySelector("main.app-content");
    if (!main) return null;
    if (activeBottom === "markets") {
      if (contextTab === "options" && !atSubViewActive) {
        return main.querySelector("[data-options-chain-scroll]");
      }
      if (contextTab === "news" || contextTab === "chart") {
        return main.querySelector(".tab-inner-scroll");
      }
    }
    if (activeBottom === "ai" || activeBottom === "portfolio" || activeBottom === "insights") {
      return main.querySelector(":scope > .tab-inner-scroll");
    }
    return null;
  }, [activeBottom, contextTab, atSubViewActive]);

  useEffect(() => {
    if (!mobileTabUsesInnerScroll && !(activeBottom === "markets" && contextTab === "options")) return;

    let scrollEl: HTMLElement | null = null;
    let observer: MutationObserver | null = null;

    const detach = () => {
      if (!scrollEl) return;
      scrollEl.removeEventListener("scroll", onScroll);
      scrollEl = null;
    };

    const onScroll = () => {
      if (scrollEl) setIsScrolledRaw(scrollEl.scrollTop > COLLAPSE_PX);
    };

    const attach = (el: HTMLElement | null) => {
      detach();
      if (!el) {
        setIsScrolledRaw(false);
        return;
      }
      scrollEl = el;
      onScroll();
      el.addEventListener("scroll", onScroll, { passive: true });
    };

    attach(resolveMobileInnerScroller());

    if (!scrollEl && activeBottom === "markets" && contextTab === "options") {
      const main = document.querySelector("main.app-content");
      if (main) {
        observer = new MutationObserver(() => {
          const found = resolveMobileInnerScroller();
          if (found) {
            attach(found);
            observer?.disconnect();
            observer = null;
          }
        });
        observer.observe(main, { childList: true, subtree: true });
      }
    }

    return () => {
      detach();
      observer?.disconnect();
    };
  }, [mobileTabUsesInnerScroll, activeBottom, contextTab, atSubViewActive, resolveMobileInnerScroller]);

  useEffect(() => {
    const el = stickyWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setStickyH(entry.contentRect.height);
    });
    ro.observe(el);
    setStickyH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [activeBottom]);

  useEffect(() => {
    if (mobileTabUsesInnerScroll && activeBottom === "ai") {
      const el = document.querySelector("main.app-content > .tab-inner-scroll") as HTMLElement | null;
      el?.scrollTo({ top: 0 });
      return;
    }
    scrollRef.current?.scrollTo({ top: 0 });
  }, [aiSubTab, mobileTabUsesInnerScroll, activeBottom]);

  const chartParams = chartParamsFromStore(chartPeriod, chartInterval);
  const { data: historyData, isLoading: historyLoading, isFetching: historyFetching } = useGetPriceHistory<PriceHistoryResponse>(
    {
      symbol,
      periodType: chartParams.periodType,
      period: chartParams.period,
      frequencyType: chartParams.frequencyType,
      frequency: chartParams.frequency,
    },
    {
      query: {
        enabled: !!accessToken && !!symbol,
        placeholderData: (prev) => prev,
      },
    },
  );
  const chartLoading = historyLoading || historyFetching;

  useEffect(() => {
    if (historyData?.error === "unauthorized") {
      refresh();
    }
  }, [historyData?.error, refresh]);

  useEffect(() => {
    setHistoryTimedOut(false);
    if (!accessToken) return;
    const timer = setTimeout(() => setHistoryTimedOut(true), 5_000);
    return () => clearTimeout(timer);
  }, [symbol, accessToken]);

  return (
    <div className="app-shell bg-background flex flex-col overflow-hidden selection:bg-primary/30 selection:text-white">

      <header
        id="terminal-header"
        className="shrink-0 z-[105] safe-top border-b border-card-border bg-card"
      >
        <div className="terminal-header-row relative flex items-center h-12 min-w-0 w-full px-2 sm:px-4 bg-card gap-1">
          <button
            onClick={() => setSidebarOpen(true)}
            className="mr-2 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className={`flex flex-col leading-none ${isWide ? "" : "mr-auto"}`}>
            <span
              className="font-sans text-foreground"
              style={{
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "0.08em",
              }}
            >
              ALPHA
            </span>
            <span
              className="font-sans font-semibold text-primary"
              style={{ fontSize: 10, letterSpacing: "0.22em", marginTop: 3 }}
            >
              TERMINAL
            </span>
          </div>
          {isWide && (
            <DesktopTopNav
              activeTab={activeBottom}
              onTabChange={(tab) => {
                sidebarRef.current?.clearActivePage();
                setSidebarOpen(false);
                if (tab === "ai") setAiSubTab("pulse");
                setActiveBottom(tab);
              }}
              onOpenSearch={() => setSearchOpen(true)}
              strategistRunningCount={strategistRunningCount}
              strategistUnviewedCount={strategistUnviewedCount}
              compact={isCompactHeader}
            />
          )}
          <MarketSessionClock compact={isWide && isCompactHeader} />
          <div
            className="ml-3 w-2.5 h-2.5 rounded-full shrink-0"
            title={streamLight === "live" ? "Live data" : streamLight === "connecting" ? "Connecting..." : "Offline"}
            style={{
              background: streamLight === "live" ? "#00d166" : streamLight === "connecting" ? "#FFB800" : "#f23645",
              boxShadow: streamLight === "live" ? "0 0 6px #00d166" : undefined,
            }}
          />
        </div>
      </header>

      {activeBottom === "ai" && (
        <div className="shrink-0 bg-background z-40">
          <div className="px-3 sm:px-4 lg:px-5 pt-1 pb-1">
            <div className="flex w-full max-w-full overflow-x-auto p-1 gap-0.5" style={{ scrollbarWidth: "thin" }}>
              {(["pulse", "movers", "catalysts", "strategist"] as AiSubTab[]).map((tab) => {
                const label =
                  tab === "pulse"
                    ? "MARKET PULSE"
                    : tab === "movers"
                      ? "MOVERS"
                      : tab === "catalysts"
                        ? "CATALYSTS"
                        : "STRATEGIST";
                const showIndicator = tab === "strategist" && aiSubTab !== "strategist" && (strategistRunningCount > 0 || strategistUnviewedCount > 0);
                const indicatorIsRunning = strategistRunningCount > 0;
                return (
                  <button
                    key={tab}
                    onClick={() => setAiSubTab(tab)}
                    className="shrink-0 flex-1 min-w-[5.5rem] font-mono font-bold tracking-wider py-2 rounded-lg transition-all duration-200 relative"
                    style={{
                      fontSize: 12,
                      background: aiSubTab === tab ? "#1a1a1a" : "transparent",
                      color: aiSubTab === tab ? "#fafafa" : "#71717a",
                      border: "none",
                    }}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      {label}
                      {showIndicator && (
                        <span
                          aria-label={indicatorIsRunning ? "Strategist running" : "New strategist result"}
                          className={indicatorIsRunning ? "animate-pulse" : ""}
                          style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            borderRadius: 9999,
                            background: indicatorIsRunning ? "#FFB800" : "#00d166",
                            boxShadow: indicatorIsRunning ? "0 0 6px #FFB800" : "0 0 6px #00d166",
                          }}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">

        <Sidebar
          ref={sidebarRef}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          strategistRunningCount={strategistRunningCount}
          strategistUnviewedCount={strategistUnviewedCount}
          onNavigate={(dest) => {
            const chrome = useAtChromeStore.getState();
            chrome.leaveActiveTrader();
            chrome.requestOptionsSubView("chain");
            if (dest === "markets") setActiveBottom("markets");
            else if (dest === "portfolio") setActiveBottom("portfolio");
            else if (dest === "ai") { setActiveBottom("ai"); setAiSubTab("pulse"); }
            else if (dest === "ai-pulse") { setActiveBottom("ai"); setAiSubTab("pulse"); }
            else if (dest === "ai-strategist") { setActiveBottom("ai"); setAiSubTab("strategist"); }
          }}
        />

        {/* Dashboard brings its own watchlist widget — skip the fixed rail there. */}
        {isWide && activeBottom !== "dashboard" && (
          <aside className="hidden md:flex w-[280px] xl:w-[320px] min-[1920px]:w-[360px] flex-col border-r border-card-border bg-background shrink-0 overflow-y-auto">
            <WatchlistView onNavigateToSymbol={() => setActiveBottom("markets")} />
          </aside>
        )}

        {!isWide ? (
          <main
            ref={mobileTabUsesInnerScroll ? undefined : scrollRef}
            onScroll={mobileTabUsesInnerScroll ? undefined : handleScroll}
            className={`app-content flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden ${
              mobileTabUsesInnerScroll ||
              (activeBottom === "markets" && contextTab === "newsChat") ||
              (activeBottom === "ai" && aiSubTab === "pulse" && !pulseData && !pulseLoading && !pulseStreaming)
                ? "overflow-hidden"
                : "overflow-y-auto"
            }`}
          >

            {activeBottom === "markets" && (
              <div className="flex flex-1 min-h-0 flex-col">
                {showMiniCards && !isCompact && <MacroBar />}
                <div ref={stickyWrapRef} className="sticky top-0 z-40 bg-background shrink-0">
                  {atOptionsChrome && !atGlanceChrome ? (
                    <AtSymbolHeader compact={false} />
                  ) : atOptionsChrome ? null : (
                    <>
                      <MetricsBar compact={isScrolled} onTrade={openOrder} onOpenTearSheet={() => setCompanyTearSheetOpen(true)} />
                    </>
                  )}
                  {!atGlanceChrome ? <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} /> : null}
                  {contextTab === "company" && (
                    <CompanySectionTabBar page={companyPage} onPageChange={setCompanyPage} companyTabsId={companyTabsId} />
                  )}
                </div>
                <div
                  className={
                    marketsMobileShellLock || contextTab === "newsChat" || contextTab === "options"
                      ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                      : "flex min-h-0 flex-1 flex-col overflow-visible"
                  }
                >
                  {contextTab === "news" && (
                    <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                      <NewsTab />
                    </div>
                  )}
                  {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} releaseOptionHold={releaseOptionHold} stickyOffset={stickyH} onTradeSingle={handleOptionTradeSingle} onActiveTraderReview={handleActiveTraderReview} onSendToStrategist={navigateToStrategist} />}
                  {contextTab === "company" && (
                    <CompanySwipablePages
                      candles={historyData?.candles}
                      companyPage={companyPage}
                      onCompanyPageChange={setCompanyPage}
                      sectionTabsInHeader
                      companyTabsId={companyTabsId}
                    />
                  )}
                  {contextTab === "newsChat" && (
                    <MarketNewsChatPanel hideMobileComposerDock={symbolSearchOpen} />
                  )}
                  {contextTab === "chart" && (
                    <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                      <ChartControls />
                      <div className="h-[420px] sm:h-[500px] md:h-[580px] shrink-0">
                        <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={chartLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} timeframe={`${chartPeriod}/${chartInterval}`} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeBottom === "ai" && (
              <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToMarkets={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} onSendToOrder={handleSendToOrder} onStrategistSendToOrder={handleStrategistSendToOrder} onReopenValidatedOrder={reopenValidatedOrder} strategistDeepLinkJobId={strategistDeepLinkJobId} onStrategistDeepLinkHandled={() => setStrategistDeepLinkJobId(null)} />
              </div>
            )}

            {activeBottom === "portfolio" && (
              <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <PortfolioView subTab={portfolioSubTab} onSubTabChange={setPortfolioSubTab} onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} onRoll={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} />
              </div>
            )}

            {activeBottom === "insights" && (
              <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <InsightsView subscribeEquitySymbols={subscribeEquitySymbols} />
              </div>
            )}

            {activeBottom === "watchlist" && (
              <div className="flex flex-col bg-background" style={{ minHeight: "calc(100vh - 60px)" }}>
                <WatchlistView onNavigateToSymbol={() => setActiveBottom("markets")} />
              </div>
            )}
          </main>
        ) : isThreePanel ? (
          <>
            {activeBottom === "markets" ? (
              <>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="shrink-0 border-b border-zinc-800/60 bg-background">
                    <MetricsBar compact={isScrolled} onTrade={openOrder} onOpenTearSheet={() => setCompanyTearSheetOpen(true)} />
                  </div>
                  <div className="shrink-0 border-b border-zinc-800/40 bg-card">
                    <ChartControls />
                  </div>
                  <div className="flex-1 min-h-0 relative bg-background">
                    <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={chartLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} timeframe={`${chartPeriod}/${chartInterval}`} />
                  </div>
                </div>

                <div className="flex min-h-0 w-[360px] xl:w-[420px] 2xl:w-[480px] min-[1920px]:w-[560px] shrink-0 flex-col overflow-hidden border-l border-zinc-800/60 bg-background">
                  <div className="shrink-0">
                    <DesktopContextTabs activeTab={contextTab} setActiveTab={setContextTab} />
                    {contextTab === "company" && (
                      <CompanySectionTabBar page={companyPage} onPageChange={setCompanyPage} companyTabsId={companyTabsId} />
                    )}
                  </div>
                  <div
                    className={
                      contextTab === "newsChat" || contextTab === "options"
                        ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                        : "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-visible"
                    }
                  >
                    {contextTab === "news" && <NewsTab />}
                    {contextTab === "options" && atSubViewActive ? <AtSymbolHeader /> : null}
                    {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} releaseOptionHold={releaseOptionHold} stickyOffset={0} onTradeSingle={handleOptionTradeSingle} onActiveTraderReview={handleActiveTraderReview} onSendToStrategist={navigateToStrategist} />}
                    {contextTab === "company" && (
                      <CompanySwipablePages
                        candles={historyData?.candles}
                        companyPage={companyPage}
                        onCompanyPageChange={setCompanyPage}
                        sectionTabsInHeader
                        companyTabsId={companyTabsId}
                      />
                    )}
                    {contextTab === "newsChat" && (
                    <MarketNewsChatPanel hideMobileComposerDock={symbolSearchOpen} />
                  )}
                  </div>
                </div>
              </>
            ) : (
              <main ref={scrollRef} onScroll={handleScroll} className={`flex-1 min-w-0 app-content ${activeBottom === "dashboard" ? "relative overflow-hidden" : "pb-4 overflow-y-auto"}`} style={activeBottom === "portfolio" ? { overscrollBehaviorY: "none" } : undefined}>
                {activeBottom === "dashboard" && <DesktopGlance />}
                {activeBottom === "ai" && (
                  <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToMarkets={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); }} onSendToOrder={handleSendToOrder} onStrategistSendToOrder={handleStrategistSendToOrder} onReopenValidatedOrder={reopenValidatedOrder} strategistDeepLinkJobId={strategistDeepLinkJobId} onStrategistDeepLinkHandled={() => setStrategistDeepLinkJobId(null)} />
                )}
                {activeBottom === "portfolio" && (
                  <PortfolioView subTab={portfolioSubTab} onSubTabChange={setPortfolioSubTab} onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} onRoll={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} />
                )}
                {activeBottom === "insights" && (
                  <InsightsView subscribeEquitySymbols={subscribeEquitySymbols} />
                )}
              </main>
            )}
          </>
        ) : (
          <main
            ref={mobileTabUsesInnerScroll ? undefined : scrollRef}
            onScroll={mobileTabUsesInnerScroll ? undefined : handleScroll}
            className={`app-content flex min-h-0 flex-1 min-w-0 flex-col ${
              activeBottom === "dashboard"
                ? "relative overflow-hidden"
                : activeBottom === "markets" && contextTab === "options" && atSubViewActive
                  ? "pb-0"
                  : "pb-4"
            } ${
              activeBottom === "dashboard" ||
              mobileTabUsesInnerScroll ||
              (activeBottom === "markets" && (contextTab === "newsChat" || contextTab === "options"))
                ? "overflow-hidden"
                : "overflow-y-auto"
            }`}
            style={activeBottom === "portfolio" ? { overscrollBehaviorY: "none" } : undefined}
          >
            {activeBottom === "dashboard" && <DesktopGlance />}
            {activeBottom === "markets" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-zinc-800/60 bg-background">
                  {atOptionsChrome && !atGlanceChrome ? (
                    <AtSymbolHeader compact={false} />
                  ) : atOptionsChrome ? null : (
                    <>
                      <MetricsBar compact={isScrolled} onTrade={openOrder} onOpenTearSheet={() => setCompanyTearSheetOpen(true)} />
                    </>
                  )}
                </div>
                <div ref={stickyWrapRef} className="sticky top-0 z-40 shrink-0 bg-background">
                  {!atGlanceChrome ? <MarketDataTabs activeTab={contextTab} setActiveTab={setContextTab} /> : null}
                  {contextTab === "company" && (
                    <CompanySectionTabBar page={companyPage} onPageChange={setCompanyPage} companyTabsId={companyTabsId} />
                  )}
                </div>
                <div
                  className={
                    marketsMobileShellLock || contextTab === "newsChat" || contextTab === "options"
                      ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                      : "flex min-h-0 flex-1 flex-col overflow-visible"
                  }
                >
                  {contextTab === "news" && (
                    <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                      <NewsTab />
                    </div>
                  )}
                  {contextTab === "options" && <OptionsTab subscribeOptionSymbols={subscribeOptionSymbols} releaseOptionHold={releaseOptionHold} stickyOffset={stickyH} onTradeSingle={handleOptionTradeSingle} onActiveTraderReview={handleActiveTraderReview} onSendToStrategist={navigateToStrategist} />}
                  {contextTab === "company" && (
                    <CompanySwipablePages
                      candles={historyData?.candles}
                      companyPage={companyPage}
                      onCompanyPageChange={setCompanyPage}
                      sectionTabsInHeader
                      companyTabsId={companyTabsId}
                    />
                  )}
                  {contextTab === "newsChat" && (
                    <MarketNewsChatPanel hideMobileComposerDock={symbolSearchOpen} />
                  )}
                  {contextTab === "chart" && (
                    <>
                      <ChartControls />
                      <div className="h-[580px]">
                        <TradingChart symbol={symbol} data={historyData?.candles || []} isLoading={chartLoading} error={historyData?.error} timedOut={historyTimedOut} tokenExpired={historyData?.error === "unauthorized"} intraday={isIntradayInterval(chartInterval)} timeframe={`${chartPeriod}/${chartInterval}`} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeBottom === "ai" && (
              <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <AiIntelligenceTab subTab={aiSubTab} onSubTabChange={setAiSubTab} pulseDashRef={pulseDashRef} subscribeEquitySymbols={subscribeEquitySymbols} onNavigateToMarkets={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} onSendToOrder={handleSendToOrder} onStrategistSendToOrder={handleStrategistSendToOrder} onReopenValidatedOrder={reopenValidatedOrder} strategistDeepLinkJobId={strategistDeepLinkJobId} onStrategistDeepLinkHandled={() => setStrategistDeepLinkJobId(null)} />
              </div>
            )}

            {activeBottom === "portfolio" && (
              <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <PortfolioView subTab={portfolioSubTab} onSubTabChange={setPortfolioSubTab} onNavigateToSymbol={() => setActiveBottom("markets")} onTrade={openOrderForSymbol} onRoll={(sym) => { useTerminalStore.getState().setSymbol(sym); setActiveBottom("markets"); setContextTab("options"); }} />
              </div>
            )}

            {activeBottom === "insights" && (
              <div className="tab-inner-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <InsightsView subscribeEquitySymbols={subscribeEquitySymbols} />
              </div>
            )}
          </main>
        )}

        {hasUnifiedDraft && (
          <div
            data-unified-order-dock="1"
            className={`pointer-events-none absolute bottom-0 right-0 z-[90] ${
              isWide && activeBottom !== "dashboard"
                ? "left-0 md:left-[280px] xl:left-[320px] min-[1920px]:left-[360px]"
                : "left-0"
            }`}
          >
            <div className="pointer-events-auto">
              <OptionsChainOrderSheet
                atDocked
                legs={unifiedLegs}
                equityDraft={unifiedEquityDraft}
                initialLimitPrice={unifiedInitialLimit}
                onEquityQuantityChange={(qty) =>
                  setUnifiedEquityDraft((prev) =>
                    prev ? { ...prev, quantity: Math.max(1, Math.min(999999, qty)) } : null,
                  )
                }
                onFlipSides={handleUnifiedFlipSides}
                onLegQuantityChange={handleUnifiedLegQtyChange}
                onRemoveLeg={handleUnifiedRemoveLeg}
                onClearAll={clearUnifiedDraft}
                subscribeOptionSymbols={subscribeOptionSymbols}
                collapsed={unifiedSheetCollapsed}
                onCollapsedChange={setUnifiedSheetCollapsed}
                sheetPeek={unifiedSheetPeek}
                onSheetPeekChange={setUnifiedSheetPeek}
                onAdvancedOrders={() => setUnifiedDefaultsOpen(true)}
                strategistHandlerRef={unifiedStrategistRef}
                atBracketDraft={{
                  prefs: unifiedOrderPrefs,
                  primaryInstruction: unifiedPrimaryInstruction,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <StrategistStatusBar />

      {!atOptionsChrome ? <PushNotificationBanner aboveNav={!isWide} /> : null}

      {!isWide && (
        <BottomNav
          activeTab={
            atOptionsChrome
              ? "activeTrader"
              : activeBottom === "dashboard"
                ? "insights"
                : activeBottom === "portfolio" && portfolioSubTab === "orders"
                  ? "orders"
                  : activeBottom === "portfolio"
                    ? "portfolio"
                    : activeBottom
          }
          onTabChange={(tab) => {
          sidebarRef.current?.clearActivePage();
          setSidebarOpen(false);
          if (tab === "activeTrader") {
            const chrome = useAtChromeStore.getState();
            const wasOnOptionsChain =
              activeBottom === "markets" && contextTab === "options" && !chrome.subViewIsAt;
            noteAtEntry(useTerminalStore.getState().symbol, wasOnOptionsChain);
            chrome.enterActiveTrader();
            chrome.requestOptionsSubView("at");
            setActiveBottom("markets");
            setContextTab("options");
          } else if (tab === "orders") {
            const chrome = useAtChromeStore.getState();
            chrome.leaveActiveTrader();
            chrome.requestOptionsSubView("chain");
            setActiveBottom("portfolio");
            setPortfolioSubTab("orders");
          } else if (tab === "portfolio") {
            const chrome = useAtChromeStore.getState();
            chrome.leaveActiveTrader();
            chrome.requestOptionsSubView("chain");
            setActiveBottom("portfolio");
            setPortfolioSubTab("positions");
          } else {
            const chrome = useAtChromeStore.getState();
            chrome.leaveActiveTrader();
            chrome.requestOptionsSubView("chain");
            setActiveBottom(tab);
          }
        }} />
      )}

      {isWide ? (
        <SearchOverlay
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelectSymbol={() => {
            setSearchOpen(false);
            // On the dashboard, unpinned widgets follow the new symbol in place —
            // don't yank the user over to the Markets tab.
            if (activeBottom !== "dashboard") setActiveBottom("markets");
          }}
        />
      ) : showMobileEdgeSearch ? (
        <MobileEdgeSearch onOpenChange={setMobileSearchOpen} onCommitted={commitMobileTicker} />
      ) : null}
      <InAppBrowser />
      <AtOrderDefaultsSheet
        open={unifiedDefaultsOpen}
        prefs={unifiedOrderPrefs}
        primaryInstruction={unifiedPrimaryInstruction}
        windowSec={unifiedDefaultsWindowSec}
        onWindowSecChange={setUnifiedDefaultsWindowSec}
        onSendToStrategist={
          hasUnifiedDraft
            ? async ({ thesis }) => {
                const fn = unifiedStrategistRef.current;
                if (!fn) return;
                setUnifiedStrategistBusy(true);
                setUnifiedStrategistError(null);
                const res = await fn({ thesis });
                setUnifiedStrategistBusy(false);
                if (!res.ok) {
                  setUnifiedStrategistError(res.error);
                  return;
                }
                setUnifiedDefaultsOpen(false);
                clearUnifiedDraft();
                navigateToStrategist(res.ticker);
              }
            : undefined
        }
        strategistBusy={unifiedStrategistBusy}
        strategistError={unifiedStrategistError}
        onClose={() => {
          setUnifiedStrategistError(null);
          setUnifiedDefaultsOpen(false);
        }}
        onSave={(next) => {
          setUnifiedOrderPrefs(next);
          saveActiveTraderPrefs(unifiedOrderSymbolClass, next);
          setUnifiedDefaultsOpen(false);
        }}
      />
      <SchwabAccountPickerSheet />
      <CompanyTearSheet
        isOpen={companyTearSheetOpen}
        onClose={() => setCompanyTearSheetOpen(false)}
      />
      <FuturesTradeBlockedNotice
        isOpen={futuresTradeNoticeOpen}
        onClose={() => setFuturesTradeNoticeOpen(false)}
        symbol={terminalSymbol}
      />
    </div>
  );
}


