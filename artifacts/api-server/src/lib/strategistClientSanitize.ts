import type { StrategistV2Result } from "./strategistV2.js";
import type { ConvictionDeskResult, DeskResult } from "./strategistDeskSchemas.js";

/**
 * Remove server-only Conviction diagnostic blob before DB telemetry or any client response.
 * (Same field list as `stripConvictionDeskDiagnosticsForClient` but for `deskResult` only.)
 */
export function stripConvictionDiagnosticsFromDeskResult(
  deskResult: ConvictionDeskResult | DeskResult | null | undefined,
): ConvictionDeskResult | DeskResult | null | undefined {
  if (deskResult == null) return deskResult;
  if (deskResult.mode !== "conviction_desk") return deskResult;
  if (deskResult.convictionDeskRunDiagnostic == null) return deskResult;
  const { convictionDeskRunDiagnostic: _omit, ...rest } = deskResult;
  return rest as ConvictionDeskResult;
}

/**
 * Conviction Desk diagnostics are multi-megabyte server-only payloads persisted in
 * `strategist_history.card_json`. They must not be sent to the browser: the terminal
 * persists strategist jobs (including completed results) to localStorage, and huge
 * objects freeze the UI during JSON serialization.
 */
export function stripConvictionDeskDiagnosticsForClient(result: StrategistV2Result): StrategistV2Result {
  if (!result.deskResult) return result;
  const stripped = stripConvictionDiagnosticsFromDeskResult(result.deskResult);
  if (stripped === result.deskResult) return result;
  return { ...result, deskResult: stripped };
}

export function stripHistoryCardJsonForClient(cardJson: unknown): unknown {
  if (!cardJson || typeof cardJson !== "object") return cardJson;
  const rec = cardJson as Record<string, unknown>;
  if (rec["kind"] === "validation") return cardJson;
  return stripConvictionDeskDiagnosticsForClient(cardJson as StrategistV2Result) as unknown;
}
