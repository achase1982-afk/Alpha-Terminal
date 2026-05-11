import { pool } from "@workspace/db";
import { resolveStrategistTelemetryPhysicalTable } from "./strategistTelemetryTableLocation.js";
import { STRATEGIST_TELEMETRY_SNAKE_TO_CAMEL } from "./strategistTelemetryColumnMap.js";

function mapTelemetryRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const snake = k.toLowerCase();
    const camel = STRATEGIST_TELEMETRY_SNAKE_TO_CAMEL[snake];
    if (camel) out[camel] = v;
    else out[k] = v;
  }
  return out;
}

export async function selectStrategistTelemetryRows(opts: {
  limit: number;
  tickerUpper?: string;
}): Promise<Record<string, unknown>[]> {
  const loc = await resolveStrategistTelemetryPhysicalTable();
  if (!loc) return [];
  const { fqn } = loc;
  const lim = Math.min(100, Math.max(1, Math.floor(opts.limit)));
  if (opts.tickerUpper) {
    const r = await pool.query(`SELECT * FROM ${fqn} WHERE ticker = $1 ORDER BY timestamp DESC LIMIT $2`, [
      opts.tickerUpper,
      lim,
    ]);
    return r.rows.map((row) => mapTelemetryRow(row as Record<string, unknown>));
  }
  const r = await pool.query(`SELECT * FROM ${fqn} ORDER BY timestamp DESC LIMIT $1`, [lim]);
  return r.rows.map((row) => mapTelemetryRow(row as Record<string, unknown>));
}

export async function selectStrategistTelemetryRowById(id: number): Promise<Record<string, unknown> | null> {
  const loc = await resolveStrategistTelemetryPhysicalTable();
  if (!loc) return null;
  const { fqn } = loc;
  const r = await pool.query(`SELECT * FROM ${fqn} WHERE id = $1 LIMIT 1`, [id]);
  if (r.rows.length === 0) return null;
  return mapTelemetryRow(r.rows[0] as Record<string, unknown>);
}

export async function selectStrategistTelemetryRowByRequestId(requestId: string): Promise<Record<string, unknown> | null> {
  const loc = await resolveStrategistTelemetryPhysicalTable();
  if (!loc) return null;
  const { fqn } = loc;
  const r = await pool.query(
    `SELECT * FROM ${fqn} WHERE (full_diagnostic->'runMetadata'->>'requestId') = $1 LIMIT 1`,
    [requestId],
  );
  if (r.rows.length === 0) return null;
  return mapTelemetryRow(r.rows[0] as Record<string, unknown>);
}
