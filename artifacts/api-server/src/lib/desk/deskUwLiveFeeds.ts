import { deskUwGet } from "./deskUwHttp.js";
import {
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
  type DeskFeedId,
} from "./deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";
import { logger } from "../logger.js";

const UW_TICKER = "SPX";
const UW_SOURCE = "unusual_whales";
const REFRESH_MS = 90_000;

let refreshInFlight: Promise<void> | null = null;
let lastRefreshMs = 0;

function markUwGammaNotConfigured(): void {
  for (const feed of ["live_gamma_0dte", "live_gamma", "live_net_prem", "uw_flow"] as DeskFeedId[]) {
    deskMarkFeedNotConfigured(feed, UW_SOURCE);
  }
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

  refreshInFlight = (async () => {
    const paths: Array<{ feed: DeskFeedId; path: string }> = [
      { feed: "live_gamma_0dte", path: `/api/stock/${UW_TICKER}/spot-exposures/expiry-strike` },
      { feed: "live_gamma", path: `/api/stock/${UW_TICKER}/spot-exposures/strike` },
      { feed: "live_net_prem", path: `/api/stock/${UW_TICKER}/net-prem-ticks` },
    ];

    for (const { feed, path } of paths) {
      try {
        const res = await deskUwGet(path);
        if (!res.ok) {
          deskMarkFeedError(feed, `uw_http_${res.status}`, UW_SOURCE);
          logger.debug({ feed, status: res.status }, "Desk UW live feed fetch failed");
          continue;
        }
        deskTouchFeed(feed, res.asOfMs, UW_SOURCE);
      } catch (err) {
        deskMarkFeedError(feed, "uw_fetch_error", UW_SOURCE);
        logger.debug({ err, feed }, "Desk UW live feed error");
      }
    }
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