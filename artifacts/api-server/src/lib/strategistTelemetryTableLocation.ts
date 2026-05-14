import { pool } from "@workspace/db";
import { logger } from "./logger.js";

let strategistTelemetryTableLocation:
  | { schema: string; fqn: string }
  | null /** not found */
  | undefined /** not resolved yet */
  = undefined;

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/** Clear cached pg_catalog resolution (e.g. after DDL or rare rename). */
export function invalidateStrategistTelemetryTableLocationCache(): void {
  strategistTelemetryTableLocation = undefined;
}

/** Resolve `"schema"."strategist_telemetry"` for SQL qualification. */
export async function resolveStrategistTelemetryPhysicalTable(): Promise<{
  schema: string;
  fqn: string;
} | null> {
  if (strategistTelemetryTableLocation !== undefined) {
    return strategistTelemetryTableLocation;
  }
  try {
    const r = await pool.query<{ nspname: string }>(`
      SELECT n.nspname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'strategist_telemetry'
        AND c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, n.nspname
      LIMIT 1
    `);
    if (r.rows.length === 0) {
      strategistTelemetryTableLocation = null;
      logger.warn("strategist_telemetry: no relation named strategist_telemetry in pg_catalog (skip audit DDL)");
      return null;
    }
    const schema = r.rows[0].nspname;
    if (typeof schema !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      strategistTelemetryTableLocation = null;
      logger.warn({ schema }, "strategist_telemetry: unexpected schema name from pg_catalog (skip audit DDL)");
      return null;
    }
    strategistTelemetryTableLocation = {
      schema,
      fqn: `${quoteIdent(schema)}.${quoteIdent("strategist_telemetry")}`,
    };
    return strategistTelemetryTableLocation;
  } catch (err) {
    logger.warn({ err }, "strategist_telemetry: pg_catalog lookup failed");
    return null;
  }
}
