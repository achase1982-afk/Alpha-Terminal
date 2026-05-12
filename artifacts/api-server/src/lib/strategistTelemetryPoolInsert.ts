import { pool } from "@workspace/db";
import { resolveStrategistTelemetryPhysicalTable } from "./strategistTelemetryTableLocation.js";
import { getStrategistTelemetryPgColumnSet } from "./strategistTelemetryColumnCache.js";
import { filterStrategistTelemetryInsertForExistingColumns } from "./strategistTelemetryInsertFilter.js";
import { STRATEGIST_TELEMETRY_CAMEL_TO_SNAKE } from "./strategistTelemetryColumnMap.js";

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Dynamic `INSERT` using only columns that exist in Postgres. Used when Drizzle
 * `insert()` fails (driver / SQL edge cases) while reads already work via `SELECT *`.
 */
export async function insertStrategistTelemetryRowViaPool(
  values: Record<string, unknown>,
): Promise<number | null> {
  const loc = await resolveStrategistTelemetryPhysicalTable();
  const pgCols = await getStrategistTelemetryPgColumnSet();
  if (!loc || pgCols.size === 0) return null;
  const filtered = filterStrategistTelemetryInsertForExistingColumns(
    values,
    pgCols,
  );
  if (!filtered.ticker || !filtered.result) return null;

  const colNames: string[] = [];
  const params: unknown[] = [];
  for (const [camel, val] of Object.entries(filtered)) {
    if (val === undefined) continue;
    const snake = STRATEGIST_TELEMETRY_CAMEL_TO_SNAKE[camel];
    if (!snake || !pgCols.has(snake)) continue;
    colNames.push(quoteIdent(snake));
    params.push(Array.isArray(val) ? JSON.stringify(val) : val);
  }
  if (colNames.length === 0) return null;
  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${loc.fqn} (${colNames.join(", ")}) VALUES (${placeholders}) RETURNING id`;
  const r = await pool.query<{ id: number }>(sql, params);
  return r.rows[0]?.id ?? null;
}
