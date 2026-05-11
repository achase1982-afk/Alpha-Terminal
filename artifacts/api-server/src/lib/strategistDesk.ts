import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallAnthropicConvictionDesk,
  streamCallGeminiDeskJson,
  streamCallGeminiConvictionDesk,
  streamCallOpenAIWithSystemAndWebSearch,
  streamCallXaiWithSystemAndWebSearch,
  extractJson,
  createEmptyEnvelope,
  type WebSearchEnvelopeProvider,
  type WebSearchResult,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";
import { getStrategistModel, type StrategistModelOption, type StrategistConfig } from "./strategistSettings.js";
import {
  VolAnalystOutputSchema,
  FlowAnalystOutputSchema,
  CatalystAnalystOutputSchema,
  PmOutputSchema,
  SoloDeskFullOutputSchema,
  ConvictionDeskOutputSchema,
  type VolAnalystOutput,
  type FlowAnalystOutput,
  type CatalystAnalystOutput,
  type PmOutput,
  type DeskResult,
  type ConvictionDeskResult,
  type ConvictionDeskOutput,
} from "./strategistDeskSchemas.js";
import {
  buildVolAnalystPrompt,
  buildFlowAnalystPrompt,
  buildCatalystAnalystPrompt,
  buildPmPrompt,
  buildPmOrderTicketDeskValidationPrompt,
  buildSoloDeskUserPrompt,
  SOLO_DESK_MODEL_SYSTEM_PROMPT,
  buildConvictionDeskUserPrompt,
  buildConvictionDeskUserPromptBundle,
} from "./strategistDeskPrompts.js";
import {
  mergeValidationTraces,
  soloStyleDeskPmJsonToValidationPayload,
  type ParsedOrderTicketValidationPayload,
} from "./strategistOrderTicketVerdictParse.js";
import { CONVICTION_DESK_MODEL_SYSTEM_PROMPT } from "./convictionDeskSystemPrompt.js";
import { validateConvictionDeskBusinessRules, deriveConvictionDeskSoftWarnings } from "./strategistDeskConvictionRules.js";
import {
  zodIssuesFromError,
  type ConvictionAttemptValidationResult,
  type ConvictionDeskRunDiagnostic,
  type ConvictionDeskRunOutcome,
  type ConvictionZodIssueDiagnostic,
} from "./convictionDeskRunDiagnostic.js";
import type { DebateRound } from "./strategistDebate.js";
import type { CatalystEvaluation } from "./catalystEvaluator.js";
import { runCatalystDeskStructuredSearches } from "./strategistDeskCatalystWebSearch.js";
import { throwIfStrategistAnalyzeCancelled } from "./strategistAnalyzeCancellation.js";
import type Anthropic from "@anthropic-ai/sdk";
import { getStrategistRunContext, mergeStrategistDiag } from "./strategistRunContext.js";
import {
  resolveConvictionDeskRouting,
  strategistProviderToTelemetryProvider,
  type ConvictionDeskRoutingKey,
} from "./convictionDeskRouting.js";

const TEMPERATURE = 0;
/** Conviction memo + greeks grid can exceed default model caps; truncates cause parse/extract failures. Providers may clamp lower at runtime. */
const CONVICTION_DESK_MAX_OUTPUT_TOKENS = 32_000;

export interface DeskCallbacks {
  /** Background analyze job id for cooperative cancel checks. */
  jobId?: string;
  /** Aborts in-flight LLM HTTP when aborted. */
  cancelSignal?: AbortSignal;
  onTurnStart?: (turn: {
    id: string;
    round: DebateRound | "desk";
    role: "vol" | "flow" | "catalyst" | "pm";
    phase: "analyst" | "pm";
    model: string;
    label: string;
    startedAt: number;
  }) => void;
  onTurnDelta?: (turnId: string, delta: string) => void;
  onTurnDone?: (turnId: string, finalText: string) => void;
  /**
   * Remove a turn from the live transcript after a failed attempt that will be
   * retried (e.g. schema validation). Keeps exactly one persisted PM turn per
   * Desk run when the retry succeeds.
   */
  onTurnDiscarded?: (turnId: string) => void;
  onStatus?: (status: string) => void;
}

function assertDeskNotCancelled(callbacks?: DeskCallbacks): void {
  if (callbacks?.cancelSignal?.aborted) {
    const e = new Error("Analysis cancelled");
    e.name = "AbortError";
    throw e;
  }
  throwIfStrategistAnalyzeCancelled(callbacks?.jobId);
}

let turnSeq = 0;
function newTurnId(): string {
  turnSeq += 1;
  return `desk_${Date.now().toString(36)}_${turnSeq}`;
}

/**
 * Desk analyst/PM JSON turns (all roles): routes to provider-specific stream helpers.
 *
 * Web search in the **API request** (not prompt-only):
 * - **Anthropic:** `streamCallAnthropicWithSystemAndWebSearch` sets `tools: [ANTHROPIC_WEB_SEARCH_TOOL]`
 *   (`web_search_20250305`) on `client.messages.stream` (see `aiLabAnalystClient.ts`).
 * - **OpenAI:** `streamCallOpenAIWithSystemAndWebSearch` uses `buildOpenAIResponseParams`, which sets
 *   `tools: [{ type: "web_search_preview" }]` on `responses.create` (see `aiLabAnalystClient.ts`).
 * - **xAI:** `streamCallXaiWithSystemAndWebSearch` sets `tools: { web_search: xai.tools.webSearch() }` on `streamText`.
 * - **Gemini (Solo / four-analyst JSON turns):** `streamCallGeminiDeskJson` cannot attach tools with
 *   `responseMimeType: application/json`; Catalyst may use pre-search for Google in those flows.
 * - **Gemini (Conviction Desk):** `streamCallGeminiConvictionDesk` uses Google Search tools + streamed JSON text.
 */
