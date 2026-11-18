import type { ComponentType } from "react";
import {
  createFreshViewImportRunner,
  type FreshImportViewName,
} from "@/lib/freshLazyImport";

const VIEW_EXPORT_KEY: Record<FreshImportViewName, string> = {
  Portfolio: "PortfolioView",
  News: "NewsTab",
  Options: "OptionsTab",
  "Order ticket": "OrderTicket",
};

function normalizeChunkModule(
  viewName: FreshImportViewName,
  mod: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { default: ComponentType<any> } {
  const key = VIEW_EXPORT_KEY[viewName];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Comp = (mod.default ?? mod[key]) as ComponentType<any> | undefined;
  if (!Comp) {
    throw new Error(`Chunk for ${viewName} is missing export ${key}`);
  }
  return { default: Comp };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runners: Record<FreshImportViewName, (attempt: number) => Promise<{ default: ComponentType<any> }>> = {
  Portfolio: createFreshViewImportRunner(
    "Portfolio",
    () => import("@/components/PortfolioView").then((m) => ({ default: m.PortfolioView })),
    (mod) => normalizeChunkModule("Portfolio", mod),
  ),
  News: createFreshViewImportRunner(
    "News",
    () => import("@/components/NewsTab").then((m) => ({ default: m.NewsTab })),
    (mod) => normalizeChunkModule("News", mod),
  ),
  Options: createFreshViewImportRunner(
    "Options",
    () => import("@/components/OptionsTab").then((m) => ({ default: m.OptionsTab })),
    (mod) => normalizeChunkModule("Options", mod),
  ),
  "Order ticket": createFreshViewImportRunner(
    "Order ticket",
    () => import("@/components/OrderTicket").then((m) => ({ default: m.OrderTicket })),
    (mod) => normalizeChunkModule("Order ticket", mod),
  ),
};

export function isFreshImportViewName(name: string): name is FreshImportViewName {
  return name in runners;
}

/** Run a tracked import for Portfolio / News / Options / Order ticket. */
export function runFreshViewImport(
  viewName: FreshImportViewName,
  attempt: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ default: ComponentType<any> }> {
  return runners[viewName](attempt);
}