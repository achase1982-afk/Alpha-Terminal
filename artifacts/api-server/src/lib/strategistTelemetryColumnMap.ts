/**
 * Canonical snake_case ↔ camelCase mapping for `strategist_telemetry`
 * (must match `lib/db/src/schema/index.ts` strategistTelemetryTable).
 */
export const STRATEGIST_TELEMETRY_SNAKE_TO_CAMEL: Record<string, string> = {
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

export const STRATEGIST_TELEMETRY_CAMEL_TO_SNAKE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [sn, cam] of Object.entries(STRATEGIST_TELEMETRY_SNAKE_TO_CAMEL)) {
    m[cam] = sn;
  }
  return m;
})();
