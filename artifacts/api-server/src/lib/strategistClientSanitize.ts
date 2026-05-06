import type { StrategistV2Result } from "./strategistV2.js";

/**
 * Conviction Desk diagnostics are multi-megabyte server-only payloads persisted in
 * `strategist_history.card_json`. They must not be sent to the browser: the terminal
 * persists strategist jobs (including completed results) to localStorage, and huge
 * objects freeze the UI during JSON serialization.
 */
export function stripConvictionDeskDiagnosticsForClient(result: StrategistV2Result): StrategistV2Result {
  const dr = result.deskResult;
  if (!dr || dr.mode !== "conviction_desk") return result;
  if (dr.convictionDeskRunDiagnostic == null) return result;
  const { convictionDeskRunDiagnostic: _omit, ...deskRest } = dr;
  return { ...result, deskResult: deskRest };
}

export function stripHistoryCardJsonForClient(cardJson: unknown): unknown {
  if (!cardJson || typeof cardJson !== "object") return cardJson;
  const rec = cardJson as Record<string, unknown>;
  if (rec["kind"] === "validation") return cardJson;
  return stripConvictionDeskDiagnosticsForClient(cardJson as StrategistV2Result) as unknown;
}
