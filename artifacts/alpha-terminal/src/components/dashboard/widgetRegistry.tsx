import type { ComponentProps, ReactNode } from "react";
import type { DashboardWidgetId } from "@/lib/dashboardStore";
import { WatchlistView } from "@/components/WatchlistView";
import { NewsTab } from "@/components/NewsTab";
import { PortfolioView } from "@/components/PortfolioView";
import { MoversFeed } from "@/components/MoversFeed";
import { CatalystsFeed } from "@/components/CatalystsFeed";
import { MarketNewsChatPanel } from "@/components/MarketNewsChatPanel";
import { ChartWidget } from "./ChartWidget";

/** Callbacks the host page (Terminal) provides to dashboard widgets. */
export interface DashboardWidgetHandlers {
  onNavigateToSymbol: (sym?: string) => void;
  onTrade: NonNullable<ComponentProps<typeof PortfolioView>["onTrade"]>;
  onRoll: (sym: string) => void;
  subscribeEquitySymbols?: (syms: string[]) => void;
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
};

export const WIDGET_CATALOG = (Object.keys(WIDGET_REGISTRY) as DashboardWidgetId[]).map((id) => ({
  id,
  title: WIDGET_REGISTRY[id].title,
}));
