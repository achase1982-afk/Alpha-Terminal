import { randomUUID } from "node:crypto";
import { normalizeIvClampedReasonsForPayload } from "./strategistIvClampCompat.js";
import type { TapeBackfillStatus } from "./strategistTapeBackfill.js";
import type { StrategistConfig } from "./strategistSettings.js";
import type { PolygonApiCallRecord } from "./polygonApiTrace.js";
import type { ConvictionDeskResult, DeskResult } from "./strategistDeskSchemas.js";
import type { ConvictionDeskProviderAuditSnapshot } from "./aiLabAnalystClient.js";

/** Maps numeric strategist mode to stable string labels for diagnostics. */
export function strategistModeLabel(mode: number): string {
  switch (mode) {
    case 1:
      return "solo";
    case 2:
      return "debate";
    case 3:
      return "four_analyst";
    case 4:
      return "solo_desk";
    case 5:
      return "conviction_desk";
    default:
      return `mode_${mode}`;
  }
}

export type StrategistRunOutcomeTelemetry = "pass" | "trade" | "error" | "partial";

export interface StrategistRunMetadata {
  timestamp: string;
  ticker: string;
  strategistMode: string;
  requestId: string;
  userId: string | null;
  sessionIdentifier: string | null;
  totalRunDurationMs: number;
}

/** Normalizes tape backfill to the diagnostic shape (all listed keys present). */
export function buildTapeBackfillDiagnostic(tape: TapeBackfillStatus | undefined): Record<string, unknown> {
  if (!tape) {
    return {
      status: null,
      reason: null,
      tapeBackfillReason: null,
      occCompleted: null,
      occListLength: null,
      tradesInserted: null,
      totalTradesFromPolygon: null,
      persistRejectedCount: null,
      anyTruncated: null,
      anyError: null,
      sessionDate: null,
      todayYmd: null,
      isSessionForToday: null,
      sessionInProgress: null,
      queryOpenMs: null,
      queryCloseMs: null,
      coverageEndMs: null,
      wsOccSubscribed: null,
      tapeBackfillDedupeDropsTotal: null,
    };
  }
  const occReq = tape.occRequested;
  return {
    status: tape.status,
    reason: tape.reason ?? null,
    tapeBackfillReason: tape.tapeBackfillReason,
    occCompleted: tape.occCompleted,
    occListLength: tape.occListLength ?? occReq,
    tradesInserted: tape.tradesInserted,
    totalTradesFromPolygon: tape.totalTradesFromPolygon ?? null,
    persistRejectedCount: tape.persistRejectedCount ?? null,
    anyTruncated: tape.anyTruncated ?? null,
    anyError: tape.anyError ?? null,
    sessionDate: tape.sessionDate,
    todayYmd: tape.todayYmd ?? null,
    isSessionForToday: tape.isSessionForToday ?? null,
    sessionInProgress: tape.sessionInProgress ?? null,
    queryOpenMs: tape.queryOpenMs ?? null,
    queryCloseMs: tape.queryCloseMs ?? null,
    coverageEndMs: tape.coverageEndMs,
    wsOccSubscribed: tape.wsOccSubscribed ?? null,
    tapeBackfillDedupeDropsTotal: tape.tapeBackfillDedupeDrops?.totalDropped ?? null,
  };
}

/** Pulls session tape quality signals from parsed data package JSON. */
export function extractSessionTapeRollupsFromDataPackage(pkg: Record<string, unknown>): Record<string, unknown> {
  const flow = pkg.polygonFlowHighlights as Record<string, unknown> | undefined;
  const sessionTape = flow?.sessionTape as Record<string, unknown> | undefined;
  const exec = sessionTape?.execPerStrike as unknown;
  const sweepBlockLargePerSession = Array.isArray(exec)
    ? exec.map((row: Record<string, unknown>) => ({
        strike: row.strike,
        expiration: row.expiration,
        optionType: row.optionType,
        sweepCount: row.sweepCount ?? null,
        blockCount: row.blockCount ?? null,
        largeCount: null,
      }))
    : [];
  return {
    sessionTapeTapeKind: sessionTape?.tapeKind ?? null,
    aggressorSessionTotals: sessionTape?.aggressorSessionTotals ?? null,
    sweepBlockLargePerSession,
  };
}

export interface ModelCallAttributionRow {
  role: string;
  providerModel: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  retryAttempts: number;
  extendedThinkingEnabled: boolean;
  /** Populated for Conviction Desk Anthropic audit when extended thinking is configured. */
  extendedThinkingBudgetTokens?: number | null;
  /** Actual model id sent to the provider when it differs from the slot label. */
  modelName?: string | null;
  estimatedCostUsd: number | null;
}

