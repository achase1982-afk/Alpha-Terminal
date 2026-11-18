import type { OptionChainResponse } from "@workspace/api-client-react";
import type { LiveQuote } from "@/lib/store";
import type { OptionsSubView } from "@/components/active-trader/OptionsSubViewToggle";

export type FuturesEsFixtureScene = "options-chain" | "active-trader" | "ticket-confirm";

export interface FuturesEsFixtureOverride {
  enabled: true;
  marker: string;
  symbol: string;
  scene: FuturesEsFixtureScene;
  chain: OptionChainResponse;
  underlyingPrice: number;
  streamQuote: LiveQuote;
  initialSubView: OptionsSubView;
  openTicketConfirm?: boolean;
}

let override: FuturesEsFixtureOverride | null = null;

export function setFuturesEsFixtureOverride(next: FuturesEsFixtureOverride | null): void {
  override = next;
}

export function getFuturesEsFixtureOverride(): FuturesEsFixtureOverride | null {
  if (!import.meta.env.DEV) return null;
  return override;
}