async function streamModel(
  modelOpt: StrategistModelOption,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (s: string) => void,
  cancelSignal?: AbortSignal,
  opts?: { convictionDeskLargeMemo?: boolean },
): Promise<WebSearchResult> {
  const cap = opts?.convictionDeskLargeMemo === true ? CONVICTION_DESK_MAX_OUTPUT_TOKENS : undefined;
  let r: WebSearchResult;
  if (modelOpt.provider === "anthropic") {
    r = await streamCallAnthropicWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
      cap != null ? { maxTokens: cap } : undefined,
    );
  } else if (modelOpt.provider === "openai") {
    r = await streamCallOpenAIWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
      cap != null ? { maxOutputTokens: cap } : undefined,
    );
  } else if (modelOpt.provider === "xai") {
    r = await streamCallXaiWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
      cap != null ? { maxTokens: cap } : undefined,
    );
  } else {
    r = await streamCallGeminiDeskJson(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
      cap != null ? { maxOutputTokens: cap } : undefined,
    );
  }
  const ctx = getStrategistRunContext();
  if (ctx && r.sdkCallParams) {
    mergeStrategistDiag({
      modelSdkInputs: [...(ctx.diag.modelSdkInputs ?? []), r.sdkCallParams],
    });
  }
  return r;
}

async function runDeskTurn<T>(args: {
  modelOpt: StrategistModelOption;
  prompt: string;
  role: "vol" | "flow" | "catalyst" | "pm";
  label: string;
  callbacks?: DeskCallbacks;
}): Promise<{ text: string; trace: WebSearchTrace; turnId: string }> {
  const { modelOpt, prompt, role, label, callbacks } = args;
  assertDeskNotCancelled(callbacks);
  const turnId = newTurnId();
  callbacks?.onTurnStart?.({
    id: turnId,
    round: "desk",
    role,
    phase: role === "pm" ? "pm" : "analyst",
    model: modelOpt.model,
    label,
    startedAt: Date.now(),
  });

  let acc = "";
  const onDelta = (delta: string) => {
    acc += delta;
    callbacks?.onTurnDelta?.(turnId, delta);
  };

  try {
    const systemPrompt = "You are a specialist analyst on an options trading desk. Respond only with JSON as instructed.";
    const r = await streamModel(modelOpt, systemPrompt, prompt, onDelta, (s) => callbacks?.onStatus?.(s), callbacks?.cancelSignal);
    callbacks?.onTurnDone?.(turnId, r.text);
    return { text: r.text, trace: r.trace, turnId };
  } catch (err) {
    const errMsg = `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`;
    callbacks?.onTurnDone?.(turnId, acc + errMsg);
    throw err;
  }
}

function extractJsonAndParse(raw: string): {
  extractedJsonString: string;
  parsedJson: Record<string, unknown> | null;
} {
  const extractedJsonString = extractJson(raw);
  try {
    const v = JSON.parse(extractedJsonString) as unknown;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return { extractedJsonString, parsedJson: v as Record<string, unknown> };
    }
  } catch {
    /* fall through */
  }
  return { extractedJsonString, parsedJson: null };
}

function parseJsonFromText(raw: string): Record<string, unknown> | null {
  return extractJsonAndParse(raw).parsedJson;
}

