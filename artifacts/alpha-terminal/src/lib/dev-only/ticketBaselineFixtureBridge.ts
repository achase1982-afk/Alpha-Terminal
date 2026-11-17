/** Dev-only ticket baseline screenshots — must not ship in prod builds. */

import type { MarketDataTab } from "@/components/MarketDataTabs";

export const TICKET_BASELINE_FIXTURE_MARKER = "TICKET_BASELINE_FIXTURE_DEV_ONLY";

export type TicketBaselineScene =
  | "stock-buy"
  | "stock-sell"
  | "stock-buy-confirm"
  | "option-bto"
  | "option-stc"
  | "option-bto-confirm"
  | "chain-1-leg-collapsed"
  | "chain-1-leg-expanded"
  | "chain-confirm";

export interface TicketBaselineTerminalSeed {
  orderOpen: boolean;
  orderSide: "BUY" | "SELL";
  orderOptionSymbol?: string;
  orderOptionInstruction?: string;
  orderIsClose?: boolean;
  contextTab: MarketDataTab;
}

export interface TicketBaselineFixtureOverride {
  enabled: true;
  marker: typeof TICKET_BASELINE_FIXTURE_MARKER;
  scene: TicketBaselineScene;
  terminal: TicketBaselineTerminalSeed;
}

let override: TicketBaselineFixtureOverride | null = null;

export function setTicketBaselineFixtureOverride(next: TicketBaselineFixtureOverride | null): void {
  override = next;
}

export function getTicketBaselineFixtureOverride(): TicketBaselineFixtureOverride | null {
  if (!import.meta.env.DEV) return null;
  return override;
}