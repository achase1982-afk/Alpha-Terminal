import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Best-effort apply of `0031_telemetry_events_service` so the runtime logs API
 * works without a separate migration step, as long as the DB user can ALTER
 * the `telemetry_events` table (typical for the app’s own Postgres on Railway).
 */
export async function ensureTelemetryEventsServiceColumn(): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        "ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS service text NOT NULL DEFAULT 'server'",
      ),
    );
    await db.execute(
      sql.raw(
        "CREATE INDEX IF NOT EXISTS telemetry_events_service_emitted_at_idx ON telemetry_events (service, emitted_at DESC)",
      ),
    );
    logger.info("telemetry_events.service ensured at startup (no manual migrate needed for this column)");
  } catch (err: unknown) {
    logger.warn(
      { err },
      "Could not self-heal telemetry_events.service — grant ALTER on telemetry_events or run pnpm db:migrate",
    );
  }
}