/** Placeholder until LLM SDK usage hooks populate real token/latency numbers. */
export function buildModelAttributionPlaceholder(args: {
  settings: StrategistConfig;
  deskResult?: DeskResult | ConvictionDeskResult | null;
  soloModelLabel?: string;
}): Record<string, unknown> {
  const { settings, deskResult, soloModelLabel } = args;
  const mode = strategistModeLabel(settings.strategistMode);
  const stubCall = (role: string, label: string): ModelCallAttributionRow => ({
    role,
    providerModel: label,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    retryAttempts: 0,
    extendedThinkingEnabled: false,
    estimatedCostUsd: null,
  });

  if (settings.strategistMode === 5 && deskResult?.mode === "conviction_desk" && deskResult.models) {
    const m = deskResult.models.pm;
    return {
      mode: "conviction_desk",
      calls: [stubCall("conviction_desk_consolidated", m)],
      note:
        "Conviction Desk uses one consolidated LLM call; detailed usage metrics pending SDK instrumentation.",
    };
  }
  if (settings.strategistMode === 3 && deskResult?.models) {
    return {
      mode: "four_analyst",
      calls: [
        stubCall("vol", deskResult.models.vol),
        stubCall("flow", deskResult.models.flow),
        stubCall("catalyst", deskResult.models.catalyst),
        stubCall("pm", deskResult.models.pm),
      ],
      note:
        "Per-call latency, token counts, retries, extended thinking, and cost are not yet wired from provider SDK responses; providerModel reflects configured strategist model slots.",
    };
  }
  if (settings.strategistMode === 4 && deskResult?.models) {
    const m = deskResult.models.vol;
    return {
      mode: "solo_desk",
      calls: [stubCall("solo_desk_consolidated", m)],
      note:
        "Solo Desk uses one consolidated LLM call; detailed usage metrics pending SDK instrumentation.",
    };
  }
  const solo = soloModelLabel ?? "ai_lab_default";
  return {
    mode,
    calls: [stubCall("strategist", solo)],
    note: "Token usage and latency hooks pending for solo/debate paths.",
  };
}

export interface BuildFullDiagnosticArgs {
  runMetadata: StrategistRunMetadata;
  strategistPayload: unknown;
  tapeBackfillStatus: TapeBackfillStatus | undefined;
  dataPackageParsed: Record<string, unknown>;
  modelAttribution: Record<string, unknown>;
  polygonTrace: PolygonApiCallRecord[];
  runOutcome: StrategistRunOutcomeTelemetry;
  runDurationMs: number;
  error: { message: string; stack?: string } | null;
  closingImbalancePresent?: boolean;
  closingImbalanceLatencyMs?: number | null;
  nasdaqDepthPresent?: boolean | null;
  nasdaqDepthLatencyMs?: number | null;
  esContextPresent?: boolean | null;
  esContextLatencyMs?: number | null;
  cboeOnePresent?: boolean | null;
  cboeOneLatencyMs?: number | null;
  iseComplexBookPresent?: boolean | null;
  iseComplexBookLatencyMs?: number | null;
  totalviewPoolSize?: number | null;
  totalviewPoolCapacity?: number | null;
  totalviewWasColdStart?: boolean | null;
  cboeOnePoolSize?: number | null;
  cboeOnePoolCapacity?: number | null;
  cboeOneWasColdStart?: boolean | null;
  /** Conviction Desk per-attempt usage (+ web search counts when available). */
  convictionDeskProviderTelemetry?: Array<Record<string, unknown>>;
  /** @deprecated Old key name; prefer convictionDeskProviderTelemetry when present. */
  convictionDeskAnthropicTelemetry?: Array<Record<string, unknown>>;
  /** Last Conviction Desk request/response audit (mirrors strategist_telemetry columns). */
  convictionDeskProviderAudit?: ConvictionDeskProviderAuditSnapshot | null;
  /** @deprecated Old arg name — use convictionDeskProviderAudit. */
  anthropicConvictionAudit?: ConvictionDeskProviderAuditSnapshot | null;
}

