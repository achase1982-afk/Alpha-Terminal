import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

/** Best-effort apply of `0039_catalyst_earnings_dates` when migrate:deploy has not run yet. */
export async function ensureCatalystEarningsDatesTable(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS catalyst_earnings_dates (
        symbol text PRIMARY KEY NOT NULL,
        next_earnings_date date,
        earnings_confirmed boolean,
        harvested_at timestamptz NOT NULL,
        sweep_id text
      )
    `));
    await db.execute(
      sql.raw(
        "CREATE INDEX IF NOT EXISTS catalyst_earnings_dates_next_date_idx ON catalyst_earnings_dates (next_earnings_date)",
      ),
    );
    await db.execute(
      sql.raw(
        "CREATE INDEX IF NOT EXISTS catalyst_earnings_dates_harvested_at_idx ON catalyst_earnings_dates (harvested_at DESC)",
      ),
    );
    logger.info("catalyst_earnings_dates table ensured at startup");
  } catch (err: unknown) {
    logger.warn(
      { err },
      "Could not self-heal catalyst_earnings_dates — run pnpm db:migrate or grant CREATE on public schema",
    );
  }
}
