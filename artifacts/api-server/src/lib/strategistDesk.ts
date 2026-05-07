import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiDeskJson,
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
  buildSoloDeskUserPrompt,
  SOLO_DESK_MODEL_SYSTEM_PROMPT,
  buildConvictionDeskUserPrompt,
} from "./strategistDeskPrompts.js";
import { CONVICTION_DESK_MODEL_SYSTEM_PROMPT } from "./convictionDeskSystemPrompt.js";
import { validateConvictionDeskBusinessRules } from "./strategistDeskConvictionRules.js";
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

const TEMPERATURE = 0;
/** Conviction memo + greeks grid can exceed default model caps; truncates cause parse/extract failures. */
const CONVICTION_DESK_MAX_OUTPUT_TOKENS = 32768;

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
 * - **Gemini:** `streamCallGeminiDeskJson` cannot attach tools with `responseMimeType: application/json`;
 *   Catalyst uses pre-search or prompt-only for Google (see orchestrator status strings).
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
  if (modelOpt.provider === "anthropic") {
    return streamCallAnthropicWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
      cap != null ? { maxTokens: cap } : undefined,
    );
  }
  if (modelOpt.provider === "openai") {
    return streamCallOpenAIWithSystemAndWebSearch(
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
  if (modelOpt.provider === "xai") {
    return streamCallXaiWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
      cap != null ? { maxTokens: cap } : undefined,
    );
  }
  // Desk JSON-only: Gemini cannot mix application/json with tools; skip web search for this path.
  return streamCallGeminiDeskJson(
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

function mergeTraces(...traces: WebSearchTrace[]): WebSearchTrace {
  const seenUrls = new Set<string>();
  const sources = traces.flatMap(t => t.sources).filter(s => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });
  return {
    webSearchUsed: traces.some(t => t.webSearchUsed),
    queries: [...new Set(traces.flatMap(t => t.queries))],
    sources,
  };
}

export async function runDeskAnalysis(args: {
  dataPackage: string;
  settings: StrategistConfig;
  ticker: string;
  /** Same ISO date passed to evaluateCatalyst for Desk (position window right edge). */
  deskExpirationISO?: string;
  catalystEvaluation?: CatalystEvaluation | null;
  callbacks?: DeskCallbacks;
}): Promise<DeskResult> {
  const { dataPackage, settings, ticker, deskExpirationISO, catalystEvaluation, callbacks } = args;
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

  callbacks?.onStatus?.("Desk: PM synthesizing analyst reads…");

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

  let pmParsed: PmOutput;
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

  const pmOutputIncomplete = errors.some((e) => e.startsWith("PM output failed validation after retry"));

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
      trace: initialTrace ? mergeTraces(initialTrace, turn.trace) : turn.trace,
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
    const merged = mergeTraces(turn.trace, retryTurn.trace);
    return {
      parsed: retryValidation.data,
      trace: initialTrace ? mergeTraces(initialTrace, merged) : merged,
    };
  }

  const errorMsg = `${labels[role]} output failed validation after retry: ${retryValidation.error.issues.map(i => i.message).join("; ")}`;
  errors.push(errorMsg);
  logger.error({ role, ticker, model: model.model, provider: model.provider, label: model.label }, `StrategistDesk: ${errorMsg}`);

  const fallback = buildFallbackOutput(role, retryTurn.text);
  const mergedFail = mergeTraces(turn.trace, retryTurn.trace);
  return {
    parsed: fallback as T,
    trace: initialTrace ? mergeTraces(initialTrace, mergedFail) : mergedFail,
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
 */
export async function runConvictionDesk(args: {
  dataPackage: string;
  settings: StrategistConfig;
  ticker: string;
  deskExpirationISO?: string;
  catalystEvaluation?: CatalystEvaluation | null;
  callbacks?: DeskCallbacks;
}): Promise<ConvictionDeskResult> {
  const { dataPackage, settings, ticker, deskExpirationISO, catalystEvaluation, callbacks } = args;
  const startedAtIso = new Date().toISOString();

  const consolidatedModel = getStrategistModel(settings.strategistConvictionModelIdx);

  let catalystResearchBriefing = "";
  const catalystNativeWeb = consolidatedModel.provider !== "google";

  if (deskExpirationISO && consolidatedModel.provider === "google") {
    callbacks?.onStatus?.("Conviction Desk: Catalyst structured web research (Gemini JSON cannot use tools)…");
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
        "StrategistDesk: Conviction Desk structured catalyst web search bundle failed; continuing with calendar snapshot only",
      );
      catalystResearchBriefing =
        "## STRUCTURED RESEARCH (catalyst desk)\nResearch pass failed; treat web-derived themes as **data not surfaced** unless the calendar snapshot alone supports them.";
    }
  } else if (deskExpirationISO && catalystNativeWeb) {
    logger.info(
      { ticker, provider: consolidatedModel.provider },
      "StrategistDesk: Conviction Desk skipping catalyst structured pre-search; consolidated model uses native web search on JSON turn",
    );
    callbacks?.onStatus?.("Conviction Desk: Catalyst web pre-search skipped (native web search on consolidated turn)…");
  }

  const userPrompt = buildConvictionDeskUserPrompt(dataPackage, catalystResearchBriefing || undefined, {
    catalystSlotNativeWebSearch: catalystNativeWeb,
    provider: consolidatedModel.provider,
  });

  callbacks?.onStatus?.("Conviction Desk: single consolidated memo pass…");

  assertDeskNotCancelled(callbacks);

  const turnId = newTurnId();
  callbacks?.onTurnStart?.({
    id: turnId,
    round: "desk",
    role: "pm",
    phase: "pm",
    model: consolidatedModel.model,
    label: "Conviction Desk",
    startedAt: Date.now(),
  });

  let acc = "";
  const onDelta = (delta: string) => {
    acc += delta;
    callbacks?.onTurnDelta?.(turnId, delta);
  };

  let text = "";
  let r: WebSearchResult | undefined;
  try {
    r = await streamModel(
      consolidatedModel,
      CONVICTION_DESK_MODEL_SYSTEM_PROMPT,
      userPrompt,
      onDelta,
      (s) => callbacks?.onStatus?.(s),
      callbacks?.cancelSignal,
      { convictionDeskLargeMemo: true },
    );
    text = r.text;
    callbacks?.onTurnDone?.(turnId, text);
  } catch (err) {
    const errPlain = err instanceof Error ? err.message : String(err);
    const errMsg = `\n\n[error: ${errPlain}]`;
    callbacks?.onTurnDone?.(turnId, acc + errMsg);
    const finishedAt = new Date().toISOString();
    const ex = extractJsonAndParse(acc);
    const valStream = validateConvictionPipeline(ex.parsedJson);
    const diagAttempts: ConvictionDeskRunDiagnostic["attempts"] = [
      {
        attemptNumber: 1,
        rawResponseText: acc,
        envelope: createEmptyEnvelope(
          strategistProviderToEnvelopeProvider(consolidatedModel.provider),
          consolidatedModel.model,
        ),
        extractedJsonString: ex.extractedJsonString,
        parsedJson: ex.parsedJson,
        validationResult: validationResultForAttempt(valStream),
      },
    ];
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
      errors: [`Conviction Desk stream failed: ${errPlain}`],
      convictionDeskRunDiagnostic: {
        ticker,
        modelId: consolidatedModel.model,
        provider: consolidatedModel.provider,
        startedAt: startedAtIso,
        finishedAt,
        outcome: "stream_error",
        attempts: diagAttempts,
        finalErrors: [`Conviction Desk stream failed: ${errPlain}`],
      },
    };
  }

  const errors: string[] = [];
  const attempts: ConvictionDeskRunDiagnostic["attempts"] = [];

  const ext1 = extractJsonAndParse(text);
  let validation = validateConvictionPipeline(ext1.parsedJson);
  attempts.push({
    attemptNumber: 1,
    rawResponseText: text,
    envelope: r.envelope,
    extractedJsonString: ext1.extractedJsonString,
    parsedJson: ext1.parsedJson,
    validationResult: validationResultForAttempt(validation),
  });

  if (!validation.ok) {
    logger.warn(
      { ticker, detail: validation.detail, model: consolidatedModel.model, provider: consolidatedModel.provider },
      "StrategistDesk: Conviction Desk output failed validation, retrying",
    );
    callbacks?.onStatus?.("Conviction Desk: memo output failed validation, retrying…");
    assertDeskNotCancelled(callbacks);
    const retryTurnId = newTurnId();
    callbacks?.onTurnStart?.({
      id: retryTurnId,
      round: "desk",
      role: "pm",
      phase: "pm",
      model: consolidatedModel.model,
      label: "Conviction Desk (retry)",
      startedAt: Date.now(),
    });
    let retryAcc = "";
    const onRetryDelta = (delta: string) => {
      retryAcc += delta;
      callbacks?.onTurnDelta?.(retryTurnId, delta);
    };
    const retryPrompt =
      userPrompt +
      `\n\nYour previous response failed validation: ${validation.detail}.\n\nReturn ONLY one valid JSON object exactly matching the structure shown in the skeleton above. Use the exact field names and enum values from the skeleton. No markdown, no code fences, no commentary before or after the JSON.`;
    let retryR: WebSearchResult | undefined;
    try {
      retryR = await streamModel(
        consolidatedModel,
        CONVICTION_DESK_MODEL_SYSTEM_PROMPT,
        retryPrompt,
        onRetryDelta,
        (s) => callbacks?.onStatus?.(s),
        callbacks?.cancelSignal,
        { convictionDeskLargeMemo: true },
      );
      callbacks?.onTurnDone?.(retryTurnId, retryR.text);
    } catch (err) {
      const errPlain = err instanceof Error ? err.message : String(err);
      const errMsg = `\n\n[error: ${errPlain}]`;
      callbacks?.onTurnDone?.(retryTurnId, retryAcc + errMsg);
      const finishedAt = new Date().toISOString();
      const rex = extractJsonAndParse(retryAcc);
      const rval = validateConvictionPipeline(rex.parsedJson);
      attempts.push({
        attemptNumber: 2,
        rawResponseText: retryAcc,
        envelope:
          retryR?.envelope ??
          createEmptyEnvelope(strategistProviderToEnvelopeProvider(consolidatedModel.provider), consolidatedModel.model),
        extractedJsonString: rex.extractedJsonString,
        parsedJson: rex.parsedJson,
        validationResult: validationResultForAttempt(rval),
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
        errors: [`Conviction Desk retry stream failed: ${errPlain}`],
        convictionDeskRunDiagnostic: {
          ticker,
          modelId: consolidatedModel.model,
          provider: consolidatedModel.provider,
          startedAt: startedAtIso,
          finishedAt,
          outcome: "stream_error",
          attempts,
          finalErrors: [`Conviction Desk retry stream failed: ${errPlain}`],
        },
      };
    }

    const ext2 = extractJsonAndParse(retryR.text);
    validation = validateConvictionPipeline(ext2.parsedJson);
    attempts.push({
      attemptNumber: 2,
      rawResponseText: retryR.text,
      envelope: retryR.envelope,
      extractedJsonString: ext2.extractedJsonString,
      parsedJson: ext2.parsedJson,
      validationResult: validationResultForAttempt(validation),
    });
  }

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
    };
  }

  logger.info(
    {
      ticker,
      convictionDeskModel: { provider: consolidatedModel.provider, model: consolidatedModel.model, label: consolidatedModel.label },
      convictionDeskPromptChars: userPrompt.length,
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
    },
  };
}