export function buildStrategistFullDiagnosticJson(args: BuildFullDiagnosticArgs): Record<string, unknown> {
  const dqBase = (args.dataPackageParsed.dataQualitySummary as Record<string, unknown> | undefined) ?? null;
  let dqMerged = dqBase && typeof dqBase === "object" ? { ...dqBase } : {};
  const rawReasons = dqMerged["ivClampedReasons"];
  if (rawReasons && typeof rawReasons === "object" && rawReasons !== null) {
    dqMerged = {
      ...dqMerged,
      ivClampedReasons: normalizeIvClampedReasonsForPayload(rawReasons as Record<string, number | undefined>),
    };
  }
  const sessionRollups = extractSessionTapeRollupsFromDataPackage(args.dataPackageParsed);
  const closingImbalancePresent =
    args.closingImbalancePresent ??
    args.dataPackageParsed.closingImbalance != null;
  const closingImbalanceLatencyMs =
    args.closingImbalanceLatencyMs ?? null;

  const dataQualitySummary: Record<string, unknown> = {
    ...dqMerged,
    sessionTapeTapeKind: sessionRollups.sessionTapeTapeKind,
    aggressorSessionTotals: sessionRollups.aggressorSessionTotals,
    sweepBlockLargePerSession: sessionRollups.sweepBlockLargePerSession,
    closingImbalancePresent,
    closingImbalanceLatencyMs,
    nasdaqDepthPresent: args.nasdaqDepthPresent ?? null,
    nasdaqDepthLatencyMs: args.nasdaqDepthLatencyMs ?? null,
    esContextPresent: args.esContextPresent ?? null,
    esContextLatencyMs: args.esContextLatencyMs ?? null,
    cboeOnePresent: args.cboeOnePresent ?? null,
    cboeOneLatencyMs: args.cboeOneLatencyMs ?? null,
    iseComplexBookPresent: args.iseComplexBookPresent ?? null,
    iseComplexBookLatencyMs: args.iseComplexBookLatencyMs ?? null,
    totalviewPoolSize: args.totalviewPoolSize ?? null,
    totalviewPoolCapacity: args.totalviewPoolCapacity ?? null,
    totalviewWasColdStart: args.totalviewWasColdStart ?? null,
    cboeOnePoolSize: args.cboeOnePoolSize ?? null,
    cboeOnePoolCapacity: args.cboeOnePoolCapacity ?? null,
    cboeOneWasColdStart: args.cboeOneWasColdStart ?? null,
  };
  const tapeDiag = buildTapeBackfillDiagnostic(args.tapeBackfillStatus);

  const audit = args.convictionDeskProviderAudit ?? args.anthropicConvictionAudit;
  const extCfg = audit?.thinkingConfig as { type?: string; budget_tokens?: number } | null | undefined;
  const baseModelAttr = args.modelAttribution as {
    mode?: string;
    calls?: ModelCallAttributionRow[];
    note?: string;
  };
  const mergedCalls = Array.isArray(baseModelAttr.calls)
    ? baseModelAttr.calls.map((call) => ({
        ...call,
        extendedThinkingEnabled:
          extCfg != null && (extCfg.type === "enabled" || extCfg.type === "adaptive"),
        extendedThinkingBudgetTokens:
          extCfg?.type === "enabled" && typeof extCfg.budget_tokens === "number"
            ? extCfg.budget_tokens
            : null,
        modelName: audit?.modelName ?? call.providerModel,
      }))
    : baseModelAttr.calls;

  const modelAttribution = {
    ...baseModelAttr,
    calls: mergedCalls,
    note:
      audit != null
        ? "Conviction Desk: usage/cache fields reflect the provider SDK when exposed; audit snapshot mirrors strategist_telemetry."
        : baseModelAttr.note,
  };

  const authoritativeMarketContext =
    (args.dataPackageParsed.authoritativeMarketContext as Record<string, unknown> | undefined) ?? null;
  const datasetFreshness =
    (args.dataPackageParsed.datasetFreshness as Record<string, unknown> | undefined) ?? null;

  return {
    runMetadata: {
      ...args.runMetadata,
      totalRunDurationMs: args.runDurationMs,
    },
    strategistPayload: args.strategistPayload,
    authoritativeMarketContext,
    datasetFreshness,
    tapeBackfillStatus: tapeDiag,
    dataQualitySummary,
    modelAttribution,
    upstreamApiTrace: {
      polygon: args.polygonTrace,
    },
    inputDataPackage: args.dataPackageParsed,
    runOutcome: args.runOutcome,
    runDurationMs: args.runDurationMs,
    error: args.error,
    ...(audit
      ? {
          provider: audit.provider,
          modelInput: audit.modelInput,
          systemPrompt: audit.systemPrompt,
          toolsAttached: audit.toolsAttached,
          thinkingConfig: audit.thinkingConfig,
          extendedThinkingConfig: audit.thinkingConfig,
          rawApiResponse: audit.rawApiResponse,
          thinkingBlocks: audit.thinkingBlocks,
          webSearchQueries: audit.webSearchQueries,
          webSearchResults: audit.webSearchResults,
          providerRequestId: audit.providerRequestId,
          anthropicRequestId: audit.providerRequestId,
          modelName: audit.modelName,
        }
      : {}),
    ...(() => {
      const tel = args.convictionDeskProviderTelemetry ?? args.convictionDeskAnthropicTelemetry;
      if (tel == null || tel.length === 0) return {};
      return {
        convictionDeskProviderTelemetry: tel,
        convictionDeskAnthropicTelemetry: tel,
      };
    })(),
  };
}

export function newStrategistRequestId(): string {
  return randomUUID();
}

export function deriveRunOutcomeFromStrategistResult(
  status: string,
  deskTrade?: boolean,
): StrategistRunOutcomeTelemetry {
  if (status === "recommendation") return "trade";
  if (status === "desk_recommendation") return deskTrade ? "trade" : "pass";
  if (status === "failed_insufficient_history") return "error";
  if (status === "ivr_populating") return "partial";
  if (status === "toxic_block") return "partial";
  if (status === "no_viable_setup") return "partial";
  return "partial";
}

/** Maps DB `result` column values to coarse run outcome for diagnostics. */
export function telemetryDbResultToOutcome(
  result: string,
  deskTrade?: boolean,
): StrategistRunOutcomeTelemetry {
  if (result === "recommendation" || result === "desk_recommendation") {
    return deskTrade !== false ? "trade" : "pass";
  }
  if (result === "no_viable_setup") return "partial";
  if (result === "toxic_block" || result === "no_data") return "partial";
  return "partial";
}
