import type { OptionChainResponse } from "@workspace/api-client-react";
import type { LiveQuote } from "@/lib/store";
import type { OptionsSubView } from "@/components/active-trader/OptionsSubViewToggle";

export type FuturesEsFixtureScene =
  | "options-chain"
  | "options-nq"
  | "active-trader"
  | "trade-notice";

export interface FuturesEsFixtureOverride {
  enabled: true;
  marker: string;
  symbol: string;
  scene: FuturesEsFixtureScene;
  chain: OptionChainResponse;
  underlyingPrice: number;
  streamQuote: LiveQuote;
  initialSubView: OptionsSubView;
  openTradeNoticeOnMount?: boolean;
}

let override: FuturesEsFixtureOverride | null = null;

export function setFuturesEsFixtureOverride(next: FuturesEsFixtureOverride | null): void {
  override = next;
}

export function getFuturesEsFixtureOverride(): FuturesEsFixtureOverride | null {
  if (!import.meta.env.DEV) return null;
  return override;
}