/**
 * Programmatic Drizzle migration runner.
 *
 * Reads versioned SQL files from lib/db/drizzle/, applies any that have not
 * yet been recorded in the drizzle.__drizzle_migrations journal table, and
 * exits. Safe to re-run: already-applied migrations are skipped.
 *
 * Usage (standalone):
 *   DATABASE_URL=... node --loader ts-node/esm src/migrate.ts
 *
 * Usage (via npm script):
 *   pnpm --filter @workspace/db run migrate
 *
 * Called automatically by start.sh before the server process starts on
 * every Railway deploy, ensuring schema is always in sync with code.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// drizzle/ lives one level up from src/ (i.e. lib/db/drizzle/)
const migrationsFolder = path.resolve(__dirname, "..", "drizzle");

async function runMigrations(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    const db = drizzle(pool);
    console.log("[migrate] Applying pending migrations from", migrationsFolder);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] Done — schema is up to date.");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error("[migrate] Migration failed:", err.message ?? err);
  process.exit(1);
});
