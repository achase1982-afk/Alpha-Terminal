import type { OptionChainResponse } from "@workspace/api-client-react";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";

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
  /** Fixture only: build real Schwab payload and POST to mocked place-order. */
  mockPlaceOrder?: boolean;
  atBracketDraft?: {
    prefs: ActiveTraderTemplatePrefs;
    primaryInstruction: SchwabInstruction;
  };
}

let override: ChainOrderFixtureOverride | null = null;

export function setChainOrderFixtureOverride(next: ChainOrderFixtureOverride | null): void {
  override = next;
}

export function getChainOrderFixtureOverride(): ChainOrderFixtureOverride | null {
  if (!import.meta.env.DEV) return null;
  return override;
}