import { DESK_NEWS_POLL_MS } from "../../deskPollCadence.js";
import { logger } from "../../../logger.js";
import { deskUwAddonEnabled } from "./deskUwEnabled.js";
import { deskUwPollPaused } from "./deskUwPollControl.js";
import { refreshDeskUwLiveFeeds } from "./deskUwLiveFeeds.js";
import { deskRefreshUwFlow } from "./deskUnusualWhales.js";

let uwPollInFlight: Promise<void> | null = null;

export async function runDeskUwPollCycle(): Promise<void> {
  if (!deskUwAddonEnabled()) return;
  if (deskUwPollPaused()) return;

  if (uwPollInFlight) {
    await uwPollInFlight;
    return;
  }

  uwPollInFlight = (async () => {
    try {
      if (!deskUwPollPaused()) await refreshDeskUwLiveFeeds(true);
    } catch (err) {
      logger.debug({ err }, "Desk UW live feed refresh error");
    }
    try {
      if (!deskUwPollPaused()) await deskRefreshUwFlow();
    } catch (err) {
      logger.debug({ err }, "Desk UW flow refresh error");
    }
  })().finally(() => {
    uwPollInFlight = null;
  });

  await uwPollInFlight;
}

export function startDeskUwPoller(): void {
  if (!deskUwAddonEnabled()) return;
  void runDeskUwPollCycle();
  const t = setInterval(() => {
    void runDeskUwPollCycle();
  }, DESK_NEWS_POLL_MS);
  t.unref?.();
}
