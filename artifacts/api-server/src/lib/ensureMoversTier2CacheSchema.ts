import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

/** Best-effort apply of `0037_movers_tier2_cache` at boot. */
export async function ensureMoversTier2CacheTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS movers_tier2_cache (
        headline_set_key text PRIMARY KEY NOT NULL,
        catalyst_type text NOT NULL,
        driving_headline text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS movers_tier2_cache_created_at_idx ON movers_tier2_cache (created_at)`,
    );
    logger.info("movers_tier2_cache table ensured at startup");
  } catch (err) {
    logger.warn(
      { err },
      "Could not self-heal movers_tier2_cache — run pnpm db:migrate or grant CREATE on public schema",
    );
  }
}
