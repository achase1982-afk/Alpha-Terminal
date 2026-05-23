import { logger } from "../logger.js";
import type { MoversFeed } from "@workspace/movers-types";
import { fetchAllFmpMoverLists } from "./fmpMoversClient.js";
import { buildMoversFeedFromRows } from "./buildMoversFeed.js";
import { getLatestMoversFeed, persistMoversFeed } from "./moversFeedStore.js";
import { MOVERS_MANUAL_REFRESH_DEBOUNCE_MS, MOVERS_POLL_INTERVAL_MS } from "./moversConfig.js";

let activePoll: Promise<void> | null = null;
let lastManualPollAt = 0;

async function executePoll(): Promise<void> {
  const rows = await fetchAllFmpMoverLists();
  const feed = await buildMoversFeedFromRows(rows);
  await persistMoversFeed(feed);
  logger.info(
    {
      detected: feed.funnel.detected,
      filtered: feed.funnel.filtered,
      tradeable: feed.funnel.tradeable,
    },
    "Movers feed poll complete",
  );
}

/** Run one FMP poll; concurrent callers share the same in-flight request. */
export function runMoversPollOnce(): Promise<void> {
  if (activePoll) return activePoll;

  activePoll = (async () => {
    try {
      await executePoll();
    } catch (err) {
      logger.error({ err }, "Movers feed poll failed");
    } finally {
      activePoll = null;
    }
  })();

  return activePoll;
}

export type MoversPollNowResult = {
  feed: MoversFeed;
  /** True when debounce suppressed a new FMP poll (latest feed still returned). */
  debounced: boolean;
};

/**
 * Manual refresh: poll immediately unless debounced (~30s). Joins an in-flight poll
 * instead of starting a duplicate FMP batch.
 */
export async function requestMoversPollNow(): Promise<MoversPollNowResult> {
  const now = Date.now();
  if (now - lastManualPollAt < MOVERS_MANUAL_REFRESH_DEBOUNCE_MS) {
    return { feed: await getLatestMoversFeed(), debounced: true };
  }
  lastManualPollAt = now;
  await runMoversPollOnce();
  return { feed: await getLatestMoversFeed(), debounced: false };
}

export function startMoversPollWorker(): void {
  void runMoversPollOnce();
  setInterval(() => void runMoversPollOnce(), MOVERS_POLL_INTERVAL_MS);
  logger.info({ intervalMs: MOVERS_POLL_INTERVAL_MS }, "Movers poll worker started (24/7)");
}