export async function runDeskAnalysis(args: {
  dataPackage: string;
  settings: StrategistConfig;
  ticker: string;
  /** Same ISO date passed to evaluateCatalyst for Desk (position window right edge). */
  deskExpirationISO?: string;
  catalystEvaluation?: CatalystEvaluation | null;
  callbacks?: DeskCallbacks;
  /**
   * When set, PM runs **order-ticket validation** (same verdict JSON shape as /validate-trade solo)
   * instead of proposing a fresh desk structure. Used so order tickets honor Strategist Mode "Desk".
   */
  orderTicketValidationMarkdown?: string;
}): Promise<DeskResult & { orderTicketValidationVerdict?: ParsedOrderTicketValidationPayload }> {
  const { dataPackage, settings, ticker, deskExpirationISO, catalystEvaluation, callbacks, orderTicketValidationMarkdown } = args;
  assertDeskNotCancelled(callbacks);

  const volModel = getStrategistModel(settings.strategistSoloModelIdx);
  const flowModel = getStrategistModel(settings.strategistDebateAModelIdx);
  const catalystModel = getStrategistModel(settings.strategistDebateBModelIdx);
  const pmModelIdx = settings.strategistArbitratorModelIdx === -1 ? 0 : settings.strategistArbitratorModelIdx;
  const pmModel = getStrategistModel(pmModelIdx);

  const errors: string[] = [];

  let catalystResearchBriefing = "";
  let catalystSearchTrace: WebSearchTrace = { webSearchUsed: false, queries: [], sources: [] };
  const catalystNativeWeb = catalystModel.provider !== "google";

  if (deskExpirationISO && catalystModel.provider === "google") {
    callbacks?.onStatus?.("Desk: Catalyst structured web research (Gemini JSON cannot use tools)…");
    try {
      const bundle = await runCatalystDeskStructuredSearches({
        ticker,
        catalystEval: catalystEvaluation ?? null,
        deskExpirationISO,
        model: catalystModel,
        onStatus: callbacks?.onStatus,
        cancelSignal: callbacks?.cancelSignal,
      });
      catalystResearchBriefing = bundle.briefing;
      catalystSearchTrace = bundle.trace;
    } catch (err) {
      logger.warn(
        { err, ticker },
        "StrategistDesk: structured catalyst web search bundle failed; continuing with calendar snapshot only",
      );
      catalystResearchBriefing =
        "## STRUCTURED RESEARCH (catalyst desk)\nResearch pass failed; treat web-derived themes as **data not surfaced** unless the calendar snapshot alone supports them.";
    }
  } else if (deskExpirationISO && catalystNativeWeb) {
    logger.info(
      { ticker, catalystProvider: catalystModel.provider },
      "StrategistDesk: skipping catalyst structured pre-search; Catalyst slot uses native web search on JSON turn",
    );
    callbacks?.onStatus?.("Desk: Catalyst web pre-search skipped (native web search on analyst turn)…");
  }

  const catalystPrompt = buildCatalystAnalystPrompt(
    dataPackage,
    catalystResearchBriefing || undefined,
    { catalystSlotNativeWebSearch: catalystNativeWeb },
  );

  let tapeStatus: string | undefined;
  try {
    const pkg = JSON.parse(dataPackage) as { tapeBackfill?: { status?: string } };
    tapeStatus = pkg.tapeBackfill?.status;
  } catch {
    tapeStatus = undefined;
  }
  if (tapeStatus === "partial" || tapeStatus === "failed") {
    callbacks?.onStatus?.(
      `Desk: Flow tape coverage is ${tapeStatus}. Flow analyst will note limits in its read.`,
    );
  }

  assertDeskNotCancelled(callbacks);
  callbacks?.onStatus?.("Desk: Vol and Catalyst analysts running…");

  const [volResult, catalystResult] = await Promise.all([
    runAnalystWithRetry(ticker, "vol", volModel, buildVolAnalystPrompt(dataPackage), VolAnalystOutputSchema, callbacks, errors),
    runAnalystWithRetry(ticker, "catalyst", catalystModel, catalystPrompt, CatalystAnalystOutputSchema, callbacks, errors, catalystSearchTrace),
  ]);

  assertDeskNotCancelled(callbacks);
  callbacks?.onStatus?.("Desk: Flow analyst running…");
  const flowResult = await runAnalystWithRetry(
    ticker,
    "flow",
    flowModel,
    buildFlowAnalystPrompt(dataPackage),
    FlowAnalystOutputSchema,
    callbacks,
    errors,
  );

  callbacks?.onStatus?.(
    orderTicketValidationMarkdown ? "Desk: PM validating trader's order ticket…" : "Desk: PM synthesizing analyst reads…",
  );

  let pmParsed: PmOutput;
  let orderTicketValidationVerdict: ParsedOrderTicketValidationPayload | undefined;

  if (orderTicketValidationMarkdown) {
    const pmPromptVal = buildPmOrderTicketDeskValidationPrompt(
      dataPackage,
      JSON.stringify(volResult.parsed),
      JSON.stringify(flowResult.parsed),
      JSON.stringify(catalystResult.parsed),
      orderTicketValidationMarkdown,
    );
    assertDeskNotCancelled(callbacks);
    let pmTurn = await runDeskTurn({
      modelOpt: pmModel,
      prompt: pmPromptVal,
      role: "pm",
      label: "Order ticket review",
      callbacks,
    });
    let pmJson = parseJsonFromText(pmTurn.text);
    let parsedObj = pmJson && typeof pmJson === "object" ? (pmJson as Record<string, unknown>) : null;
    let mergedTrace = mergeValidationTraces(volResult.trace, flowResult.trace, catalystResult.trace, pmTurn.trace);
    let verdictPayload = soloStyleDeskPmJsonToValidationPayload(parsedObj, mergedTrace);

    const complete =
      parsedObj &&
      typeof parsedObj["finalVerdict"] === "string" &&
      Array.isArray(parsedObj["reasoningBullets"]) &&
      (parsedObj["reasoningBullets"] as unknown[]).length > 0;

    if (!complete) {
      callbacks?.onTurnDiscarded?.(pmTurn.turnId);
      callbacks?.onStatus?.("Desk: PM order-ticket verdict JSON incomplete, retrying…");
      pmTurn = await runDeskTurn({
        modelOpt: pmModel,
        prompt:
          pmPromptVal +
          "\n\nYour previous response was incomplete or not valid JSON. Return ONLY one JSON object with all required keys: bullCase, bearCase, bullConfidence, bearConfidence, finalVerdict, finalConfidence, reasoningBullets, topRisks, improvements.",
        role: "pm",
        label: "Order ticket review (retry)",
        callbacks,
      });
      pmJson = parseJsonFromText(pmTurn.text);
      parsedObj = pmJson && typeof pmJson === "object" ? (pmJson as Record<string, unknown>) : null;
      verdictPayload = soloStyleDeskPmJsonToValidationPayload(
        parsedObj,
        mergeValidationTraces(mergedTrace, pmTurn.trace),
      );
    }

    orderTicketValidationVerdict = verdictPayload;
    pmParsed = {
      decision: verdictPayload.verdict === "DO_NOT_PROCEED" ? "pass" : "trade",
      structure: null,
      thesis: verdictPayload.reasoningBullets.join(" ") || "Order ticket validation verdict.",
      edge_check: "",
      deviation_from_analysts: "none",
      size: "small",
      whose_side: "neither",
      biggest_risk: verdictPayload.risks[0] ?? "",
      exit_plan: { profit_target: 0, stop_loss: 0, time_stop: "" },
      watch_for: verdictPayload.improvements.join("; ") || "",
    };
  } else {
    const pmPrompt = buildPmPrompt(
      dataPackage,
      JSON.stringify(volResult.parsed),
      JSON.stringify(flowResult.parsed),
      JSON.stringify(catalystResult.parsed),
    );

    assertDeskNotCancelled(callbacks);
    const pmTurn = await runDeskTurn({
      modelOpt: pmModel,
      prompt: pmPrompt,
      role: "pm",
      label: "Decision",
      callbacks,
    });

    const pmJson = parseJsonFromText(pmTurn.text);
    const pmValidation = PmOutputSchema.safeParse(pmJson);
    if (pmValidation.success) {
      pmParsed = pmValidation.data;
    } else {
      callbacks?.onTurnDiscarded?.(pmTurn.turnId);
      callbacks?.onStatus?.("Desk: PM output failed validation, retrying…");
      logger.warn(
        { errors: pmValidation.error.issues, ticker, model: pmModel.model, provider: pmModel.provider, label: pmModel.label },
        "StrategistDesk: PM output failed validation, retrying",
      );
      const retryTurn = await runDeskTurn({
        modelOpt: pmModel,
        prompt:
          pmPrompt +
          "\n\nYour previous response failed JSON validation. Return ONLY valid JSON matching the schema exactly. No markdown, no code fences, no commentary before or after the JSON.",
        role: "pm",
        label: "Decision (retry)",
        callbacks,
      });
      const retryJson = parseJsonFromText(retryTurn.text);
      const retryValidation = PmOutputSchema.safeParse(retryJson);
      if (retryValidation.success) {
        pmParsed = retryValidation.data;
      } else {
        errors.push(`PM output failed validation after retry: ${retryValidation.error.issues.map(i => i.message).join("; ")}`);
        pmParsed = {
          decision: "pass",
          structure: null,
          thesis: retryTurn.text.slice(0, 500),
          edge_check: "",
          deviation_from_analysts: "none",
          size: "small",
          whose_side: "neither",
          biggest_risk: "PM output could not be parsed",
          exit_plan: { profit_target: 0, stop_loss: 0, time_stop: "" },
          watch_for: "PM validation failure; retry the analysis",
        };
      }
    }
  }

  const pmOutputIncomplete =
    !orderTicketValidationMarkdown && errors.some((e) => e.startsWith("PM output failed validation after retry"));

  logger.info(
    {
      ticker,
      deskModels: {
        vol: { provider: volModel.provider, model: volModel.model, label: volModel.label },
        flow: { provider: flowModel.provider, model: flowModel.model, label: flowModel.label },
        catalyst: { provider: catalystModel.provider, model: catalystModel.model, label: catalystModel.label },
        pm: { provider: pmModel.provider, model: pmModel.model, label: pmModel.label },
      },
    },
    "StrategistDesk: completed desk run (model attribution for telemetry)",
  );

  return {
    mode: "desk",
    ticker,
    vol: volResult.parsed,
    flow: flowResult.parsed,
    catalyst: catalystResult.parsed,
    pm: pmParsed,
    ...(pmOutputIncomplete ? { pmOutputIncomplete: true as const } : {}),
    models: {
      vol: volModel.label,
      flow: flowModel.label,
      catalyst: catalystModel.label,
      pm: pmModel.label,
    },
    errors: errors.length > 0 ? errors : undefined,
    ...(orderTicketValidationVerdict ? { orderTicketValidationVerdict } : {}),
  };
}

