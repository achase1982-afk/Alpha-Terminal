import { db, deskApiSnapshotsTable, lt, sql } from "@workspace/db";
import { getMarketContext, priorNyTradingSessionYmd } from "../getMarketContext.js";
import { logger } from "../logger.js";

const RETENTION_MS = 30 * 86_400_000;

export async function deskPruneSnapshots(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  try {
    await db.delete(deskApiSnapshotsTable).where(lt(deskApiSnapshotsTable.capturedAt, cutoff));
  } catch (err) {
    logger.debug({ err }, "desk snapshot prune skipped");
  }
}

export async function deskPruneTapeSessions(): Promise<void> {
  const ctx = getMarketContext();
  const prior = priorNyTradingSessionYmd(ctx.tradingDate);
  if (!prior) return;
  try {
    await db.execute(sql`
      DELETE FROM desk_spx_tape
      WHERE ts < ${prior}::date
    `);
  } catch (err) {
    logger.debug({ err }, "desk tape session prune skipped");
  }
}

export function startDeskRetentionJobs(): void {
  const run = () => {
    void deskPruneSnapshots();
    void deskPruneTapeSessions();
  };
  run();
  setInterval(run, 6 * 3_600_000);
}