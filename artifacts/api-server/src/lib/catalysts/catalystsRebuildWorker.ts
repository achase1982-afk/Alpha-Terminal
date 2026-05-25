import { logger } from "../logger.js";
import { nyCalendarYmd, nyOffsetForYmd } from "../usEquityMarketCalendar.js";
import { buildCatalystsFeed } from "./buildCatalystsFeed.js";
import { persistCatalystsFeed, getLatestCatalystsFeed } from "./catalystsFeedStore.js";
import { fetchVendorEarningsCalendar, filterEarningsInWindow } from "./vendorEarningsCalendar.js";
import { CATALYSTS_WINDOW_CALENDAR_DAYS } from "@workspace/catalysts-types";

let activeRebuild: Promise<void> | null = null;
let calendarRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let nightlyTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextNyTime(hour: number, minute: number): number {
  const now = new Date();
  const ymd = nyCalendarYmd(now);
  const off = nyOffsetForYmd(ymd);
  let target = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`);
  if (target.getTime() <= now.getTime()) {
    const tomorrow = new Date(target.getTime() + 86_400_000);
    const ymd2 = nyCalendarYmd(tomorrow);
    const off2 = nyOffsetForYmd(ymd2);
    target = new Date(`${ymd2}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off2}`);
  }
  return target.getTime() - now.getTime();
}

export function runCatalystsRebuildOnce(): Promise<void> {
  if (activeRebuild) return activeRebuild;

  activeRebuild = (async () => {
    try {
      const feed = await buildCatalystsFeed();
      await persistCatalystsFeed(feed);
      logger.info(
        { tradeable: feed.funnel.tradeable, calendar: feed.funnel.calendar },
        "Catalysts feed rebuild complete",
      );
    } catch (err) {
      logger.error({ err }, "Catalysts feed rebuild failed");
    } finally {
      activeRebuild = null;
    }
  })();

  return activeRebuild;
}

/** Light refresh: vendor calendar only — does not recompute settled bars. */
async function refreshEarningsCalendarCache(): Promise<void> {
  try {
    await fetchVendorEarningsCalendar(logger);
    const rows = filterEarningsInWindow(
      await fetchVendorEarningsCalendar(logger),
      CATALYSTS_WINDOW_CALENDAR_DAYS,
    );
    logger.info({ count: rows.length }, "Catalysts earnings calendar refresh");
  } catch (err) {
    logger.warn({ err }, "Catalysts earnings calendar refresh failed");
  }
}

function scheduleNightlyRebuild(): void {
  if (nightlyTimer) clearTimeout(nightlyTimer);
  const ms = msUntilNextNyTime(16, 5);
  nightlyTimer = setTimeout(() => {
    void runCatalystsRebuildOnce().finally(() => scheduleNightlyRebuild());
  }, ms);
  logger.info({ msUntil: ms }, "Catalysts nightly rebuild scheduled (4:05 PM ET)");
}

function scheduleCalendarRefresh(): void {
  if (calendarRefreshTimer) clearTimeout(calendarRefreshTimer);
  calendarRefreshTimer = setTimeout(() => {
    void refreshEarningsCalendarCache().finally(() => scheduleCalendarRefresh());
  }, 20 * 60 * 1000);
}

export function startCatalystsRebuildWorker(): void {
  void getLatestCatalystsFeed().then((feed) => {
    if (!feed.builtAt) {
      void runCatalystsRebuildOnce();
    }
  });
  scheduleNightlyRebuild();
  scheduleCalendarRefresh();
  logger.info("Catalysts rebuild worker started");
}

/** @internal tests */
export function __stopCatalystsRebuildWorkerForTests(): void {
  if (nightlyTimer) clearTimeout(nightlyTimer);
  if (calendarRefreshTimer) clearTimeout(calendarRefreshTimer);
  nightlyTimer = null;
  calendarRefreshTimer = null;
}
