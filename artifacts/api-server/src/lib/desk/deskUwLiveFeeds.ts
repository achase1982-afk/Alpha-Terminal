import { deskSessionDateEt } from "./deskEt.js";
import {
  deskGetCachedLiveGamma,
  deskGetCachedLiveGamma0dte,
  deskRefreshLiveGamma,
  deskRefreshLiveGamma0dte,
  deskUwGammaAsFeedSnapshot,
} from "./deskUwGamma.js";
import { deskGetCachedNetPremTicks, deskRefreshNetPremTicks } from "./deskUwNetPrem.js";
import { deskMarkFeedNotConfigured, type DeskFeedId } from "./deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";
import { logger } from "../logger.js";

const REFRESH_MS = 90_000;

let refreshInFlight: Promise<void> | null = null;
let lastRefreshMs = 0;

function markUwGammaNotConfigured(): void {
  for (const feed of ["live_gamma_0dte", "live_gamma", "live_net_prem", "uw_flow"] as DeskFeedId[]) {
    deskMarkFeedNotConfigured(feed, "unusual_whales");
  }
}

export type DeskUwFeedSnapshot = {
  data: unknown;
  asOfMs: number;
  row_count: number;
};

export function getDeskUwFeedSnapshot(
  feed: "live_gamma_0dte" | "live_gamma" | "live_net_prem",
): DeskUwFeedSnapshot | null {
  const date = deskSessionDateEt();
  if (feed === "live_gamma_0dte") {
    const c = deskGetCachedLiveGamma0dte(date);
    return c ? deskUwGammaAsFeedSnapshot(c) : null;
  }
  if (feed === "live_gamma") {
    const c = deskGetCachedLiveGamma(date);
    return c ? deskUwGammaAsFeedSnapshot(c) : null;
  }
  const np = deskGetCachedNetPremTicks("SPX", date, null);
  if (!np) return null;
  return { data: { ticks: np.ticks, ticker: np.ticker }, asOfMs: np.asOfMs, row_count: np.ticks.length };
}

async function refreshGamma0dteSafe(expiry: string): Promise<void> {
  try {
    await deskRefreshLiveGamma0dte(expiry);
  } catch (err) {
    logger.debug({ err }, "Desk UW refresh live_gamma_0dte failed");
  }
}

async function refreshLiveGammaSafe(date: string): Promise<void> {
  try {
    await deskRefreshLiveGamma(date);
  } catch (err) {
    logger.debug({ err }, "Desk UW refresh live_gamma failed");
  }
}

async function refreshNetPremSafe(): Promise<void> {
  try {
    await deskRefreshNetPremTicks("SPX", dateOfRefresh());
  } catch (err) {
    logger.debug({ err }, "Desk UW refresh live_net_prem failed");
  }
}

function dateOfRefresh(): string {
  return deskSessionDateEt();
}

export async function refreshDeskUwLiveFeeds(force = false): Promise<void> {
  const key = getUwApiKey();
  if (!key) {
    markUwGammaNotConfigured();
    return;
  }

  const now = Date.now();
  if (!force && now - lastRefreshMs < REFRESH_MS) return;

  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }

  const expiry = dateOfRefresh();
  refreshInFlight = (async () => {
    await refreshGamma0dteSafe(expiry);
    await refreshLiveGammaSafe(expiry);
    await refreshNetPremSafe();
    lastRefreshMs = Date.now();
  })().finally(() => {
    refreshInFlight = null;
  });

  await refreshInFlight;
}