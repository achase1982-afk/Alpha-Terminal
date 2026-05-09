import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: false,
});

pool.on("error", (err) => {
  console.error("[DB POOL] Unexpected idle client error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
/** Re-export so consumers share one drizzle-orm instance with schema (avoids duplicate-install type fractures). */
export * from "drizzle-orm";
