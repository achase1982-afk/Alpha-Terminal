/**
 * Deletes durable telemetry_events rows older than RETENTION_DAYS.
 *
 * At sustained ~100 req/min with HTTP timing + app emits, ~2M rows in-window is comfortable for Postgres.
 * If sustained traffic exceeds ~500 req/min or the table approaches ~10M rows, revisit with declarative
 * partitioning by day or a more aggressive retention policy.
 */
import { db, telemetryEventsTable } from "@workspace/db";
import { lt } from "drizzle-orm";

const RETENTION_DAYS = 14;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startTelemetryRetentionJob(): void {
  const run = async (): Promise<void> => {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await db.delete(telemetryEventsTable).where(lt(telemetryEventsTable.emittedAt, cutoff));
      console.log(`[telemetry-retention] cleanup ran (cutoff ${cutoff.toISOString()}, retention ${RETENTION_DAYS}d)`);
    } catch (err) {
      console.error("[telemetry-retention] cleanup failed", err);
    }
  };

  setTimeout(() => {
    void run();
  }, 60 * 1000);
  setInterval(() => {
    void run();
  }, RUN_INTERVAL_MS);
}
