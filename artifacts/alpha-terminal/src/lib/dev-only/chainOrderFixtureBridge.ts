import type { OptionChainResponse } from "@workspace/api-client-react";

export type ChainOrderFixtureScene = "1-leg" | "vertical" | "iron-condor" | "confirm";

export interface ChainOrderFixtureLegPick {
  strike: number;
  type: "CALL" | "PUT";
  /** Chain cell side: ask = buy, bid = sell */
  side: "bid" | "ask";
}

export interface ChainOrderFixtureOverride {
  enabled: true;
  scene: ChainOrderFixtureScene;
  marker: string;
  symbol: string;
  chain: OptionChainResponse;
  underlyingPrice: number;
  selectedLegs: ChainOrderFixtureLegPick[];
  openReviewOnMount?: boolean;
  sheetCollapsed?: boolean;
}

let override: ChainOrderFixtureOverride | null = null;

export function setChainOrderFixtureOverride(next: ChainOrderFixtureOverride | null): void {
  override = next;
}

export function getChainOrderFixtureOverride(): ChainOrderFixtureOverride | null {
  if (!import.meta.env.DEV) return null;
  return override;
}