import type { OptionChainResponse } from "@workspace/api-client-react";
import type { ZoneModel } from "./zonesModel";

export type AtFixtureScene = "default" | "strip" | "confirm" | "chain";

export interface AtFixturePresentation {
  regimeLabel: string | null;
  regimeDegraded: boolean;
  zones: ZoneModel;
  classifiedPct: number;
  headline: string;
  sessionLabel: string;
  skipNetwork: true;
}

export interface AtFixtureOverride {
  enabled: true;
  scene: AtFixtureScene;
  symbol: string;
  initialSubView: "at" | "chain";
  chain: OptionChainResponse;
  underlyingPrice: number;
  presentation: AtFixturePresentation;
  tapStrike?: number;
  openReviewOnMount?: boolean;
}

let fixtureOverride: AtFixtureOverride | null = null;

export function setAtFixtureOverride(next: AtFixtureOverride | null): void {
  fixtureOverride = next;
}

/** Dev-only Active Trader screenshot harness; always null in production builds. */
export function getAtFixtureOverride(): AtFixtureOverride | null {
  if (!import.meta.env.DEV) return null;
  return fixtureOverride;
}