async function runAnalystWithRetry<T>(
  ticker: string,
  role: "vol" | "flow" | "catalyst",
  model: StrategistModelOption,
  prompt: string,
  schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } },
  callbacks: DeskCallbacks | undefined,
  errors: string[],
  initialTrace?: WebSearchTrace,
): Promise<{ parsed: T; trace: WebSearchTrace }> {
  const labels: Record<string, string> = {
    vol: "Volatility",
    flow: "Flow",
    catalyst: "Catalyst",
  };
  const label = labels[role];

  const turn = await runDeskTurn({ modelOpt: model, prompt, role, label, callbacks });
  const json = parseJsonFromText(turn.text);
  const validation = schema.safeParse(json);

  if (validation.success) {
    return {
      parsed: validation.data,
      trace: initialTrace ? mergeValidationTraces(initialTrace, turn.trace) : turn.trace,
    };
  }

  callbacks?.onTurnDiscarded?.(turn.turnId);
  logger.warn(
    { role, ticker, model: model.model, provider: model.provider, label: model.label, errors: validation.error.issues },
    `StrategistDesk: ${role} output failed validation, retrying`,
  );
  callbacks?.onStatus?.(`Desk: ${labels[role]} output failed validation, retrying…`);

  const retryTurn = await runDeskTurn({
    modelOpt: model,
    prompt:
      prompt +
      "\n\nYour previous response failed JSON validation. Return ONLY valid JSON matching the schema exactly. No markdown, no code fences, no commentary before or after the JSON.",
    role,
    label: `${labels[role]} (retry)`,
    callbacks,
  });

  const retryJson = parseJsonFromText(retryTurn.text);
  const retryValidation = schema.safeParse(retryJson);

  if (retryValidation.success) {
    const merged = mergeValidationTraces(turn.trace, retryTurn.trace);
    return {
      parsed: retryValidation.data,
      trace: initialTrace ? mergeValidationTraces(initialTrace, merged) : merged,
    };
  }

  const errorMsg = `${labels[role]} output failed validation after retry: ${retryValidation.error.issues.map(i => i.message).join("; ")}`;
  errors.push(errorMsg);
  logger.error({ role, ticker, model: model.model, provider: model.provider, label: model.label }, `StrategistDesk: ${errorMsg}`);

  const fallback = buildFallbackOutput(role, retryTurn.text);
  const mergedFail = mergeValidationTraces(turn.trace, retryTurn.trace);
  return {
    parsed: fallback as T,
    trace: initialTrace ? mergeValidationTraces(initialTrace, mergedFail) : mergedFail,
  };
}

function buildFallbackOutput(role: "vol" | "flow" | "catalyst", rawText: string): unknown {
  const snippet = rawText.slice(0, 500);
  if (role === "vol") {
    return {
      iv_state: "Unable to parse; see raw output",
      term_structure: "Unable to parse",
      skew: "Unable to parse",
      implied_vs_realized: "Unable to parse",
      read: snippet,
    };
  }
  if (role === "flow") {
    return {
      dominant_flow: "Unable to parse; see raw output",
      institutional_signal: "Unable to parse",
      retail_signal: "Unable to parse",
      key_strikes: [],
      read: snippet,
    };
  }
  return {
    primary_catalyst: "Unable to parse; see raw output",
    bar_to_clear: "Unable to parse",
    asymmetry: "Unable to parse",
    historical_pattern: "Unable to parse",
    read: snippet,
  };
}

/**
 * Solo Desk: one LLM turn with the Solo model slot (`strategistSoloModelIdx`), same nested DeskResult shape as `runDeskAnalysis`.
 * Data parity with multi-turn Desk (including Gemini catalyst pre-search when applicable).
 */
