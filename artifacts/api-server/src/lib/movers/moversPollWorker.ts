import { logger } from "../logger.js";
import { isUsEquityRthWindowEt } from "../ibkrTickEntitlementPilot.js";
import { fetchAllFmpMoverLists } from "./fmpMoversClient.js";
import { buildMoversFeedFromRows } from "./buildMoversFeed.js";
import { persistMoversFeed } from "./moversFeedStore.js";
import { MOVERS_POLL_INTERVAL_MS } from "./moversConfig.js";

let pollInFlight = false;

export async function runMoversPollOnce(): Promise<void> {
  if (pollInFlight) {
    logger.debug("Movers poll skipped — previous run still in flight");
    return;
  }
  if (!isUsEquityRthWindowEt()) {
    logger.debug("Movers poll skipped — outside US equity RTH (Mon–Fri 09:30–16:00 ET)");
    return;
  }

  pollInFlight = true;
  try {
    const rows = await fetchAllFmpMoverLists();
    const feed = buildMoversFeedFromRows(rows);
    await persistMoversFeed(feed);
    logger.info(
      {
        detected: feed.funnel.detected,
        filtered: feed.funnel.filtered,
        tradeable: feed.funnel.tradeable,
      },
      "Movers feed poll complete",
    );
  } catch (err) {
    logger.error({ err }, "Movers feed poll failed");
  } finally {
    pollInFlight = false;
  }
}

export function startMoversPollWorker(): void {
  const tick = () => void runMoversPollOnce();

  if (isUsEquityRthWindowEt()) {
    void tick();
  }

  setInterval(tick, MOVERS_POLL_INTERVAL_MS);
  logger.info({ intervalMs: MOVERS_POLL_INTERVAL_MS }, "Movers poll worker started");
}
