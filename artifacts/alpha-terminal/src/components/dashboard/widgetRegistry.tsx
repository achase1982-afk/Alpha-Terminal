import type { ComponentProps, ReactNode } from "react";
import type { DashboardWidgetId } from "@/lib/dashboardStore";
import { WatchlistView } from "@/components/WatchlistView";
import { NewsTab } from "@/components/NewsTab";
import { PortfolioView } from "@/components/PortfolioView";
import { MoversFeed } from "@/components/MoversFeed";
import { CatalystsFeed } from "@/components/CatalystsFeed";
import { MarketNewsChatPanel } from "@/components/MarketNewsChatPanel";
import { OptionsTab } from "@/components/OptionsTab";
import { MetricsBar } from "@/components/MetricsBar";
import { MarketPulseDashboard } from "@/components/market-pulse/MarketPulseDashboard";
import { ChartWidget } from "./ChartWidget";
import { AccountSummaryWidget } from "./AccountSummaryWidget";

/** Callbacks the host page (Terminal) provides to dashboard widgets. */
export interface DashboardWidgetHandlers {
  onNavigateToSymbol: (sym?: string) => void;
  onTrade: NonNullable<ComponentProps<typeof PortfolioView>["onTrade"]>;
  onRoll: (sym: string) => void;
  subscribeEquitySymbols?: (syms: string[]) => void;
  /** Options chain: register option symbols with the market stream. */
  subscribeOptionSymbols?: (symbols: string[]) => Promise<void>;
  onTradeSingle?: ComponentProps<typeof OptionsTab>["onTradeSingle"];
  onOpenStrategyBuilder?: ComponentProps<typeof OptionsTab>["onOpenStrategyBuilder"];
  /** Open the stock order ticket for the active symbol. */
  openOrder?: (side: "BUY" | "SELL") => void;
}

interface WidgetDef {
  title: string;
  /** Widget follows the active symbol and therefore supports pinning. */
  symbolAware?: boolean;
  render: (h: DashboardWidgetHandlers) => ReactNode;
}

export const WIDGET_REGISTRY: Record<DashboardWidgetId, WidgetDef> = {
  chart: {
    title: "Chart",
    symbolAware: true,
    render: () => <ChartWidget />,
  },
  watchlist: {
    title: "Watchlist",
    render: (h) => <WatchlistView onNavigateToSymbol={h.onNavigateToSymbol} />,
  },
  news: {
    title: "News",
    symbolAware: true,
    render: () => <NewsTab />,
  },
  positions: {
    title: "Portfolio",
    render: (h) => (
      <PortfolioView onNavigateToSymbol={h.onNavigateToSymbol} onTrade={h.onTrade} onRoll={h.onRoll} />
    ),
  },
  movers: {
    title: "Movers",
    render: (h) => <MoversFeed onNavigateToSymbol={h.onNavigateToSymbol} />,
  },
  catalysts: {
    title: "Catalysts",
    render: (h) => (
      <CatalystsFeed
        onNavigateToSymbol={h.onNavigateToSymbol}
        subscribeEquitySymbols={h.subscribeEquitySymbols}
      />
    ),
  },
  chat: {
    title: "Market Chat",
    symbolAware: true,
    render: () => <MarketNewsChatPanel />,
  },
  options: {
    title: "Options Chain",
    symbolAware: true,
    render: (h) => (
      <OptionsTab
        subscribeOptionSymbols={h.subscribeOptionSymbols}
        stickyOffset={0}
        onTradeSingle={h.onTradeSingle}
        onOpenStrategyBuilder={h.onOpenStrategyBuilder}
      />
    ),
  },
  trade: {
    title: "Quote & Trade",
    symbolAware: true,
    render: (h) => <MetricsBar onTrade={h.openOrder} />,
  },
  pulse: {
    title: "AI Pulse",
    render: () => <MarketPulseDashboard />,
  },
  account: {
    title: "Account Summary",
    render: () => <AccountSummaryWidget />,
  },
};

export const WIDGET_CATALOG = (Object.keys(WIDGET_REGISTRY) as DashboardWidgetId[]).map((id) => ({
  id,
  title: WIDGET_REGISTRY[id].title,
}));
