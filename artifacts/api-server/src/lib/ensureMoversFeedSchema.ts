import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Best-effort apply of `0035_movers_feed` so polls can persist even if migrate:deploy
 * did not run this revision yet (same pattern as telemetry_events self-heal).
 */
export async function ensureMoversFeedTable(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS movers_feed (
        id serial PRIMARY KEY NOT NULL,
        captured_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      )
    `));
    await db.execute(
      sql.raw(
        "CREATE INDEX IF NOT EXISTS movers_feed_captured_at_idx ON movers_feed (captured_at DESC)",
      ),
    );
    logger.info("movers_feed table ensured at startup");
  } catch (err: unknown) {
    logger.warn(
      { err },
      "Could not self-heal movers_feed — run pnpm db:migrate or grant CREATE on public schema",
    );
  }
}
