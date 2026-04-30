import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiDeskJson,
  streamCallOpenAIWithSystemAndWebSearch,
  streamCallXaiWithSystemAndWebSearch,
  extractJson,
  type WebSearchResult,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";
import { getStrategistModel, type StrategistModelOption, type StrategistConfig } from "./strategistSettings.js";
import {
  VolAnalystOutputSchema,
  FlowAnalystOutputSchema,
  CatalystAnalystOutputSchema,
  PmOutputSchema,
  type VolAnalystOutput,
  type FlowAnalystOutput,
  type CatalystAnalystOutput,
  type PmOutput,
  type DeskResult,
} from "./strategistDeskSchemas.js";
import {
  buildVolAnalystPrompt,
  buildFlowAnalystPrompt,
  buildCatalystAnalystPrompt,
  buildPmPrompt,
} from "./strategistDeskPrompts.js";
import type { DebateRound } from "./strategistDebate.js";
import type { CatalystEvaluation } from "./catalystEvaluator.js";
import { runCatalystDeskStructuredSearches } from "./strategistDeskCatalystWebSearch.js";

const TEMPERATURE = 0;

export interface DeskCallbacks {
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

let turnSeq = 0;
function newTurnId(): string {
  turnSeq += 1;
  return `desk_${Date.now().toString(36)}_${turnSeq}`;
}

async function streamModel(
  modelOpt: StrategistModelOption,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (s: string) => void,
): Promise<WebSearchResult> {
  if (modelOpt.provider === "anthropic") {
    return streamCallAnthropicWithSystemAndWebSearch(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
  }
  if (modelOpt.provider === "openai") {
    return streamCallOpenAIWithSystemAndWebSearch(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
  }
  if (modelOpt.provider === "xai") {
    return streamCallXaiWithSystemAndWebSearch(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
  }
  // Desk JSON-only: Gemini cannot mix application/json with tools; skip web search for this path.
  return streamCallGeminiDeskJson(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
}

async function runDeskTurn<T>(args: {
  modelOpt: StrategistModelOption;
  prompt: string;
  role: "vol" | "flow" | "catalyst" | "pm";
  label: string;
  callbacks?: DeskCallbacks;
}): Promise<{ text: string; trace: WebSearchTrace; turnId: string }> {
  const { modelOpt, prompt, role, label, callbacks } = args;
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
    const r = await streamModel(modelOpt, systemPrompt, prompt, onDelta, (s) => callbacks?.onStatus?.(s));
    callbacks?.onTurnDone?.(turnId, r.text);
    return { text: r.text, trace: r.trace, turnId };
  } catch (err) {
    const errMsg = `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`;
    callbacks?.onTurnDone?.(turnId, acc + errMsg);
    throw err;
  }
}

function parseJsonFromText(raw: string): Record<string, unknown> | null {
  const cleaned = extractJson(raw);
  try {
    const v = JSON.parse(cleaned) as unknown;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return null;
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

  const volModel = getStrategistModel(settings.strategistSoloModelIdx);
  const flowModel = getStrategistModel(settings.strategistDebateAModelIdx);
  const catalystModel = getStrategistModel(settings.strategistDebateBModelIdx);
  const pmModelIdx = settings.strategistArbitratorModelIdx === -1 ? 0 : settings.strategistArbitratorModelIdx;
  const pmModel = getStrategistModel(pmModelIdx);

  const errors: string[] = [];

  let catalystResearchBriefing = "";
  let catalystSearchTrace: WebSearchTrace = { webSearchUsed: false, queries: [], sources: [] };
  if (deskExpirationISO) {
    callbacks?.onStatus?.("Desk — Catalyst structured web research…");
    try {
      const bundle = await runCatalystDeskStructuredSearches({
        ticker,
        catalystEval: catalystEvaluation ?? null,
        deskExpirationISO,
        model: catalystModel,
        onStatus: callbacks?.onStatus,
      });
      catalystResearchBriefing = bundle.briefing;
      catalystSearchTrace = bundle.trace;
    } catch (err) {
      logger.warn(
        { err, ticker },
        "StrategistDesk: structured catalyst web search bundle failed — continuing with calendar snapshot only",
      );
      catalystResearchBriefing =
        "## STRUCTURED RESEARCH (catalyst desk)\nResearch pass failed; treat web-derived themes as **data not surfaced** unless the calendar snapshot alone supports them.";
    }
  }

  const catalystPrompt = buildCatalystAnalystPrompt(dataPackage, catalystResearchBriefing || undefined);

  callbacks?.onStatus?.("Desk — Vol, Flow, and Catalyst analysts running in parallel…");

  const [volResult, flowResult, catalystResult] = await Promise.all([
    runAnalystWithRetry(ticker, "vol", volModel, buildVolAnalystPrompt(dataPackage), VolAnalystOutputSchema, callbacks, errors),
    runAnalystWithRetry(ticker, "flow", flowModel, buildFlowAnalystPrompt(dataPackage), FlowAnalystOutputSchema, callbacks, errors),
    runAnalystWithRetry(ticker, "catalyst", catalystModel, catalystPrompt, CatalystAnalystOutputSchema, callbacks, errors, catalystSearchTrace),
  ]);

  callbacks?.onStatus?.("Desk — PM synthesizing analyst reads…");

  const pmPrompt = buildPmPrompt(
    dataPackage,
    JSON.stringify(volResult.parsed),
    JSON.stringify(flowResult.parsed),
    JSON.stringify(catalystResult.parsed),
  );

  const pmTurn = await runDeskTurn({
    modelOpt: pmModel,
    prompt: pmPrompt,
    role: "pm",
    label: "PM",
    callbacks,
  });

  let pmParsed: PmOutput;
  const pmJson = parseJsonFromText(pmTurn.text);
  const pmValidation = PmOutputSchema.safeParse(pmJson);
  if (pmValidation.success) {
    pmParsed = pmValidation.data;
  } else {
    callbacks?.onTurnDiscarded?.(pmTurn.turnId);
    callbacks?.onStatus?.("Desk — PM output failed validation, retrying…");
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
      label: "PM (retry)",
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
        watch_for: "PM validation failure — retry the analysis",
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
    vol: "Vol Analyst",
    flow: "Flow Analyst",
    catalyst: "Catalyst Analyst",
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
  callbacks?.onStatus?.(`Desk — ${labels[role]} output failed validation, retrying…`);

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
      iv_state: "Unable to parse — see raw output",
      term_structure: "Unable to parse",
      skew: "Unable to parse",
      implied_vs_realized: "Unable to parse",
      read: snippet,
    };
  }
  if (role === "flow") {
    return {
      dominant_flow: "Unable to parse — see raw output",
      institutional_signal: "Unable to parse",
      retail_signal: "Unable to parse",
      key_strikes: [],
      read: snippet,
    };
  }
  return {
    primary_catalyst: "Unable to parse — see raw output",
    bar_to_clear: "Unable to parse",
    asymmetry: "Unable to parse",
    historical_pattern: "Unable to parse",
    read: snippet,
  };
}