export async function runSoloDesk(args: {
  dataPackage: string;
  settings: StrategistConfig;
  ticker: string;
  deskExpirationISO?: string;
  catalystEvaluation?: CatalystEvaluation | null;
  callbacks?: DeskCallbacks;
}): Promise<DeskResult> {
  const { dataPackage, settings, ticker, deskExpirationISO, catalystEvaluation, callbacks } = args;

  const consolidatedModel = getStrategistModel(settings.strategistSoloModelIdx);

  let catalystResearchBriefing = "";
  const catalystNativeWeb = consolidatedModel.provider !== "google";

  if (deskExpirationISO && consolidatedModel.provider === "google") {
    callbacks?.onStatus?.("Solo Desk: Catalyst structured web research (Gemini JSON cannot use tools)…");
    try {
      const bundle = await runCatalystDeskStructuredSearches({
        ticker,
        catalystEval: catalystEvaluation ?? null,
        deskExpirationISO,
        model: consolidatedModel,
        onStatus: callbacks?.onStatus,
        cancelSignal: callbacks?.cancelSignal,
      });
      catalystResearchBriefing = bundle.briefing;
    } catch (err) {
      logger.warn(
        { err, ticker },
        "StrategistDesk: Solo Desk structured catalyst web search bundle failed; continuing with calendar snapshot only",
      );
      catalystResearchBriefing =
        "## STRUCTURED RESEARCH (catalyst desk)\nResearch pass failed; treat web-derived themes as **data not surfaced** unless the calendar snapshot alone supports them.";
    }
  } else if (deskExpirationISO && catalystNativeWeb) {
    logger.info(
      { ticker, provider: consolidatedModel.provider },
      "StrategistDesk: Solo Desk skipping catalyst structured pre-search; consolidated model uses native web search on JSON turn",
    );
    callbacks?.onStatus?.("Solo Desk: Catalyst web pre-search skipped (native web search on consolidated turn)…");
  }

  const userPrompt = buildSoloDeskUserPrompt(dataPackage, catalystResearchBriefing || undefined, {
    catalystSlotNativeWebSearch: catalystNativeWeb,
  });

  callbacks?.onStatus?.("Solo Desk: single consolidated pass (Vol, Flow, Catalyst, PM)…");

  assertDeskNotCancelled(callbacks);

  const turnId = newTurnId();
  callbacks?.onTurnStart?.({
    id: turnId,
    round: "desk",
    role: "pm",
    phase: "pm",
    model: consolidatedModel.model,
    label: "Solo Desk",
    startedAt: Date.now(),
  });

  let acc = "";
  const onDelta = (delta: string) => {
    acc += delta;
    callbacks?.onTurnDelta?.(turnId, delta);
  };

  let text = "";
  try {
    const r = await streamModel(
      consolidatedModel,
      SOLO_DESK_MODEL_SYSTEM_PROMPT,
      userPrompt,
      onDelta,
      (s) => callbacks?.onStatus?.(s),
      callbacks?.cancelSignal,
    );
    text = r.text;
    callbacks?.onTurnDone?.(turnId, text);
  } catch (err) {
    const errMsg = `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`;
    callbacks?.onTurnDone?.(turnId, acc + errMsg);
    throw err;
  }

  const errors: string[] = [];
  let json = parseJsonFromText(text);
  let validation = SoloDeskFullOutputSchema.safeParse(json);

  if (!validation.success) {
    callbacks?.onTurnDiscarded?.(turnId);
    logger.warn(
      { ticker, issues: validation.error.issues, model: consolidatedModel.model, provider: consolidatedModel.provider },
      "StrategistDesk: Solo Desk output failed validation, retrying",
    );
    callbacks?.onStatus?.("Solo Desk: consolidated output failed validation, retrying…");
    assertDeskNotCancelled(callbacks);
    const retryTurnId = newTurnId();
    callbacks?.onTurnStart?.({
      id: retryTurnId,
      round: "desk",
      role: "pm",
      phase: "pm",
      model: consolidatedModel.model,
      label: "Solo Desk (retry)",
      startedAt: Date.now(),
    });
    const onRetryDelta = (delta: string) => {
      callbacks?.onTurnDelta?.(retryTurnId, delta);
    };
    const retryPrompt =
      userPrompt +
      "\n\nYour previous response failed JSON validation. Return ONLY one valid JSON object with top-level keys vol, flow, catalyst, and pm, each matching the Desk shapes exactly. No markdown, no code fences, no commentary before or after the JSON.";
    const retryR = await streamModel(
      consolidatedModel,
      SOLO_DESK_MODEL_SYSTEM_PROMPT,
      retryPrompt,
      onRetryDelta,
      (s) => callbacks?.onStatus?.(s),
      callbacks?.cancelSignal,
    );
    callbacks?.onTurnDone?.(retryTurnId, retryR.text);
    json = parseJsonFromText(retryR.text);
    validation = SoloDeskFullOutputSchema.safeParse(json);
  }

  if (!validation.success) {
    errors.push(`Solo Desk output failed validation after retry: ${validation.error.issues.map((i) => i.message).join("; ")}`);
    const stubPm: PmOutput = {
      decision: "pass",
      structure: null,
      thesis: (text || "").slice(0, 500),
      edge_check: "",
      deviation_from_analysts: "none",
      size: "small",
      whose_side: "neither",
      biggest_risk: "Solo Desk output could not be parsed",
      exit_plan: { profit_target: 0, stop_loss: 0, time_stop: "" },
      watch_for: "Schema validation failure; retry the analysis",
    };
    return {
      mode: "solo_desk",
      ticker,
      vol: buildFallbackOutput("vol", text) as VolAnalystOutput,
      flow: buildFallbackOutput("flow", text) as FlowAnalystOutput,
      catalyst: buildFallbackOutput("catalyst", text) as CatalystAnalystOutput,
      pm: stubPm,
      pmOutputIncomplete: true,
      soloDeskJsonDegraded: "schema_validation_failed_after_retry",
      models: {
        vol: consolidatedModel.label,
        flow: consolidatedModel.label,
        catalyst: consolidatedModel.label,
        pm: consolidatedModel.label,
      },
      errors,
    };
  }

  const { vol, flow, catalyst, pm } = validation.data;

  logger.info(
    {
      ticker,
      soloDeskModel: { provider: consolidatedModel.provider, model: consolidatedModel.model, label: consolidatedModel.label },
      soloDeskPromptChars: userPrompt.length,
    },
    "StrategistDesk: completed Solo Desk run",
  );

  return {
    mode: "solo_desk",
    ticker,
    vol,
    flow,
    catalyst,
    pm,
    models: {
      vol: consolidatedModel.label,
      flow: consolidatedModel.label,
      catalyst: consolidatedModel.label,
      pm: consolidatedModel.label,
    },
    errors: errors.length > 0 ? errors : undefined,
  };
}

