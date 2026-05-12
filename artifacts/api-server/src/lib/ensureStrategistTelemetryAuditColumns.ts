import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { resolveStrategistTelemetryPhysicalTable } from "./strategistTelemetryTableLocation.js";
import { invalidateStrategistTelemetryPgColumnCache } from "./strategistTelemetryColumnCache.js";

/**
 * Best-effort schema alignment for strategist telemetry audit columns (0032 + 0033),
 * so reads/writes work without a manual migrate when the DB user can ALTER the table.
 *
 * Resolves the physical schema via `pg_catalog` (Drizzle default is `public`, but
 * search_path / hosting can differ). Runs DDL with `pool.query` so dollar-quoted
 * `DO $$` blocks are not altered by the Drizzle SQL layer.
 */

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function buildAuditRenameAndAlterStatements(loc: { schema: string; fqn: string }): readonly string[] {
  const escSchema = loc.schema.replace(/'/g, "''");
  const { fqn } = loc;
  const q = (c: string) => quoteIdent(c);
  return [
    `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = '${escSchema}' AND table_name = 'strategist_telemetry' AND column_name = 'anthropic_request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = '${escSchema}' AND table_name = 'strategist_telemetry' AND column_name = 'provider_request_id'
  ) THEN
    ALTER TABLE ${fqn} RENAME COLUMN anthropic_request_id TO provider_request_id;
  END IF;
END $$`,
    `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = '${escSchema}' AND table_name = 'strategist_telemetry' AND column_name = 'extended_thinking_config'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = '${escSchema}' AND table_name = 'strategist_telemetry' AND column_name = 'thinking_config'
  ) THEN
    ALTER TABLE ${fqn} RENAME COLUMN extended_thinking_config TO thinking_config;
  END IF;
END $$`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("provider")} text`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("model_input")} text`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("system_prompt")} text`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("tools_attached")} jsonb`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("thinking_config")} jsonb`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("raw_api_response")} jsonb`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("thinking_blocks")} text`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("web_search_queries")} jsonb`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("web_search_results")} jsonb`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("provider_request_id")} text`,
    `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS ${q("model_name")} text`,
  ];
}

/**
 * Applies renames + ADD IF NOT EXISTS via `pool.query` (throws on DB error).
 * @returns false when the table could not be located (caller should not mark primed).
 */
export async function applyStrategistTelemetryAuditColumnMigrations(): Promise<boolean> {
  const loc = await resolveStrategistTelemetryPhysicalTable();
  if (!loc) return false;
  logger.info({ schema: loc.schema }, "strategist_telemetry: applying audit column DDL");
  const stmts = buildAuditRenameAndAlterStatements(loc);
  for (const stmt of stmts) {
    await pool.query(stmt);
  }
  invalidateStrategistTelemetryPgColumnCache();
  return true;
}

export async function ensureStrategistTelemetryAuditColumns(): Promise<void> {
  try {
    const ok = await applyStrategistTelemetryAuditColumnMigrations();
    if (ok) {
      logger.info(
        "strategist_telemetry audit columns ensured at startup (0032/0033 self-heal; no manual migrate required for these columns)",
      );
    }
  } catch (err: unknown) {
    logger.warn(
      { err },
      "Could not self-heal strategist_telemetry audit columns — grant ALTER on strategist_telemetry or run pnpm db:migrate",
    );
  }
}

/** Avoid dumping multi-line SQL DO blocks into mobile JSON responses. */
export function sanitizeStrategistTelemetryClientDetail(flat: string): string {
  const s = flat.trim();
  if (s.length === 0) return "";
  if (/\bDO\s*\$\$/i.test(s) || (/\bALTER\s+TABLE\b/i.test(s) && s.length > 240)) {
    return "Database schema alignment failed (full message in API server logs only).";
  }
  return s.slice(0, 500);
}

/** Walk `Error.cause` / nested objects — node-postgres + Drizzle often put `code` on inner errors. */
export function strategistTelemetryFlattenErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  const seen = new Set<unknown>();
  for (let i = 0; i < 10 && cur != null && !seen.has(cur); i++) {
    seen.add(cur);
    if (cur instanceof Error) parts.push(cur.message);
    else if (typeof cur === "string") parts.push(cur);
    else if (typeof cur === "object" && cur !== null && "message" in cur) {
      const m = (cur as { message: unknown }).message;
      if (typeof m === "string") parts.push(m);
    }
    cur =
      cur !== null && typeof cur === "object" && "cause" in cur
        ? (cur as { cause: unknown }).cause
        : undefined;
  }
  return parts.join(" · ");
}

export function strategistTelemetryPostgresErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  for (let i = 0; i < 10 && cur != null && !seen.has(cur); i++) {
    seen.add(cur);
    if (typeof cur === "object" && cur !== null && "code" in cur) {
      const c = (cur as { code: unknown }).code;
      if (typeof c === "string" && c.length > 0) return c;
    }
    cur =
      cur !== null && typeof cur === "object" && "cause" in cur
        ? (cur as { cause: unknown }).cause
        : undefined;
  }
  return undefined;
}

function isMissingStrategistTelemetryColumnError(err: unknown): boolean {
  const code = strategistTelemetryPostgresErrorCode(err);
  if (code === "42703") return true;
  const msg = strategistTelemetryFlattenErrorMessage(err);
  return /column .*does not exist/i.test(msg);
}

/**
 * When a telemetry SELECT fails (e.g. code deployed before DDL ran), run the same
 * self-heal DDL once and retry. Covers boot-time ensure failures and zero-downtime races.
 */
export async function withStrategistTelemetrySchemaHeal<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingStrategistTelemetryColumnError(err)) {
      throw err;
    }
    logger.warn(
      { err, pgCode: strategistTelemetryPostgresErrorCode(err) },
      "strategist_telemetry read failed (missing column); applying audit DDL then retrying once",
    );
    try {
      await applyStrategistTelemetryAuditColumnMigrations();
    } catch (applyErr) {
      logger.warn(
        { applyErr, pgCode: strategistTelemetryPostgresErrorCode(applyErr) },
        "strategist_telemetry: heal DDL attempt failed (retrying SELECT anyway)",
      );
    }
    return await fn();
  }
}

let strategistTelemetryReadSchemaPrimed = false;
let lastStrategistTelemetryPrimeAttemptMs = 0;

const PRIME_COOLDOWN_MS = 5000;

/**
 * Runs audit DDL before the first successful strategist telemetry read (then no-ops).
 * Throttles failed attempts to once per 5s so a denied ALTER does not spam the DB.
 */
export async function primeStrategistTelemetryReadSchema(): Promise<void> {
  if (strategistTelemetryReadSchemaPrimed) return;
  const now = Date.now();
  if (
    lastStrategistTelemetryPrimeAttemptMs > 0 &&
    now - lastStrategistTelemetryPrimeAttemptMs < PRIME_COOLDOWN_MS
  ) {
    return;
  }
  lastStrategistTelemetryPrimeAttemptMs = now;
  try {
    const ok = await applyStrategistTelemetryAuditColumnMigrations();
    if (ok) strategistTelemetryReadSchemaPrimed = true;
  } catch (err) {
    logger.warn({ err }, "strategist_telemetry: read-path schema prime failed (will retry)");
  }
}
