import { pool } from "@workspace/db";
import { resolveStrategistTelemetryPhysicalTable } from "./ensureStrategistTelemetryAuditColumns.js";

/**
 * Drizzle `db.select().from(strategistTelemetryTable)` expands **every** ORM column into the
 * SQL projection. If production Postgres is missing **any** one of those columns (migrations not
 * applied, or ALTER denied), Postgres returns **42703** and telemetry appears "empty" forever.
 *
 * `SELECT *` only returns columns that **actually exist**, so reads stay compatible across
 * schema drift. We map snake_case keys to the camelCase JSON shape the Alpha Terminal expects.
 */

const SNAKE_TO_CAMEL: Record<string, string> = {
  id: "id",
  timestamp: "timestamp",
  ticker: "ticker",
  result: "result",
  regime: "regime",
  ticker_data: "tickerData",
  idio_score: "idioScore",
  toxic_gate: "toxicGate",
  viability: "viability",
  earnings_gate: "earningsGate",
  strategy_decision: "strategyDecision",
  candidates_generated: "candidatesGenerated",
  candidates_filtered: "candidatesFiltered",
  filter_reasons: "filterReasons",
  winning_candidate: "winningCandidate",
  edge_attribution: "edgeAttribution",
  recommendation_thesis: "recommendationThesis",
  data_package: "dataPackage",
  raw_ai_response: "rawAiResponse",
  confidence_base: "confidenceBase",
  confidence_catalyst_delta: "confidenceCatalystDelta",
  confidence_final: "confidenceFinal",
  catalyst_alignment: "catalystAlignment",
  data_source: "dataSource",
  fetch_failure_mode: "fetchFailureMode",
  full_diagnostic: "fullDiagnostic",
  scanner_source: "scannerSource",
  scanner_score: "scannerScore",
  scanner_mode: "scannerMode",
  scanner_edge_type: "scannerEdgeType",
  scanner_directional_lean: "scannerDirectionalLean",
  scanner_surfaced_by: "scannerSurfacedBy",
  scanner_flow_score: "scannerFlowScore",
  scanner_universe: "scannerUniverse",
  provider: "provider",
  model_input: "modelInput",
  system_prompt: "systemPrompt",
  tools_attached: "toolsAttached",
  thinking_config: "thinkingConfig",
  raw_api_response: "rawApiResponse",
  thinking_blocks: "thinkingBlocks",
  web_search_queries: "webSearchQueries",
  web_search_results: "webSearchResults",
  provider_request_id: "providerRequestId",
  model_name: "modelName",
};

function mapTelemetryRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const snake = k.toLowerCase();
    const camel = SNAKE_TO_CAMEL[snake];
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
