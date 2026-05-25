import { desc } from "drizzle-orm";
import { catalystEarningsDatesTable, db } from "@workspace/db";
import { logger } from "../logger.js";
import { runCatalystEarningsHarvest } from "./catalystEarningsHarvest.js";

let activeHarvest: Promise<void> | null = null;
let weeklyTimer: ReturnType<typeof setTimeout> | null = null;

/** Sunday 02:00 UTC — weekly cadence per earnings-source rebuild directive. */
function msUntilNextSunday0200Utc(): number {
  const now = new Date();
  const dow = now.getUTCDay();
  let addDays = (7 - dow) % 7;
  if (addDays === 0) {
    const today0200 = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0),
    );
    if (now.getTime() >= today0200.getTime()) addDays = 7;
  }
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + addDays, 2, 0, 0),
  );
  return Math.max(60_000, target.getTime() - now.getTime());
}

export function runCatalystEarningsHarvestOnce(): Promise<void> {
  if (activeHarvest) return activeHarvest;

  activeHarvest = (async () => {
    try {
      await runCatalystEarningsHarvest();
    } catch (err) {
      logger.error({ err }, "Catalyst earnings harvest failed");
    } finally {
      activeHarvest = null;
    }
  })();

  return activeHarvest;
}

function scheduleWeeklyHarvest(): void {
  if (weeklyTimer) clearTimeout(weeklyTimer);
  const ms = msUntilNextSunday0200Utc();
  weeklyTimer = setTimeout(() => {
    void runCatalystEarningsHarvestOnce().finally(() => scheduleWeeklyHarvest());
  }, ms);
  logger.info({ msUntil: ms }, "Catalyst earnings harvest scheduled (weekly Sunday 02:00 UTC)");
}

/**
 * Starts the weekly Schwab earnings-date sweep. On boot, runs once if the table is empty
 * or the latest harvest is older than 8 days (staleness guard headroom).
 */
export async function startCatalystEarningsHarvestWorker(): Promise<void> {
  try {
    const latest = await db
      .select({ harvestedAt: catalystEarningsDatesTable.harvestedAt })
      .from(catalystEarningsDatesTable)
      .orderBy(desc(catalystEarningsDatesTable.harvestedAt))
      .limit(1);

    const last = latest[0]?.harvestedAt;
    const staleMs = 8 * 24 * 60 * 60 * 1000;
    const needsBoot =
      !last || Date.now() - new Date(last).getTime() > staleMs;

    if (needsBoot) {
      logger.info({ lastHarvest: last ?? null }, "Catalyst earnings harvest: boot sweep (empty or stale)");
      void runCatalystEarningsHarvestOnce();
    }
  } catch (err) {
    logger.warn({ err }, "Catalyst earnings harvest: could not check freshness — scheduling boot sweep");
    void runCatalystEarningsHarvestOnce();
  }

  scheduleWeeklyHarvest();
  logger.info("Catalyst earnings harvest worker started");
}

/** @internal tests */
export function __stopCatalystEarningsHarvestWorkerForTests(): void {
  if (weeklyTimer) clearTimeout(weeklyTimer);
  weeklyTimer = null;
}
