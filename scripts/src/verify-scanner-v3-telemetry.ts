/**
 * Reads durable scanner V3 telemetry from Postgres table telemetry_events (written by emitTelemetry).
 *
 * Requires DATABASE_URL (same connection string used by lib/db migrations).
 *
 * Query matches emitTelemetry persistence (message = event name; details JSON).
 *
 * Usage from repo root:
 *   DATABASE_URL="postgresql://..." pnpm exec tsx scripts/src/verify-scanner-v3-telemetry.ts
 */
import pg from "pg";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v != null && v !== "" ? v : undefined;
}

interface Row {
  emitted_at: Date;
  system: string;
  level: string;
  message: string;
  subsystem: string | null;
  duration_ms: string | null;
  count: string | null;
}

async function main(): Promise<void> {
  const databaseUrl = env("DATABASE_URL");
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

  try {
    const result = await pool.query<Row>(
      `SELECT emitted_at, system, level, message, subsystem,
              details->>'duration_ms' AS duration_ms,
              details->>'count' AS count
       FROM telemetry_events
       WHERE message LIKE 'scanner_v3_%'
         AND emitted_at > NOW() - INTERVAL '1 hour'
       ORDER BY emitted_at DESC
       LIMIT 50`,
    );

    if (result.rows.length === 0) {
      console.log("No scanner_v3_* rows in telemetry_events in the last hour.");
      process.exit(0);
      return;
    }

    for (const r of result.rows) {
      const ts =
        r.emitted_at instanceof Date ? r.emitted_at.toISOString() : String(r.emitted_at);
      console.log(
        `${ts}\t${r.message}\t${r.level}\t${r.duration_ms ?? ""}\t${r.count ?? ""}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
