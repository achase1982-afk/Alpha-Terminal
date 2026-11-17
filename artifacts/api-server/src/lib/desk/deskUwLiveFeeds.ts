import { deskSessionDateEt } from "./deskEt.js";
import {
  deskFetchLiveGamma,
  deskFetchLiveGamma0dte,
  deskGetCachedLiveGamma,
  deskGetCachedLiveGamma0dte,
  deskUwGammaAsFeedSnapshot,
} from "./deskUwGamma.js";
import { deskFetchNetPremTicks } from "./deskUwNetPrem.js";
import {
  deskMarkFeedNotConfigured,
  type DeskFeedId,
} from "./deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";

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
  const expiry = deskSessionDateEt();
  if (feed === "live_gamma_0dte") {
    const c = deskGetCachedLiveGamma0dte(expiry);
    return c ? deskUwGammaAsFeedSnapshot(c) : null;
  }
  if (feed === "live_gamma") {
    const c = deskGetCachedLiveGamma(expiry);
    return c ? deskUwGammaAsFeedSnapshot(c) : null;
  }
  return null;
}

export async function refreshDeskUwLiveFeeds(force = false): Promise<void> {
  const key = getUwApiKey();
  if (!key) {
    markUwGammaNotConfigured();
    return;
  }

  const now = Date.now();
  if (!force && now - lastRefreshMs < REFRESH_MS && refreshInFlight) {
    await refreshInFlight;
    return;
  }
  if (!force && now - lastRefreshMs < REFRESH_MS) return;

  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }

  const expiry = deskSessionDateEt();
  refreshInFlight = (async () => {
    await deskFetchLiveGamma0dte(expiry);
    await deskFetchLiveGamma(expiry);
    await deskFetchNetPremTicks({ ticker: "SPX" });
    lastRefreshMs = Date.now();
  })().finally(() => {
    refreshInFlight = null;
  });

  await refreshInFlight;
}

export function startDeskUwLiveFeedRefresh(): void {
  if (!getUwApiKey()) {
    markUwGammaNotConfigured();
    return;
  }
  void refreshDeskUwLiveFeeds(true);
  setInterval(() => {
    void refreshDeskUwLiveFeeds();
  }, REFRESH_MS);
}