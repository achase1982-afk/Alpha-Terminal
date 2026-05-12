import { pool } from "@workspace/db";
import { resolveStrategistTelemetryPhysicalTable } from "./strategistTelemetryTableLocation.js";

let strategistTelemetryPgColumnCache:
  | { schema: string; columns: Set<string> }
  | null /** table missing */
  | undefined = undefined;

export function invalidateStrategistTelemetryPgColumnCache(): void {
  strategistTelemetryPgColumnCache = undefined;
}

/** Live column names on `strategist_telemetry` (snake_case), for insert filtering. */
export async function getStrategistTelemetryPgColumnSet(): Promise<Set<string>> {
  const loc = await resolveStrategistTelemetryPhysicalTable();
  if (!loc) {
    strategistTelemetryPgColumnCache = null;
    return new Set();
  }
  if (strategistTelemetryPgColumnCache?.schema === loc.schema) {
    return strategistTelemetryPgColumnCache.columns;
  }
  const r = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'strategist_telemetry'`,
    [loc.schema],
  );
  const columns = new Set(r.rows.map((x) => x.column_name));
  strategistTelemetryPgColumnCache = { schema: loc.schema, columns };
  return columns;
}
