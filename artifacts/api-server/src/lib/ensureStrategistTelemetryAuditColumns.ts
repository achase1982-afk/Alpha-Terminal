import { db, sql } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Best-effort schema alignment for strategist telemetry audit columns (0032 + 0033),
 * so reads/writes work without a manual migrate when the DB user can ALTER the table.
 */
const STRATEGIST_TELEMETRY_AUDIT_RENAME_SQL = [
  `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'anthropic_request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'provider_request_id'
  ) THEN
    ALTER TABLE "strategist_telemetry" RENAME COLUMN "anthropic_request_id" TO "provider_request_id";
  END IF;
END $$`,
  `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'extended_thinking_config'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'thinking_config'
  ) THEN
    ALTER TABLE "strategist_telemetry" RENAME COLUMN "extended_thinking_config" TO "thinking_config";
  END IF;
END $$`,
];

const STRATEGIST_TELEMETRY_AUDIT_COLUMN_ALTER_SQL: readonly string[] = [
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "provider" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "model_input" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "system_prompt" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "tools_attached" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "thinking_config" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "raw_api_response" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "thinking_blocks" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "web_search_queries" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "web_search_results" jsonb`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "provider_request_id" text`,
  `ALTER TABLE "strategist_telemetry" ADD COLUMN IF NOT EXISTS "model_name" text`,
];

export async function ensureStrategistTelemetryAuditColumns(): Promise<void> {
  try {
    for (const stmt of STRATEGIST_TELEMETRY_AUDIT_RENAME_SQL) {
      await db.execute(sql.raw(stmt));
    }
    for (const stmt of STRATEGIST_TELEMETRY_AUDIT_COLUMN_ALTER_SQL) {
      await db.execute(sql.raw(stmt));
    }
    logger.info(
      "strategist_telemetry audit columns ensured at startup (0032/0033 self-heal; no manual migrate required for these columns)",
    );
  } catch (err: unknown) {
    logger.warn(
      { err },
      "Could not self-heal strategist_telemetry audit columns — grant ALTER on strategist_telemetry or run pnpm db:migrate",
    );
  }
}
