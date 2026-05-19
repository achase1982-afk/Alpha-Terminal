/**
 * Apply pending Drizzle migrations before api-server starts (Railway deploy hook).
 *
 * Uses drizzle-orm's migrator against lib/db/drizzle (same SQL as drizzle-kit migrate).
 * Requires DATABASE_URL. Exits non-zero on failure so the container does not start.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(scriptDir, "../../../lib/db/drizzle");

if (!process.env.DATABASE_URL) {
  console.error("[migrate:deploy] DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15_000,
});

try {
  const db = drizzle(pool);
  console.log("[migrate:deploy] Applying pending migrations from", migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.log("[migrate:deploy] Schema is up to date.");
} catch (err) {
  console.error("[migrate:deploy] Migration failed:", err instanceof Error ? err.message : err);
  if (err?.cause) console.error("[migrate:deploy] Caused by:", err.cause);
  if (err?.stack) console.error("[migrate:deploy] Stack:", err.stack);
  process.exit(1);
} finally {
  await pool.end();
}
