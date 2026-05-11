import { STRATEGIST_TELEMETRY_CAMEL_TO_SNAKE } from "./strategistTelemetryColumnMap.js";

/**
 * Drops insert keys whose backing Postgres column does not exist yet, so Drizzle
 * does not emit `INSERT ... thinking_config ...` when that column was never migrated.
 */
export function filterStrategistTelemetryInsertForExistingColumns(
  values: Record<string, unknown>,
  pgColumns: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [camel, val] of Object.entries(values)) {
    const snake = STRATEGIST_TELEMETRY_CAMEL_TO_SNAKE[camel];
    if (!snake || !pgColumns.has(snake)) continue;
    if (val === undefined) continue;
    out[camel] = val;
  }
  return out;
}