function validateConvictionPipeline(
  json: Record<string, unknown> | null,
):
  | { ok: true; data: ConvictionDeskOutput }
  | { ok: false; detail: string; zodIssues: ConvictionZodIssueDiagnostic[]; businessRuleErrors: string[] } {
  if (!json) {
    return {
      ok: false,
      detail: "Could not parse a single JSON object from the model response",
      zodIssues: [],
      businessRuleErrors: [],
    };
  }
  const zod = ConvictionDeskOutputSchema.safeParse(json);
  if (!zod.success) {
    return {
      ok: false,
      detail: zod.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
      zodIssues: zodIssuesFromError(zod.error),
      businessRuleErrors: [],
    };
  }
  const biz = validateConvictionDeskBusinessRules(zod.data);
  if (biz.length > 0) {
    return {
      ok: false,
      detail: biz.join("; "),
      zodIssues: [],
      businessRuleErrors: biz,
    };
  }
  return { ok: true, data: zod.data };
}

function validationResultForAttempt(
  v: ReturnType<typeof validateConvictionPipeline>,
): ConvictionAttemptValidationResult {
  if (v.ok) {
    return { ok: true, zodIssues: [], businessRuleErrors: [] };
  }
  return {
    ok: false,
    zodIssues: v.zodIssues,
    businessRuleErrors: v.businessRuleErrors,
  };
}

function formatConvictionValidationCorrectionMessage(
  v: Extract<ReturnType<typeof validateConvictionPipeline>, { ok: false }>,
): string {
  const lines: string[] = [];
  for (const z of v.zodIssues) {
    lines.push(`- ${z.path.length ? z.path.join(".") : "(root)"}: ${z.message}`);
  }
  for (const b of v.businessRuleErrors) {
    lines.push(`- ${b}`);
  }
  if (lines.length === 0) lines.push(`- ${v.detail}`);
  return `Your previous response failed validation against the schema. Specific errors:\n\n${lines.join("\n")}\n\nReturn ONLY a corrected JSON object matching the schema exactly. No commentary, no markdown, no preamble. Use the exact field names and enum values from the schema.`;
}

function strategistProviderToEnvelopeProvider(provider: StrategistModelOption["provider"]): WebSearchEnvelopeProvider {
  return provider === "google" ? "gemini" : provider;
}

function convictionOutcomeFromAttemptsWhenFailed(
  attempts: ConvictionDeskRunDiagnostic["attempts"],
): ConvictionDeskRunOutcome {
  const last = attempts[attempts.length - 1];
  if (!last) return "validation_failed_after_retry";
  if (last.parsedJson == null) return "extraction_error";
  return "validation_failed_after_retry";
}

/**
 * Conviction Desk: one LLM turn with the Conviction model slot (`strategistConvictionModelIdx`),
 * same catalyst web-search preamble as Solo Desk when using Gemini JSON-only flow.
 * Packaged live-equity JSON keys are documented for the model in `CONVICTION_DESK_INTRADAY_DATA_GUIDANCE` (strategistDeskPrompts.ts).
 */
