import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

export async function ensureCatalystsFeedTable(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS catalysts_feed (
        id serial PRIMARY KEY NOT NULL,
        built_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      )
    `));
    await db.execute(
      sql.raw(
        "CREATE INDEX IF NOT EXISTS catalysts_feed_built_at_idx ON catalysts_feed (built_at DESC)",
      ),
    );
    logger.info("catalysts_feed table ensured at startup");
  } catch (err: unknown) {
    logger.warn(
      { err },
      "Could not self-heal catalysts_feed — run pnpm db:migrate or grant CREATE on public schema",
    );
  }
}
