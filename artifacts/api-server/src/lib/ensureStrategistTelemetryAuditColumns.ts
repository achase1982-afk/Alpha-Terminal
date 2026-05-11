import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Best-effort apply of `0032_strategist_telemetry_audit_persistence` so strategist
 * telemetry reads/writes work without a manual migrate step, as long as the DB
 * user can ALTER `strategist_telemetry` (typical on Railway).
 *
 * Mirrors the SQL in `lib/db/drizzle/0032_strategist_telemetry_audit_persistence.sql`.
 */
const STRATEGIST_TELEMETRY_AUDIT_COLUMN_ALTER_SQL: readonly string[] = [
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "model_input" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "system_prompt" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "tools_attached" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "extended_thinking_config" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "raw_api_response" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "thinking_blocks" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "web_search_queries" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "web_search_results" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "anthropic_request_id" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "model_name" text`,
];

export async function ensureStrategistTelemetryAuditColumns(): Promise<void> {
  try {
    for (const stmt of STRATEGIST_TELEMETRY_AUDIT_COLUMN_ALTER_SQL) {
      await db.execute(sql.raw(stmt));
    }
    logger.info(
      "strategist_telemetry audit columns ensured at startup (0032 self-heal; no manual migrate required for these columns)",
    );
  } catch (err: unknown) {
    logger.warn(
      { err },
      "Could not self-heal strategist_telemetry audit columns — grant ALTER on strategist_telemetry or run pnpm db:migrate",
    );
  }
}