export async function runConvictionDesk(args: {
  dataPackage: string;
  settings: StrategistConfig;
  ticker: string;
  deskExpirationISO?: string;
  catalystEvaluation?: CatalystEvaluation | null;
  callbacks?: DeskCallbacks;
  /** Optional per-run model routing (API body); otherwise `strategistConvictionModelIdx`. */
  convictionDeskProvider?: ConvictionDeskRoutingKey | null;
}): Promise<ConvictionDeskResult> {
  const { dataPackage, settings, ticker, deskExpirationISO, catalystEvaluation, callbacks, convictionDeskProvider } =
    args;
  const startedAtIso = new Date().toISOString();

  const routing = resolveConvictionDeskRouting(settings, convictionDeskProvider ?? null);
  const consolidatedModel = routing.model;

  let catalystResearchBriefing = "";
  const catalystNativeWeb = true;

  if (deskExpirationISO && consolidatedModel.provider !== "google") {
    logger.info(
      { ticker, provider: consolidatedModel.provider },
      "StrategistDesk: Conviction Desk skipping catalyst structured pre-search; consolidated model uses native web search on consolidated turn",
    );
    callbacks?.onStatus?.("Conviction Desk: Catalyst web pre-search skipped (native web search on consolidated turn)…");
  } else if (deskExpirationISO && consolidatedModel.provider === "google") {
    callbacks?.onStatus?.(
      "Conviction Desk: in-call Google Search grounding (structured catalyst pre-search skipped)…",
    );
  }

  const promptBundle = buildConvictionDeskUserPromptBundle(dataPackage, catalystResearchBriefing || undefined, {
    catalystSlotNativeWebSearch: catalystNativeWeb,
    provider: consolidatedModel.provider,
  });
  const userPrompt = promptBundle.fullUserPrompt;

  callbacks?.onStatus?.("Conviction Desk: single consolidated memo pass…");

  assertDeskNotCancelled(callbacks);

  const errors: string[] = [];
  const attempts: ConvictionDeskRunDiagnostic["attempts"] = [];

  const initialAnthropicMessages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: promptBundle.anthropicStaticUserPrefix, cache_control: { type: "ephemeral" } },
        { type: "text", text: promptBundle.anthropicDynamicUserSuffix },
      ],
    },
  ];
  let anthropicMessages: Anthropic.MessageParam[] = initialAnthropicMessages;

  let text = "";
  let r: WebSearchResult | undefined;
  let lastFailed: Extract<ReturnType<typeof validateConvictionPipeline>, { ok: false }> | undefined;
  let lastConvictionDeskAudit: ConvictionDeskResult["convictionDeskAudit"];

  for (let attemptNum = 1; attemptNum <= 3; attemptNum++) {
    const turnId = newTurnId();
    const label = attemptNum === 1 ? "Conviction Desk" : `Conviction Desk (retry ${attemptNum - 1})`;
    callbacks?.onTurnStart?.({
      id: turnId,
      round: "desk",
      role: "pm",
      phase: "pm",
      model: consolidatedModel.model,
      label,
      startedAt: Date.now(),
    });

    let acc = "";
    const onDelta = (delta: string) => {
      acc += delta;
      callbacks?.onTurnDelta?.(turnId, delta);
    };

    try {
      if (consolidatedModel.provider === "anthropic") {
        r = await streamCallAnthropicConvictionDesk(
          consolidatedModel.model,
          CONVICTION_DESK_MODEL_SYSTEM_PROMPT,
          anthropicMessages,
          onDelta,
          (s) => callbacks?.onStatus?.(s),
          callbacks?.cancelSignal,
          {
            maxTokens: CONVICTION_DESK_MAX_OUTPUT_TOKENS,
            thinkingBudgetTokensOverride: routing.anthropicThinkingBudgetOverride,
          },
        );
        if (r.convictionDeskAudit) lastConvictionDeskAudit = r.convictionDeskAudit;
      } else if (consolidatedModel.provider === "openai") {
        const streamPrompt =
          attemptNum === 1
            ? promptBundle.fullUserPrompt
            : `${promptBundle.fullUserPrompt}\n\n---\n\n${formatConvictionValidationCorrectionMessage(lastFailed!)}`;
        r = await streamCallOpenAIWithSystemAndWebSearch(
          consolidatedModel.model,
          TEMPERATURE,
          CONVICTION_DESK_MODEL_SYSTEM_PROMPT,
          streamPrompt,
          onDelta,
          (s) => callbacks?.onStatus?.(s),
          callbacks?.cancelSignal,
          { maxOutputTokens: CONVICTION_DESK_MAX_OUTPUT_TOKENS },
        );
        if (r.convictionDeskAudit) lastConvictionDeskAudit = r.convictionDeskAudit;
      } else if (consolidatedModel.provider === "google") {
        const streamPrompt =
          attemptNum === 1
            ? promptBundle.fullUserPrompt
            : `${promptBundle.fullUserPrompt}\n\n---\n\n${formatConvictionValidationCorrectionMessage(lastFailed!)}`;
        r = await streamCallGeminiConvictionDesk(
          consolidatedModel.model,
          TEMPERATURE,
          CONVICTION_DESK_MODEL_SYSTEM_PROMPT,
          streamPrompt,
          onDelta,
          (s) => callbacks?.onStatus?.(s),
          callbacks?.cancelSignal,
          { maxOutputTokens: CONVICTION_DESK_MAX_OUTPUT_TOKENS },
        );
        if (r.convictionDeskAudit) lastConvictionDeskAudit = r.convictionDeskAudit;
      } else {
        const streamPrompt =
          attemptNum === 1
            ? promptBundle.fullUserPrompt
            : `${promptBundle.fullUserPrompt}\n\n---\n\n${formatConvictionValidationCorrectionMessage(lastFailed!)}`;
        r = await streamModel(
          consolidatedModel,
          CONVICTION_DESK_MODEL_SYSTEM_PROMPT,
          streamPrompt,
          onDelta,
          (s) => callbacks?.onStatus?.(s),
          callbacks?.cancelSignal,
          { convictionDeskLargeMemo: true },
        );
      }

      text = r.text;
      callbacks?.onTurnDone?.(turnId, text);

      if (
        consolidatedModel.provider === "anthropic" ||
        consolidatedModel.provider === "openai" ||
        consolidatedModel.provider === "google" ||
        consolidatedModel.provider === "xai"
      ) {
        const webUses =
          consolidatedModel.provider === "anthropic"
            ? (r.anthropicWebSearchToolUseCount ?? 0)
            : Array.isArray(r.convictionDeskAudit?.webSearchQueries)
              ? (r.convictionDeskAudit!.webSearchQueries as unknown[]).length
              : r.trace.queries.length;
        logger.info(
          {
            ticker,
            attempt: attemptNum,
            cache_creation_input_tokens: r.envelope.usage.cacheCreationInputTokens ?? null,
            cache_read_input_tokens: r.envelope.usage.cacheReadInputTokens ?? null,
            input_tokens: r.envelope.usage.inputTokens ?? null,
            output_tokens: r.envelope.usage.outputTokens ?? null,
            reasoning_tokens: r.envelope.usage.reasoningTokens ?? null,
            total_tokens: r.envelope.usage.totalTokens ?? null,
            web_search_tool_uses: webUses,
            provider: consolidatedModel.provider,
          },
          "Conviction Desk usage",
        );
        const ctx = getStrategistRunContext();
        const prev = ctx?.diag.convictionDeskProviderTelemetry ?? [];
        mergeStrategistDiag({
          convictionDeskProviderTelemetry: [
            ...prev,
            {
              attempt: attemptNum,
              provider: strategistProviderToTelemetryProvider(consolidatedModel.provider),
              cache_creation_input_tokens: r.envelope.usage.cacheCreationInputTokens ?? null,
              cache_read_input_tokens: r.envelope.usage.cacheReadInputTokens ?? null,
              input_tokens: r.envelope.usage.inputTokens ?? null,
              output_tokens: r.envelope.usage.outputTokens ?? null,
              reasoning_tokens: r.envelope.usage.reasoningTokens ?? null,
              total_tokens: r.envelope.usage.totalTokens ?? null,
              web_search_tool_uses: webUses,
            },
          ],
        });
      }

      const ext = extractJsonAndParse(text);
      const validation = validateConvictionPipeline(ext.parsedJson);
      attempts.push({
        attemptNumber: attemptNum as 1 | 2 | 3,
        rawResponseText: text,
        envelope: r.envelope,
        extractedJsonString: ext.extractedJsonString,
        parsedJson: ext.parsedJson,
        validationResult: validationResultForAttempt(validation),
      });

      if (validation.ok) {
        break;
      }

      lastFailed = validation;

      if (attemptNum === 3) {
        logger.warn(
          { ticker, detail: validation.detail, model: consolidatedModel.model, provider: consolidatedModel.provider },
          "StrategistDesk: Conviction Desk validation failed after max attempts",
        );
        break;
      }

      logger.warn(
        { ticker, detail: validation.detail, model: consolidatedModel.model, provider: consolidatedModel.provider },
        "StrategistDesk: Conviction Desk output failed validation, retrying",
      );
      callbacks?.onStatus?.("Conviction Desk: memo output failed validation, retrying…");
      assertDeskNotCancelled(callbacks);
      callbacks?.onTurnDiscarded?.(turnId);

      if (consolidatedModel.provider === "anthropic") {
        anthropicMessages = [
          ...initialAnthropicMessages,
          { role: "assistant", content: text },
          { role: "user", content: formatConvictionValidationCorrectionMessage(validation) },
        ];
      }
    } catch (err) {
      const errPlain = err instanceof Error ? err.message : String(err);
      const errMsg = `\n\n[error: ${errPlain}]`;
      callbacks?.onTurnDone?.(turnId, acc + errMsg);
      const finishedAt = new Date().toISOString();
      const ex = extractJsonAndParse(acc);
      const valStream = validateConvictionPipeline(ex.parsedJson);
      attempts.push({
        attemptNumber: attemptNum as 1 | 2 | 3,
        rawResponseText: acc,
        envelope:
          r?.envelope ??
          createEmptyEnvelope(strategistProviderToEnvelopeProvider(consolidatedModel.provider), consolidatedModel.model),
        extractedJsonString: ex.extractedJsonString,
        parsedJson: ex.parsedJson,
        validationResult: validationResultForAttempt(valStream),
      });
      return {
        mode: "conviction_desk",
        ticker,
        conviction: null,
        convictionDeskJsonDegraded: "stream_error",
        models: {
          vol: consolidatedModel.label,
          flow: consolidatedModel.label,
          catalyst: consolidatedModel.label,
          pm: consolidatedModel.label,
        },
        errors: [`Conviction Desk stream failed (attempt ${attemptNum}): ${errPlain}`],
        convictionDeskRunDiagnostic: {
          ticker,
          modelId: consolidatedModel.model,
          provider: consolidatedModel.provider,
          startedAt: startedAtIso,
          finishedAt,
          outcome: "stream_error",
          attempts,
          finalErrors: [`Conviction Desk stream failed (attempt ${attemptNum}): ${errPlain}`],
        },
        ...(lastConvictionDeskAudit ? { convictionDeskAudit: lastConvictionDeskAudit } : {}),
      };
    }
  }

  const extLast = extractJsonAndParse(text);
  let validation = validateConvictionPipeline(extLast.parsedJson);

  const finishedAt = new Date().toISOString();

  if (!validation.ok) {
    errors.push(`Conviction Desk output failed validation after retry: ${validation.detail}`);
    logger.error(
      { ticker, model: consolidatedModel.model, provider: consolidatedModel.provider },
      "StrategistDesk: Conviction Desk validation failed after retry (no fallback memo)",
    );
    const outcome: ConvictionDeskRunOutcome = convictionOutcomeFromAttemptsWhenFailed(attempts);
    const degraded =
      outcome === "extraction_error"
        ? ("extraction_error" as const)
        : ("schema_validation_failed_after_retry" as const);
    return {
      mode: "conviction_desk",
      ticker,
      conviction: null,
      convictionDeskJsonDegraded: degraded,
      models: {
        vol: consolidatedModel.label,
        flow: consolidatedModel.label,
        catalyst: consolidatedModel.label,
        pm: consolidatedModel.label,
      },
      errors,
      convictionDeskRunDiagnostic: {
        ticker,
        modelId: consolidatedModel.model,
        provider: consolidatedModel.provider,
        startedAt: startedAtIso,
        finishedAt,
        outcome,
        attempts,
        finalErrors: errors,
      },
      ...(lastConvictionDeskAudit ? { convictionDeskAudit: lastConvictionDeskAudit } : {}),
    };
  }

  const softWarnings = deriveConvictionDeskSoftWarnings(validation.data, dataPackage);

  logger.info(
    {
      ticker,
      convictionDeskModel: { provider: consolidatedModel.provider, model: consolidatedModel.model, label: consolidatedModel.label },
      convictionDeskPromptChars: userPrompt.length,
      ...(softWarnings.length > 0 ? { convictionDeskSoftWarnings: softWarnings } : {}),
    },
    "StrategistDesk: completed Conviction Desk run",
  );

  return {
    mode: "conviction_desk",
    ticker,
    conviction: validation.data,
    models: {
      vol: consolidatedModel.label,
      flow: consolidatedModel.label,
      catalyst: consolidatedModel.label,
      pm: consolidatedModel.label,
    },
    errors: errors.length > 0 ? errors : undefined,
    convictionDeskRunDiagnostic: {
      ticker,
      modelId: consolidatedModel.model,
      provider: consolidatedModel.provider,
      startedAt: startedAtIso,
      finishedAt,
      outcome: "success",
      attempts,
      finalErrors: [],
      ...(softWarnings.length > 0 ? { softValidationWarnings: softWarnings } : {}),
    },
    ...(lastConvictionDeskAudit ? { convictionDeskAudit: lastConvictionDeskAudit } : {}),
  };
}
