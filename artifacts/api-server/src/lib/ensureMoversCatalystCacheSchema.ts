import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

/** Best-effort apply of movers_catalyst_cache schema at boot. */
export async function ensureMoversCatalystCacheTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS movers_catalyst_cache (
        news_key text PRIMARY KEY NOT NULL,
        read text NOT NULL,
        posture text NOT NULL,
        confidence text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS movers_catalyst_cache_created_at_idx ON movers_catalyst_cache (created_at)`,
    );
    await db.execute(sql`
      ALTER TABLE movers_catalyst_cache ADD COLUMN IF NOT EXISTS catalyst_type text
    `);
    await db.execute(sql`
      ALTER TABLE movers_catalyst_cache ADD COLUMN IF NOT EXISTS catalyst_summary text
    `);
    logger.info("movers_catalyst_cache table ensured at startup");
  } catch (err) {
    logger.warn(
      { err },
      "Could not self-heal movers_catalyst_cache — run pnpm db:migrate or grant CREATE on public schema",
    );
  }
}
